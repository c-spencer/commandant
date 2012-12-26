var Commandant = require('../commandant');
var Q = require('q');

exports['Basic Commandant'] = {
  'basic operations': function (test) {

    // Setup a target and sub object for testing scope.
    var test_target = {};
    var sub_scope = {};
    test_target.sub_scope = sub_scope;

    var keen = new Commandant(test_target);

    var counters = { init: 0, run: 0, undo: 0, scope: 0, update: 0, aggregate: 0 };

    keen.register('TEST_COMMAND', {
      init: function (scope, arg1, arg2) {
        ++counters.init;
        test.equal(scope, test_target);
        return { arg1: arg1, arg2: arg2, sum: arg1 + arg2 };
      },
      scope: function (scope) {
        ++counters.scope;
        test.equal(scope, test_target);
        return scope.sub_scope;
      },
      run: function (scope, data) {
        ++counters.run;
        test.equal(scope, sub_scope);
        test.equal(data.sum, data.arg1 + data.arg2);
        return 70;
      },
      undo: function (scope, data) {
        ++counters.undo;
        test.equal(scope, sub_scope);
        test.equal(data.sum, data.arg1 + data.arg2);
      },
      update: function (scope, data, arg1, arg2) {
        ++counters.update;
        test.equal(data.sum, data.arg1 + data.arg2);
        test.equal(scope, sub_scope);
        return {
          arg1: arg1,
          arg2: arg2,
          sum: arg1 + arg2
        };
      },
      aggregate: function (prev, next) {
        ++counters.aggregate;
        if (next.data.sum == 150) { // Arbitrary trigger for testing.
          return {
            name: prev.name,
            data: {
              arg1: prev.data.arg1 + next.data.arg1,
              arg2: prev.data.arg2 + next.data.arg2,
              sum: prev.data.sum + next.data.sum
            }
          };
        } else {
          return null;
        }
      }
    });

    var trans = keen.transient('TEST_COMMAND', 10, 20);
    test.deepEqual(counters, { init: 1, run: 1, undo: 0, scope: 1, update: 0, aggregate: 0 });

    trans.update(20, 30);
    test.deepEqual(counters, { init: 1, run: 1, undo: 0, scope: 2, update: 1, aggregate: 0 });

    var trans_result = trans.finish();
    test.equal(trans_result, 70);
    test.deepEqual(counters, { init: 1, run: 1, undo: 0, scope: 2, update: 1, aggregate: 0 });

    var exec_result = keen.execute('TEST_COMMAND', 10, 20);
    test.equal(exec_result, 70);
    test.deepEqual(counters, { init: 2, run: 2, undo: 0, scope: 3, update: 1, aggregate: 1 });

    keen.undo();
    test.deepEqual(counters, { init: 2, run: 2, undo: 1, scope: 4, update: 1, aggregate: 1 });

    keen.undo();
    test.deepEqual(counters, { init: 2, run: 2, undo: 2, scope: 5, update: 1, aggregate: 1 });
    test.deepEqual(keen.storeStats(), { length: 2, position: 0 });

    keen.undo();
    test.deepEqual(counters, { init: 2, run: 2, undo: 2, scope: 5, update: 1, aggregate: 1 });
    test.deepEqual(keen.storeStats(), { length: 2, position: 0 });

    keen.redo();
    test.deepEqual(counters, { init: 2, run: 3, undo: 2, scope: 6, update: 1, aggregate: 1 });

    keen.redo();
    test.deepEqual(counters, { init: 2, run: 4, undo: 2, scope: 7, update: 1, aggregate: 1 });
    test.deepEqual(keen.storeStats(), { length: 2, position: 2 });

    keen.redo();
    test.deepEqual(counters, { init: 2, run: 4, undo: 2, scope: 7, update: 1, aggregate: 1 });
    test.deepEqual(keen.storeStats(), { length: 2, position: 2 });

    keen.reset();
    test.deepEqual(counters, { init: 2, run: 4, undo: 4, scope: 9, update: 1, aggregate: 1 });

    test.deepEqual(keen.storeStats(), { length: 0, position: 0 });

    // Aggregation tests.
    keen.execute('TEST_COMMAND', 10, 20);
    test.deepEqual(keen.getUndoAction(),
                    { name: 'TEST_COMMAND', data: { arg1: 10, arg2: 20, sum: 30 }});

    keen.execute('TEST_COMMAND', 100, 50);
    test.deepEqual(keen.getUndoAction(),
                    { name: 'TEST_COMMAND', data: { arg1: 110, arg2: 70, sum: 180 }});

    var new_trans = keen.transient('TEST_COMMAND', 10, 20);
    test.deepEqual(keen.getUndoAction(),
                    { name: 'TEST_COMMAND', data: { arg1: 110, arg2: 70, sum: 180 }});

    new_trans.update(50, 100);
    new_trans.finish();
    test.deepEqual(keen.getUndoAction(),
                    { name: 'TEST_COMMAND', data: { arg1: 160, arg2: 170, sum: 330 }});

    test.deepEqual(keen.storeStats(), { length: 1, position: 1 });
    test.deepEqual(counters, { init: 5, run: 7, undo: 4, scope: 13, update: 2, aggregate: 3 });

    keen.reset(false);
    test.deepEqual(keen.storeStats(), { length: 0, position: 0 });
    test.deepEqual(counters, { init: 5, run: 7, undo: 4, scope: 13, update: 2, aggregate: 3 });

    keen.captureCompound();
    keen.execute('TEST_COMMAND', 1, 2);
    keen.execute('TEST_COMMAND', 2, 3);
    keen.execute('TEST_COMMAND', 3, 4);
    keen.finishCompound();

    test.deepEqual(keen.storeStats(), { length: 1, position: 1 });
    test.deepEqual(counters, { init: 8, run: 10, undo: 4, scope: 16, update: 2, aggregate: 5 });

    keen.undo();
    test.deepEqual(counters, { init: 8, run: 10, undo: 7, scope: 19, update: 2, aggregate: 5 });

    keen.redo();
    test.deepEqual(counters, { init: 8, run: 13, undo: 7, scope: 22, update: 2, aggregate: 5 });

    keen.execute('TEST_COMMAND', 5, 6);
    test.deepEqual(counters, { init: 9, run: 14, undo: 7, scope: 23, update: 2, aggregate: 5 });

    keen.captureCompound();
    var c_trans = keen.transient('TEST_COMMAND', 1, 2);
    c_trans.update(3, 4);
    c_trans.finish();
    keen.finishCompound();
    test.deepEqual(counters, { init: 10, run: 15, undo: 7, scope: 25, update: 3, aggregate: 5 });

    test.done();
  },
  'async operations': function (test) {
    var test_target = {data: 0};
    var keen = new Commandant.Async(test_target);

    var counters = { init: 0, run: 0, undo: 0, scope: 0, update: 0, aggregate: 0 };

    test.expect(17);

    keen.register('ASYNC_COMMAND', {
      init: function (scope, arg) {
        ++counters.init;
        var deferred = Q.defer();

        setTimeout(function () {
          deferred.resolve(arg);
        }, 5);

        return deferred.promise;
      },
      scope: function (scope) {
        ++counters.scope;
        return scope;
      },
      run: function (scope, data) {
        ++counters.run;

        var deferred = Q.defer();

        setTimeout(function () {
          scope.data += data + 10;
          deferred.resolve(scope.data);
        }, 5);

        return deferred.promise;
      },
      undo: function (scope, data) {
        ++counters.undo;
        scope.data -= data + 10;
      }
    });

    result1 = keen.execute('ASYNC_COMMAND', 50);
    test.deepEqual(counters, { init: 1, run: 0, undo: 0, scope: 0, update: 0, aggregate: 0 });

    result2 = keen.execute('ASYNC_COMMAND', 90);
    test.deepEqual(counters, { init: 1, run: 0, undo: 0, scope: 0, update: 0, aggregate: 0 });

    result1.then(function (d) {
      test.deepEqual(counters, { init: 1, run: 1, undo: 0, scope: 1, update: 0, aggregate: 0 });

      test.equal(d, 60);
      test.equal(test_target.data, 60);
    });

    result2.then(function (d) {
      test.deepEqual(counters, { init: 2, run: 2, undo: 0, scope: 2, update: 0, aggregate: 0 });

      test.equal(d, 160);
      test.equal(test_target.data, 160);
    });

    keen.undo().then(function () {
      test.equal(test_target.data, 60);
    });

    keen.undo().then(function () {
      test.equal(test_target.data, 0);
    });

    keen.undo().then(function () {
      test.equal(test_target.data, 0);
    });

    keen.redo().then(function () {
      test.equal(test_target.data, 60);
    });

    keen.redo().then(function () {
      test.equal(test_target.data, 160);
    });

    keen.redo().then(function () {
      test.equal(test_target.data, 160);
    });

    // Test chained syntax
    keen.execute('ASYNC_COMMAND', 10).then(function (data) {
      test.equal(test_target.data, 180);
      test.equal(data, 180);
      return keen.execute('ASYNC_COMMAND', 10);
    }).then(function () {
      test.equal(test_target.data, 200);
      test.done();
    });

  }
};
