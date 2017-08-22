---
layout: post
title: "Mixing languages for better or worse"
date: 2017-08-21
tags: [.net, C#, F#, C, Benchmark]
excerpt_separator: <!--more-->
comments: true
---
![Snow Flake](/images/2017-08-21-MixingLangsBenchmark/graph.png){:class="post-image"} In this post I'd like to do some benchmarking and review a number of implementations of Damerau–Levenshtein algorithm in terms of their performance when running on .Net 4.6.1 and just released .Net Core 2.0 environments. <!--more-->

# Introduction
When implementing algorithms or other stand-alone business logic code that’s intended to be included into a codebase of a real-life project, it’s usually boils down to balancing between ease of maintenance and performance. When you work on a project written in *C#*, the default decision is, of course, to keep things easy and write everything in *C#*. However, here I’d like to explore other options and most importantly their implications on performance.

There’re two primary reasons to opt for other languages when working on a mainstream *C#* .net project: First, achieving a better performance. Typically, in this case people end up writing some native *C/C++* code and use it through *P/Invoke* from their main *C#* codebase. There are enough examples of such approach present within BCL, one of which I mentioned in my previous post about Project Snowflake. Second, achieving a better readability. In this case, the best choice would be utilizing F#, which is the only popular functional language supported by Microsoft and has its stable niche in financial IT projects. The great thing about utilizing such Functional Programming languages, like F#, is that it makes easier for analytics and other people with solid math background to contribute to the project.

# C# implementations
To begin, I'll start with implementing the Damerau–Levenshtein algorithm in *C#* language. The algorithm calculates the number of permutations that are needed to convert string1 to string2. It's commonly used for spell-checking in text editors. However, it also has more serious applications, for example, comparing DNA sequences. Software developers may see it in work when they mistype git-cli command and receive "Did you mean?" suggestions in return. 

The below code is a dynamic programming implementation of the algorithm, having O(nm) time and O(m) memory complexity, where n is the length of string1 and m - length of string2. The implementation only stores in memory the list 3 rows of computed distances, so it allocates 3*m space in memory. Those 3 rows are then swapped in round-robin fashion. The implementations allows each kind of permutation to be given a different weight but in my tests all the weights were always set to 1.

<script src="https://gist.github.com/Kosat/d1457e507939e8c4ebe8261cdc19b86b.js"></script>

This managed *C#* implementation is going to serve as a baseline throughout the rest of the post. Here I should mention that this code and other implementations presented in this article were intentionally written to be as close to each other and to the native C implementation as possible. This is done to focus on performance measurement and minimize other factors caused by implementation differences. For performance measurement I used a really great benchmarking library [BenchmarkDotNet](https://github.com/dotnet/BenchmarkDotNet).

Before going to *C* and *F#* implementations, let's see how this code may be optimized while still staying in bounds of CSC compiler.
Here I'm going to use manual memory management, allocating memory in native CLR heap with `Marshal.AllocHGlobal` and manually freeing the memory with `Marshal.FreeHGlobal` in the end. To optimize memory allocation even further, the code allocates memory from stack in cases when both strings do not exceed the length of 15 chars, which by far covers a basic spell-checking use cases, given that the average word length in English is only 5.1 letters.

<script src="https://gist.github.com/Kosat/d5016c7982da3a757b0635545a8fcca7.js"></script>

There are two key points that make this code faster than its safe version:
1. Deterministic memory management, which saves GC cycles.
2. Raw pointers to work with arrays. This will disable CLR's array bound checks in runtime. 

Let's compare the performances of this two implementations running on *.net core 2.0* and *.net 4.6.1* CLRs:

![Safe VS Unsafe1](/images/2017-08-21-MixingLangsBenchmark/SafeVsUnsafe_Line_Graph.png)

The graph displays time performance data in milliseconds for sample strings of length of 10, 50, 100, 500 and 1000 letters. In this post I'm only concentrating on the 64-bit versions of just-in-time compilers, mostly on *RyuJit64*. 

The data shows that the unsafe code(`Unsafe1`) running on .net Core with *RyuJit64* outperforms the `Safe` implementation by 24% and by 29% when running on *.net 4.6.1* with *RyuJit64* turned on. With legacy *JIT64*, which is only still available on *.net 4.6.1*, the difference between these two implementations are only 10%, though. I'd also note that on *.net 4.6.1* *RyuJit64* generated significantly more performant code for `Unsafe1` implementation than legacy *JIT64* did.

NOTE: In the next benchmarks I'm going to put aside the legacy *JIT64* and fully concentrate on *RyuJit64*, which is expected to completely replace *JIT64* in the near future. I'm also limiting the benchmarking to the *Concurrent Workstation mode* of GC and omitting the *Server mode* altogether.

To understand the performance differences better, I collected the disassembed code of jitted methods, which can be found [here](https://github.com/Kosat/MixingLangsBenchmark/tree/master/RESULTS_ARCHIVE/18-08-2017/asm). 

The `Safe` assembler/machine code is nearly 40% longer than the `Unsafe1` one. Both machine codes were generated by *RyuJit64* running on *.net 4.6.1*. 
In the beginning, the `Unsafe1` disassembled code is very close to the `Safe` one, however, for i>0 and j>0 for inner and outer for-loops *RyuJit64* generated separate machine codes (see line 232 and line 354). This way Jit optimizes machine code to reduce the number of far jumps, because far jumps get in a way of CPU's branch prediction and consequently poorly affects performance. On the other hand, `Unsafe1` assembler code is very concise and matches the lines of the *C#* code. 

As expected, the `Safe`-code-generated machine code includes a great number of array bounds checks, some of which I highlighted on the screenshot below.
![Safe code array bounds checks](/images/2017-08-21-MixingLangsBenchmark/Safe_net461_ArrBndChecks.png)

Next, let's check the differences between *.net 4.6.1* and *.net core 2.0* generated machine codes. The machine codes are very close, but in some places the version of *RyuJit64* included in *.net core 2.0* CLR generated some additional instructions that unnecessary moves values between registers and call stack, wasting CPU cycles.
Here, on the left side is the .net 4.6.1 faster version and on the right is slower .net core version:
![Assembler diffs between net461 and core 1](/images/2017-08-21-MixingLangsBenchmark/Unsafe1_net461_vs_Core_125.png)
![Assembler diffs between net461 and core 2](/images/2017-08-21-MixingLangsBenchmark/Unsafe1_net461_vs_Core_128.png)

The differences in machine code and performance come from the fact that *.net 4.6.1* and *.net core 2.0* contain different versions of *RyuJit64* compiler. On the machine where I did the benchmarking I had *RyuJit64* v4.6.25519.2 as part of in *.Net core*'s CLR and v4.7.2102.0 in *.net 4.6.1* one.

# Native C implementation
Now, it is time to see how fast this algorithm can work when implemented in native *C* and called from *C#* via CLR's *P/Invoke*. The [*Native C*](https://github.com/Kosat/MixingLangsBenchmark/levenshtein-C/levenshtein.cpp) implementation, which I took from [git](https://github.com/git/git) repository and added some ceremony code to make *P/Invoke* happy, was compiled with **/O2** optimization flag with *MSVC* compiler. 

<script src="https://gist.github.com/Kosat/cc4130f71a5bfd31c7d9f76b6787598d.js"></script>

Here are the bar charts that compare `safe`, `Unsafe1` and `Native C` implementations in *.net core* and *net461* environments when run for 10, 50, 100, 500 and 1000 characters strings.

![Native C perf](/images/2017-08-21-MixingLangsBenchmark/Native_C_10.png)

![Native C perf](/images/2017-08-21-MixingLangsBenchmark/Native_C_50_100.png)

![Native C perf](/images/2017-08-21-MixingLangsBenchmark/Native_C_500_1000.png)

Note how with the samples of 10 the `Native C` implementation performs so badly. That's mostly because with such amount of data algorithm executes so fast that the time spent on *P/Invoke* constitutes for nearly 20% of the algorithm execution time. When strings are larger, the algorithm's time goes up considerably and P/Invoke time loss becomes unneglectable. 

I separately measured the *P/Invoke* overhead by adding `dummy_C` procedure to the C project. Below are the table that shows the costs of calling `dummy_C` method from *CLR*, depending on the string sizes. The *P/Invoke* overhead, measured by calling `dummy_C`, in this case is primarily caused by marshalling of two strings. The .Net `System.String` type is non-blittable and thus requires marshalling.


| Str. Len.      	|  Time [us]    |
|---		        |---		    |
|        10 		|   0.0964      |
|        50 		|   0.1592      |
|       100 		|   0.2758      |
|       500 		|   1.044       |
|      1000		    |   1.8298      |
{:class="table30"}

And the graph indicating execution times of `levenshtein_C` and `dummy_C` for samples of 10 and 50 letters, side by side.
![Native C vs Dummy](/images/2017-08-21-MixingLangsBenchmark/Native_C_vs_Dummy.png)

Overall, the data shows that at samples bigger than 10, *Native C* implementation is roughly twice faster than `Safe` implementation and about 1.5 faster than `Unsafe1`, depending on execution environment and string lengths.
The performance advantage of `Native C` can easily be explained by looking into disassembler code and finding out that *MSVC* fully made use of the *SSE* instructions. See `Native C` [asm](https://github.com/Kosat/MixingLangsBenchmark/Reports/asm/Native-C.asm) .


# F# implementations
After measuring the perforce gains s from incorporating the native *C* code, it is time to explore the downfalls of using F# for that matter.
At first, I've implemented the algorithm in imperative way to be very close to the *C#* and *C* versions.

<script src="https://gist.github.com/Kosat/6303464cbba69712145cc64862c2b7c0.js"></script>

And then I removed loops in favour of recursion. 

<script src="https://gist.github.com/Kosat/17ea969799598bb728c69544bfeb50c8.js"></script>

The next charts display timings for samples of 10 and 1000 on *net461* and *.net core* for each of the implementations.
![F# perf 10](/images/2017-08-21-MixingLangsBenchmark/FSharp_vs_others_10.png)
![F# perf 1000](/images/2017-08-21-MixingLangsBenchmark/FSharp_vs_others_1000.png)

On a small sample of 10 chars F# implementations performed more than twice slower than the baseline *C#* `Safe` ones. With bigger samples of 1000, the difference, however, becomes less notable, around 15%.

# Conclusion
*Native C* showed at least 2 times better performance on large samples than *C#* implementations but yielded practically the same performance results on the 10-character samples because of the *P/Invoke* overhead. F# implementation completely lost the competition on smaller samples, even though, performed only 15% slower than *C#* `Safe` implementation on the strings of 1000 letters.

Overall, *RyuJIT64* compiler that comes with *.Net Core 2.0* generated less performant machine code compared to the the different version of this jit compiler included in *.Net 4.6.1*, while *MSVC* was the only compiler that optimized the code to use *SIMD* instructions.

All the code I used in this post and benchmark reports are available in a separate repository [MixingLangsBenchmark](https://github.com/Kosat/MixingLangsBenchmark "MixingLangsBenchmark"). 