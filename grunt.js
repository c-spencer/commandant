module.exports = function (grunt) {
  grunt.loadNpmTasks('grunt-coffee');
  grunt.loadNpmTasks('grunt-preprocess');

  grunt.initConfig({
    preprocess: {
      js: {
        src: './builds/commandant.js',
        dest: './builds/commandant.noasync.js'
      }
    },
    lint: {
      all: ['grunt.js', './examples/scene.js', './test/*.js']
    },
    test: {
      files: ['test/*.js']
    },
    concat: {
      dist: {
        src: ['./node_modules/q/q.js', './builds/commandant.js'],
        dest: './builds/commandant.q.js'
      }
    },
    min: {
      dist: {
        src: ['./builds/commandant.js'],
        dest: './builds/commandant.min.js'
      },
      dist_q: {
        src: ['./builds/commandant.q.js'],
        dest: './builds/commandant.q.min.js'
      },
      dist_noasync: {
        src: ['./builds/commandant.noasync.js'],
        dest: './builds/commandant.noasync.min.js'
      }
    },
    uglify: {
      mangle: { toplevel: false },
      squeeze: { dead_code: true },
      codegen: { beautify: false }
    },
    coffee: {
      app: {
        src: ['commandant.coffee'],
        dest: './builds/',
        options: {
          bare: false,
          comments: true
        }
      }
    }
  });

  grunt.registerTask('default', 'coffee lint test concat preprocess min');
};
