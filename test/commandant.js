var Commandant = require('../commandant');

exports['Basic Commandant'] = {
  'basic operations': function (test) {

    // Setup a target and sub object for testing scope.
    var test_target = {};
    var sub_scope = {};
    test_target.sub_scope = sub_scope;

    var keen = new Commandant(test_target);

    var counters = { init: 0, run: 0, undo: 0, scope: 0, update: 0 };

    keen.register('TEST_COMMAND', {
      init: function (scope, arg1, arg2) {
        ++counters.init;
        test.equal(arg1, 10);
        test.equal(arg2, 20);
        test.equal(scope, test_target);
        return 50;
      },
      scope: function (scope) {
        ++counters.scope;
        test.equal(scope, test_target);
        return scope.sub_scope;
      },
      run: function (scope, data) {
        ++counters.run;
        test.equal(scope, sub_scope);
        test.equal(data, 50);
        return 70;
      },
      undo: function (scope, data) {
        ++counters.undo;
        test.equal(scope, sub_scope);
        test.equal(data, 50);
      },
      update: function (scope, data, arg1, arg2) {
        ++counters.update;
        test.equal(data, 50);
        test.equal(arg1, 20);
        test.equal(arg2, 30);
        test.equal(scope, sub_scope);
      }
    });

    var trans = keen.transient('TEST_COMMAND', 10, 20);
    test.deepEqual(counters, { init: 1, run: 1, undo: 0, scope: 1, update: 0 });

    trans.update(20, 30);
    test.deepEqual(counters, { init: 1, run: 1, undo: 0, scope: 2, update: 1 });

    var trans_result = trans.finish();
    test.equal(trans_result, 70);
    test.deepEqual(counters, { init: 1, run: 1, undo: 0, scope: 2, update: 1 });

    var exec_result = keen.execute('TEST_COMMAND', 10, 20);
    test.equal(exec_result, 70);
    test.deepEqual(counters, { init: 2, run: 2, undo: 0, scope: 3, update: 1 });

    keen.undo();
    test.deepEqual(counters, { init: 2, run: 2, undo: 1, scope: 4, update: 1 });

    keen.undo();
    test.deepEqual(counters, { init: 2, run: 2, undo: 2, scope: 5, update: 1 });
    test.deepEqual(keen.storeStats(), { length: 2, position: 0 });

    keen.undo();
    test.deepEqual(counters, { init: 2, run: 2, undo: 2, scope: 5, update: 1 });
    test.deepEqual(keen.storeStats(), { length: 2, position: 0 });

    keen.redo();
    test.deepEqual(counters, { init: 2, run: 3, undo: 2, scope: 6, update: 1 });

    keen.redo();
    test.deepEqual(counters, { init: 2, run: 4, undo: 2, scope: 7, update: 1 });
    test.deepEqual(keen.storeStats(), { length: 2, position: 2 });

    keen.redo();
    test.deepEqual(counters, { init: 2, run: 4, undo: 2, scope: 7, update: 1 });
    test.deepEqual(keen.storeStats(), { length: 2, position: 2 });

    keen.reset();
    test.deepEqual(counters, { init: 2, run: 4, undo: 4, scope: 9, update: 1 });

    test.deepEqual(keen.storeStats(), { length: 0, position: 0 });

    test.done();
  }
};
