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
var jshint = require("gulp-jshint");
var uglify   = require('gulp-uglify');
var purifycss   = require('gulp-purifycss');


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
gulp.task('jekyll-build-dev', function(callback) {
    return cp.spawn('bundle', ['exec', 'jekyll build --config ./_config.yml,./_config-dev.yml'], { stdio: 'inherit' })
        .on('error', (error) => gutil.log(gutil.colors.red(error.message)))
        .on('close', callback);
});

/**
 * Build the Release Jekyll Site
 */
gulp.task('jekyll-build-release', function(callback) {
    var procEnv = process.env;
    procEnv.JEKYLL_ENV = 'production';

    return cp.spawn('bundle', ['exec', 'jekyll build --config ./_config.yml'], { stdio: 'inherit', env:procEnv  })
        .on('error', (error) => gutil.log(gutil.colors.red(error.message)))
        .on('close', callback);
});

/**
 * Set browserSync to auto-refresh site.
 * BrowserSync works in proxy mode forwarding jekyll internal web-server to hostname:3000
 * and injecting it auto-update java-script.
 */
gulp.task('jekyll-serve-dev', function(callback) {
    browserSync.init({
        open: false,
        host: getIPAddress(),
        proxy: 'http://localhost:4000/',

    });

    return cp.spawn('bundle', ['exec', 'jekyll serve --skip-initial-build --host localhost --port 4000 --no-watch'], { stdio: 'inherit' }) // Adding incremental reduces build time.
        .on('error', (error) => gutil.log(gutil.colors.red(error.message)))
        .on('close', callback);
});

gulp.task('jekyll-serve-release', function(callback) {
    return cp.spawn('bundle', ['exec', 'jekyll serve --skip-initial-build --host '+ getIPAddress() + ' --port 3000 --no-watch'], { stdio: 'inherit' }) // Adding incremental reduces build time.
        .on('error', (error) => gutil.log(gutil.colors.red(error.message)))
        .on('close', callback);
});

/**
 * Watch for file changes and trigger jekyl build / refresh
 */
gulp.task('jekyll-watch', function() {
    gulp.watch('_sass/*.scss', function() { runSequence('styles-dev') });
    // gulp.watch('scripts/*.js', function() { runSequence('scripts-dev') });
    gulp.watch(['*.md', '*.html', '_layouts/*.*', '_includes/*.*', '_posts/*.*', 'tags/*.*' ],
        function() { runSequence('jekyll-build-dev'); });
    gulp.watch(['_site/**/*.*'], function() { browserSync.reload(); });
});

gulp.task('styles-dev', function(callback) {
    del('_site/css/core.css');
    return cp.spawn('bundle', ['exec', 'sass ./_sass/_main.scss ./_site/css/main.css'], { stdio: 'inherit' }) // Adding incremental reduces build time.
        .on('error', (error) => gutil.log(gutil.colors.red(error.message)))
        .on('close', callback);
});

gulp.task('styles-release', ['jekyll-build-release'], function(callback) {
     return gulp.src('_site/css/main.css')
    //     .pipe(uncss({
    //         html: ['_site/*.html', '_site/**/*.html']
    //     }))
        .pipe(purifycss(
            ['_site/*.html', '_site/**/*.html']
        ))
        .pipe(minifycss())
        .pipe(rename('main.min.css'))
        .pipe(gulp.dest('_site/css/'))
        .pipe(gulp.dest('./css/'))
        .on('error', (error) => gutil.log(gutil.colors.red(error.message)))
        .on('close', callback);
});

gulp.task('scripts-release', function(callback) {
  return gulp.src('_site/scripts/main.js')
    .pipe(jshint())
    .pipe(jshint.reporter("default"))
    .pipe(uglify())
    .pipe(rename('main.min.js'))
    .pipe(gulp.dest('./scripts'))
    .pipe(gulp.dest('_site/scripts'))
    .on('error', (error) => gutil.log(gutil.colors.red(error.message)))
    .on('close', callback);;
});

gulp.task('dev', function() {
    return runSequence('jekyll-build-dev',
        'styles-dev', 
        ['jekyll-watch', 'jekyll-serve-dev']

    );
});

gulp.task('release', function(callback) {
    runSequence('clean', 'styles-release', 'scripts-release', 'jekyll-serve-release', callback);
});

gulp.task('default', ['dev'])