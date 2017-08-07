---
layout: post
title:  "Project Snowflake: getting the best of two worlds"
date:   2017-08-07
tags: [.net, C#]
excerpt_separator: <!--more-->
---
As a new whitepaper by Microsoft Research suggests, researchers from Microsoft have successfully managed to implement a manual memory management programming model that works along with the existing .NET Core Garbage Collector (GC), without imposing tangible performance penalties on it.
<!--more-->

On July 26, 2017 Microsoft research group in association with co-authors from Princeton and Cambridge Universities published a whitepaper on their implementation of safe, manual memory management subsystem integrated into .NET Core CLR, namely Project Snowflake. The primary motivation for mixing managed and manual memory management is to give managed code programmers an easy-to-master yet safe tool/method to do performance optimization of performance-critical chunks of their code. With raise of mobile devices having limited computational and battery resources, various new machine learning use cases, and servers with hundreds gigabytes of memory occupied by managed apps, the need for optimizations becomes acute as never before. 

Project Snowflake effort is comprised of 4 main parts:
1. Addition of a separate unmanaged/manual heap and allocator for it (currently they use jemalloc).
2. Introduce pointers ownership protocol to keep track of `manual objects` (objects allocated in manual heap) and to know when it is safe to delete them.
3. Modify C#'s compiler frontend (static analyzer) to guarantee ownership policies at compile time
4. Employing epochs protocol for non-blocking cross-thread shilds tracking and reclamation of manual objects

## Why safety matters
.NET CLR already provides various ways to enable interoperation between managed and unmanaged worlds. Since the day one, it was possible to directly access memory through raw pointers in blocks of code explicitely marked as unsafe or use P/Invoke mechanism to access some native C lib or COM objects. Execution of such code requires full-trust privileges and is primearly used to increase performance and/or go outside CLR bounds to make a system call or make use of any kind of external library.

Here are a couple of examples of how .NET BCL utilizes unsafe code to increase performance (taken from here [referencesource](https://referencesource.microsoft.com "referencesource")):

For example, BinarySearch method of Array class from Full .NET Framework's BCL is simply goes down to calling external function `TrySZBinarySearch`,
which is implemented in C++ and accessible from CLR itself (as MethodImplOptions.InternalCall suggests).

```csharp
class Array
{
    private static extern bool TrySZBinarySearch(Array sourceArray, ...);
}

[...]
[System.Security.SecurityCritical]   
[MethodImplAttribute(MethodImplOptions.InternalCall)]
private static extern bool TrySZBinarySearch(Array sourceArray, ...);
```

Or string comparison algorithm which compares two ascii strings char-by-char reading them directly from managed heap's memory. .NET uses it when it sees that both strings contain only ASCII symbols.

```csharp
[System.Security.SecuritySafeCritical] 
private unsafe static int CompareOrdinalIgnoreCaseHelper(String strA, String strB)
{
    ...
    int length = Math.Min(strA.Length, strB.Length);

    fixed (char* ap = &strA.m_firstChar) 
    fixed (char* bp = &strB.m_firstChar)
    {
        char* a = ap;
        char* b = bp;

        while (length != 0) 
        {
            int charA = *a;
            int charB = *b;

            Contract.Assert((charA | charB) <= 0x7F, "strings have to be ASCII");

            // uppercase both chars - notice that we need just one compare per char
            if ((uint)(charA - 'a') <= (uint)('z' - 'a')) charA -= 0x20;
            if ((uint)(charB - 'a') <= (uint)('z' - 'a')) charB -= 0x20;

            //Return the (case-insensitive) difference between them.
            if (charA != charB)
                return charA - charB;

            // Next char
            a++; b++;
            length--;
        }

        return strA.Length - strB.Length;
    }
}
```
		
As name suggests unsafe code prevents CLR from verifying its safety in terms of memory access, type safety, remembering to pin managed object,  etc. An assembly containing unsafe code may only be used in a process granted with full-trust permission. Another problem with such code is that in spite of being quite similar to *C#*, it feels more like a chunk of some other language embedded in *C#* code. *C#* Language specification even says " ... In a sense, writing unsafe code is much like writing *C* code within a *C#* program.". In addition, using *C* libs or *COM servers* involves performance and memory overhead when marshaling non-blitable types and clutters managed code with all sorts of *C*-style StructLayout-s or *COM* Wrappers.

The suggested programming model of Snowflake addresses the aforementioned issues abstracting programmer from the pointer algebra, marshaling and keeping optimized code as safe as any other managed code. Moreover, there is only a very few concepts that programmer will be required to master in order to start using it.

## Basics of new model

Snowflake do not extend *C#* language in any way (except for *new Owner<MyClass>(...)* sugar mentioned in the paper ), instead it simply introduces very minimalistic Core Snowflake API. 

1. New `ManualHeap` class serves as a factory that creates new objects in manual heap and saves IntPtr inside Owner<T> object passed to it by-ref.
    ```csharp
    class ManualHeap {
        void Create<T>(ref Owner<T> dst) where T:class, new();
        void CreateArray<S>(ref Owner<S[]> dst, int len);
    }
    ```

    The by-ref `dst` parameter is used here and in other places to prevent CLR from creating copies of `Owner<T>` struct. The reason for this will be explained later.



2. `Owner<T>` struct plays the central role in the manual heap management. This type encapsulate raw pointer to the object in manual heap. There is no way to get this pointer out of it, nor it is possible to clone or copy an Owner<T> object after it was initialized with such pointer. In any given time there MUST be one and only `Owner<T>` object pointing to the same manual object (unique owner condition). To prevent `Owner<T>` object form being allocated as a separate managed object in managed heap and therefore require GC collection, it is declared as *struct* and not *class*. Consequently,  `Owner<T>` can be passed around the methods only as a by-ref parameter. However, `Owner<T>` object can be located either in stack, managed heap or manual heap. `Owner<T>` can end up located in one of the heaps when assigned to another class or struct field. In .net a struct instance 'referenced' as its field is saved in the same memory segment as other data types comprising the object.

    ```csharp
    struct Owner<T> where T : class 
    {
        Shield<T> Defend();
        void Move<S>(ref Owner<S> x) where S:class, T;
        void Abandon();
    }
    ```



3. Unfortunately, tying a lifetime of manual object to the lifetime of correspondent `Owner<T>` is not enough in a multithreaded environment. To guarantee that manual object will not be reclaimed while one of threads still uses it, Snowflake introduces shields. 

    ```csharp
    struct Shield<T> : IDisposable 	where T:class 
    {
        static Shield<T> Create();
        void Defend(ref Owner<T> u);
        T Value;
        void Dispose();
    }
    ```

    Shield's sole purpose is to defend manual object from premature reclamation. Unlike `Owner<T>` objects, which can be allocated both in heap or stack, `Shield<T>` structures are only allowed to be in thread's stack that created it. This requirement is checked by compiler's frontend. A shield object contains a reference to TLS slot that store reference to a manual object. In additoin, for performance reason, `Shield<T>` itself also contain a direct reference to the manual object it guards.

    Manual object's lifetime is defined by its Owner and each of the Shields in different threads. When each of them is voting to abandon a manual object, it will be eventually reclaimed from manual heap. There is, however, a certain deterministic delay caused by the non-blocking protocol of threads catching up with the global epoch.

## Conclusion

The multiple benchmarks, presented in the paper, show 2x-3x performance gains achieved by minor optimizations in existing code, after switching from *GC* to manual management. At the same time, the new programming model is completely optional and do not affect managed code. There seem to be no trade of of any kind. Unlike, for example, async/await feature which has a poisonous effect on code base, the manual memory management is aiming to be used in small pieces of code that can benefit from disabling *GC* on a particular objects. 

From authors’ words, the best candidates for manual memory optimization are the objects that are of reasonable size, survived *GC0* and were moved to older generations. Despite, some requirements on how to use *Core Snowflake API* the new programming model allows seamless coexistence of managed and manually-allocated objects. A managed object can reference manual one in its field and vice-versa and be accessed from any thread, not just the one created it.

So far, this is still only a research project. There is no information of when this code will be merged into the .NET Core master, if ever. Nevertheless, I personally look forward to hear more about it and see what will happen next.