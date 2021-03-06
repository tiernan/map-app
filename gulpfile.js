var BUILD = 'dist/',
	SOURCE = 'app/',
	gulp = require('gulp'),
	connect = require('gulp-connect'),
	compression = require('compression'),
	imageMin = require('gulp-imagemin'),
	minifyCSS = require('gulp-clean-css'),
	minifyHTML = require('gulp-minify-html'),
	minifyJS = require('gulp-uglify'),
	minifyJSON = require('gulp-json-minify'),
	prettyData = require('gulp-pretty-data'),
	useMin = require('gulp-usemin');

// Copy favicon.ico to build
gulp.task('copy-favicon', function() {
	return gulp.src(SOURCE + 'favicon.ico')
		.pipe(gulp.dest(BUILD));
});

// Minify HTML and compile script/css builds
gulp.task('html', function() {
	return gulp.src(SOURCE + '*.html')
		.pipe(useMin({
			css: [minifyCSS],
			html: [function() {
				return minifyHTML({
					empty: true
				});
			}],
			js: [minifyJS],
			jsAttributes: {
				async: true,
				defer: true
			},
			inlinejs: [minifyJS],
			inlinecss: [minifyCSS, 'concat']
		}))
		.pipe(gulp.dest(BUILD));
});

// Minify icons
gulp.task('icons', function() {
	return gulp.src(SOURCE + 'icons/*')
		.pipe(imageMin())
		.pipe(gulp.dest(BUILD + 'icons'));
});

// Minify JS Polyfills
gulp.task('minify-js-polyfills', function() {
	return gulp.src(SOURCE + 'script/polyfill/*.js')
		.pipe(minifyJS())
		.pipe(gulp.dest(BUILD + 'script/polyfill'));
});

// Minify JSON data
gulp.task('minify-json', function() {
	return gulp.src(SOURCE + '**/*.json')
		.pipe(minifyJSON())
		.pipe(gulp.dest(BUILD));
});

// Minify XML files
gulp.task('minify-xml', function() {
	return gulp.src(SOURCE + '**/*.xml')
		.pipe(prettyData({type: 'minify', preserveComments: false}))
		.pipe(gulp.dest(BUILD));
});

// Compile TypeScript/Sass
gulp.task('compile-super', ['sass', 'type-script']);

// Build
gulp.task('build', ['compile-super'], function() {
	gulp.start('build-no-compile');
});

// Build without compiling TypeScript or Sass
// This is for use with an IDE that already compiles these for you.
gulp.task('build-no-compile', ['copy-favicon', 'html', 'icons', 'minify-json', 'minify-xml']);

// Run local web server
gulp.task('web-server', function() {
	connect.server({
		root: BUILD,
		middleware: function() {
			return [
				compression({})
			];
		}
	});
});

// Default task
gulp.task('default', ['web-server']);