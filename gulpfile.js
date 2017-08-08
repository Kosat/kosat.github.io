var gulp = require('gulp');
var gutil = require('gulp-util');
var browserSync = require('browser-sync').create();
var del = require('del');
var cp = require('child_process');
var uncss = require('gulp-uncss');
var minifycss = require('gulp-minify-css');
var rename = require('gulp-rename');
var sourcemaps = require('gulp-sourcemaps');
var runSequence = require('run-sequence');
var sass = require('gulp-sass');



gulp.task("copy_npm_deps", /* ["clean"],*/ function() {
    var npm_dependencies = {
        "jquery/dist/jquery*.{js,map}": "./js",
        "bootstrap/dist/js/bootstrap*.{js,map}": "./js",
        "bootstrap-sass/assets/stylesheets/bootstrap/**/*.*": "./_sass/bootstrap",
        "bootstrap-sass/assets/stylesheets/_bootstrap.scss": "./_sass/",
        "font-awesome/fonts/*.*": "./fonts",
        "font-awesome/scss/*.*": "./_sass/font-awesome/",
    };

    for (var depPath in npm_dependencies) {
        let npm_path = "node_modules"
        gulp.src(npm_path + '/' + depPath)
            .pipe(gulp.dest(npm_dependencies[depPath]));
    }
});


//https://stackoverflow.com/questions/3653065/get-local-ip-address-in-node-js
function getIPAddress() {
    var interfaces = require('os').networkInterfaces();
    for (var devName in interfaces) {
        var iface = interfaces[devName];

        for (var i = 0; i < iface.length; i++) {
            var alias = iface[i];
            if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal)
                return alias.address;
        }
    }

    return '0.0.0.0';
}

gulp.task('clean', function() {
    return del(['_site']);
    return del(['.sass-cache']);
});

/**
 * Build the Dev Jekyll Site
 */
gulp.task('jekyll-build-dev', function(done) {
    return cp.spawn('bundle', ['exec', 'jekyll build --config ./_config.yml,./_config-dev.yml'], { stdio: 'inherit' })
        .on('error', (error) => gutil.log(gutil.colors.red(error.message)))
        .on('close', done);
});

/**
 * Build the Release Jekyll Site
 */
gulp.task('jekyll-build-release', function(done) {
    return cp.spawn('bundle', ['exec', 'jekyll build --config ./_config.yml'], { stdio: 'inherit' })
        .on('error', (error) => gutil.log(gutil.colors.red(error.message)))
        .on('close', done);
});

/**
 * Set browserSync to auto-refresh site.
 * BrowserSync works in proxy mode forwarding jekyll internal web-server to hostname:3000
 * and injecting it auto-update java-script.
 */
gulp.task('jekyll-serve', function(done) {
    browserSync.init({
        open: false,
        host: getIPAddress(),
        proxy: 'http://localhost:4000/',

    });

    return cp.spawn('bundle', ['exec', 'jekyll serve --skip-initial-build --host localhost --port 4000 --no-watch'], { stdio: 'inherit' }) // Adding incremental reduces build time.
        .on('error', (error) => gutil.log(gutil.colors.red(error.message)))
        .on('close', done);
});

/**
 * Watch for file changes and trigger jekyl build / refresh
 */
gulp.task('jekyll-watch', function() {
    gulp.watch('_sass/*.scss', function() { runSequence('transpile-dev') });
    gulp.watch(['*.md', '*.html', '_layouts/*.*', '_includes/*.*', '_posts/*.*', 'tags/*.*' /*, '_sass/*.scss'*/ ],
        function() { runSequence('jekyll-build-dev' /*, 'post'*/ ); });
    gulp.watch(['_site/**/*.*'], function() { browserSync.reload(); });
});

gulp.task('transpile-dev', function(done) {
    del('_site/css/core.css');
    return cp.spawn('bundle', ['exec', 'sass ./_sass/_main.scss ./_site/css/main.css'], { stdio: 'inherit' }) // Adding incremental reduces build time.
        .on('error', (error) => gutil.log(gutil.colors.red(error.message)))
        .on('close', done);
});

gulp.task('prep-release', ['jekyll-build-release'], function() {
    return gulp.src('_site/css/main.css')
        .pipe(uncss({
            html: ['_site/*.html', '_site/**/*.html']
        }))
        .pipe(minifycss())
        .pipe(rename('main.min.css'))
        .pipe(gulp.dest('./css/'));
});

gulp.task('dev', function() {
    return runSequence('jekyll-build-dev',
        'transpile-dev', 
        ['jekyll-watch', 'jekyll-serve']

    );
});

gulp.task('release', function(callback) {
    runSequence('clean', 'prep-release', 'jekyll-serve', callback);
});

gulp.task('default', ['dev'])