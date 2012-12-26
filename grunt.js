module.exports = function (grunt) {
  grunt.loadNpmTasks('grunt-coffee');

  grunt.initConfig({
    lint: {
      all: ['grunt.js', './examples/scene.js', './test/*.js']
    },
    test: {
      files: ['test/*.js']
    },
    concat: {
      dist: {
        src: ['./node_modules/q/q.js', './commandant.js'],
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
          bare: false
        }
      }
    }
  });

  grunt.registerTask('default', 'coffee lint test concat min');
};
