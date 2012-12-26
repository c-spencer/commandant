(function() {
  var Commandant, Q, StackStore,
    __slice = [].slice,
    __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  if (typeof require !== 'undefined') {
    try {
      Q = require('q');
    } catch (exc) {

    }
  }

  StackStore = (function() {

    function StackStore() {
      this.reset();
    }

    StackStore.prototype.record = function(action) {
      this.stack.splice(this.idx, Infinity);
      this.stack.push(action);
      return this.idx = this.stack.length;
    };

    StackStore.prototype.getRedoActions = function() {
      var actions;
      if (this.idx === this.stack.length) {
        actions = [];
      } else {
        actions = [this.stack[this.idx]];
      }
      return actions;
    };

    StackStore.prototype.redo = function(action) {
      return ++this.idx;
    };

    StackStore.prototype.undo = function(action) {
      return --this.idx;
    };

    StackStore.prototype.reset = function() {
      this.stack = [];
      return this.idx = 0;
    };

    StackStore.prototype.getUndoAction = function() {
      var action;
      if (this.idx === 0) {
        action = null;
      } else {
        action = this.stack[this.idx - 1];
      }
      return action;
    };

    StackStore.prototype.stats = function() {
      return {
        length: this.stack.length,
        position: this.idx
      };
    };

    return StackStore;

  })();

  Commandant = (function() {

    function Commandant(scope, opts) {
      var _this = this;
      this.scope = scope;
      if (opts == null) {
        opts = {};
      }
      this.commands = {
        __compound: {
          run: function(scope, data) {
            var action, _i, _len;
            for (_i = 0, _len = data.length; _i < _len; _i++) {
              action = data[_i];
              _this._run(action, 'run');
            }
          },
          undo: function(scope, data) {
            var action, data_rev, _i, _len;
            data_rev = data.slice();
            data_rev.reverse();
            for (_i = 0, _len = data_rev.length; _i < _len; _i++) {
              action = data_rev[_i];
              _this._run(action, 'undo');
            }
          }
        }
      };
      this.opts = {
        pedantic: opts.pedantic != null ? opts.pedantic : true
      };
      this.store = new StackStore;
      this._compound = null;
    }

    Commandant.define = function(commands) {
      var fn;
      if (commands == null) {
        commands = {};
      }
      fn = function(scope, opts) {
        var cmd, commander, name;
        commander = new Commandant(scope, opts);
        for (name in commands) {
          cmd = commands[name];
          commander.register(name, cmd);
        }
        return commander;
      };
      fn.register = function(name, command) {
        return commands[name] = command;
      };
      return fn;
    };

    Commandant.prototype.storeStats = function() {
      return this.store.stats();
    };

    Commandant.prototype._push = function(action) {
      if (this._compound) {
        this._compound.push(action);
      } else {
        this.store.record(action);
        if (typeof this.trigger === "function") {
          this.trigger("execute", action);
        }
        if (typeof this.onExecute === "function") {
          this.onExecute(action);
        }
      }
    };

    Commandant.prototype.getRedoActions = function(proceed) {
      var action, actions;
      if (proceed == null) {
        proceed = false;
      }
      actions = this.store.getRedoActions();
      if (proceed) {
        action = actions[0];
        if (!action) {
          return null;
        }
        this.store.redo(action);
        return action;
      } else {
        return actions;
      }
    };

    Commandant.prototype.getUndoAction = function(proceed) {
      var action;
      if (proceed == null) {
        proceed = false;
      }
      action = this.store.getUndoAction();
      if (proceed && action) {
        this.store.undo(action);
      }
      return action;
    };

    Commandant.prototype.reset = function(rollback) {
      if (rollback == null) {
        rollback = true;
      }
      if (rollback) {
        while (this.getUndoAction()) {
          this.undo();
        }
      }
      this.store.reset();
      if (typeof this.trigger === "function") {
        this.trigger('reset', rollback);
      }
      if (typeof this.onReset === "function") {
        this.onReset(rollback);
      }
    };

    Commandant.prototype.register = function(name, command) {
      this.commands[name] = command;
      if (typeof this.trigger === "function") {
        this.trigger('register_command', name, command);
      }
      if (typeof this.onRegisterCommand === "function") {
        this.onRegisterCommand(name, command);
      }
    };

    Commandant.prototype.silent = function(fn) {
      var result;
      if (this._silent) {
        result = fn();
      } else {
        this._silent = true;
        result = fn();
        this._silent = false;
      }
      return result;
    };

    Commandant.prototype.bind = function() {
      var scoped_args,
        _this = this;
      scoped_args = 1 <= arguments.length ? __slice.call(arguments, 0) : [];
      return {
        execute: function() {
          var args, name;
          name = arguments[0], args = 2 <= arguments.length ? __slice.call(arguments, 1) : [];
          return _this.execute.apply(_this, [name].concat(__slice.call(scoped_args), __slice.call(args)));
        },
        transient: function() {
          var args, name;
          name = arguments[0], args = 2 <= arguments.length ? __slice.call(arguments, 1) : [];
          return _this.transient.apply(_this, [name].concat(__slice.call(scoped_args), __slice.call(args)));
        }
      };
    };

    Commandant.prototype._agg = function(action) {
      var agg, prev_action, _base;
      prev_action = this._compound ? this._compound[this._compound.length - 1] : this.getUndoAction();
      if (prev_action) {
        if (agg = typeof (_base = this.commands[prev_action.name]).aggregate === "function" ? _base.aggregate(prev_action, action) : void 0) {
          prev_action.name = agg.name;
          prev_action.data = agg.data;
          return prev_action;
        }
      }
    };

    Commandant.prototype.execute = function() {
      var action, args, command, data, name, result;
      name = arguments[0], args = 2 <= arguments.length ? __slice.call(arguments, 1) : [];
      this._assert(!this._transient, 'Cannot execute while transient action active.');
      command = this.commands[name];
      data = command.init.apply(command, [this.scope].concat(__slice.call(args)));
      action = {
        name: name,
        data: data
      };
      result = this._run(action, 'run');
      if (this._silent || !this._agg(action)) {
        this._push(action);
      }
      return result;
    };

    Commandant.prototype.redo = function() {
      var action;
      this._assert(!this._transient, 'Cannot redo while transient action active.');
      this._assert(!this._compound, 'Cannot redo while compound action active.');
      action = this.getRedoActions(true);
      if (!action) {
        return;
      }
      this._run(action, 'run');
      if (typeof this.trigger === "function") {
        this.trigger('redo', action);
      }
      if (typeof this.onRedo === "function") {
        this.onRedo(action);
      }
    };

    Commandant.prototype.undo = function() {
      var action;
      this._assert(!this._transient, 'Cannot undo while transient action active.');
      this._assert(!this._compound, 'Cannot undo while compound action active.');
      action = this.getUndoAction(true);
      if (!action) {
        return;
      }
      this._run(action, 'undo');
      if (typeof this.trigger === "function") {
        this.trigger('undo', action);
      }
      if (typeof this.onUndo === "function") {
        this.onUndo(action);
      }
    };

    Commandant.prototype.transient = function() {
      var args, command, data, name, ret_val,
        _this = this;
      name = arguments[0], args = 2 <= arguments.length ? __slice.call(arguments, 1) : [];
      command = this.commands[name];
      this._assert(command.update != null, "Command " + name + " does not support transient calling.");
      this._transient = true;
      this._silent = true;
      data = command.init.apply(command, [this.scope].concat(__slice.call(args)));
      ret_val = command.run(this._scope(command, data), data);
      return {
        update: function() {
          var args;
          args = 1 <= arguments.length ? __slice.call(arguments, 0) : [];
          data = command.update.apply(command, [_this._scope(command, data), data].concat(__slice.call(args)));
        },
        finish: function() {
          var action;
          _this._transient = false;
          _this._silent = false;
          action = {
            name: name,
            data: data
          };
          if (!_this._agg(action)) {
            _this._push(action);
          }
          return ret_val;
        },
        cancel: function() {
          command.undo(scope, data);
          _this._transient = false;
          _this._silent = false;
        }
      };
    };

    Commandant.prototype.captureCompound = function() {
      this._assert(!this._transient, 'Cannot captureCompound while transient action active.');
      return this._compound = [];
    };

    Commandant.prototype.finishCompound = function() {
      var cmds;
      this._assert(!this._transient, 'Cannot finishCompound while transient action active.');
      cmds = this._compound;
      this._compound = null;
      this._push({
        name: '__compound',
        data: cmds
      });
    };

    Commandant.prototype._scope = function(command, data) {
      if (command.scope) {
        return command.scope(this.scope, data);
      } else {
        return this.scope;
      }
    };

    Commandant.prototype._assert = function(val, message) {
      if (this.opts.pedantic && !val) {
        throw message;
      }
    };

    Commandant.prototype._run = function(action, method) {
      var command,
        _this = this;
      command = this.commands[action.name];
      return this.silent(function() {
        return command[method](_this._scope(command, action.data), action.data);
      });
    };

    return Commandant;

  })();

  Commandant.Async = (function(_super) {

    __extends(Async, _super);

    function Async() {
      var _this = this;
      Async.__super__.constructor.apply(this, arguments);
      this.commands = {
        __compound: {
          run: function(scope, data) {
            var action, result, _fn, _i, _len;
            result = Q.resolve(void 0);
            _fn = function(action) {
              return result = result.then(function() {
                return _this._run(action, 'run');
              });
            };
            for (_i = 0, _len = data.length; _i < _len; _i++) {
              action = data[_i];
              _fn(action);
            }
            return result;
          },
          undo: function(scope, data) {
            var action, data_rev, result, _fn, _i, _len;
            result = Q.resolve(void 0);
            data_rev = data.slice();
            data_rev.reverse();
            _fn = function(action) {
              return result = result.then(function() {
                return _this._run(action, 'undo');
              });
            };
            for (_i = 0, _len = data.length; _i < _len; _i++) {
              action = data[_i];
              _fn(action);
            }
            return result;
          }
        }
      };
      if (typeof Q === 'undefined') {
        throw 'Cannot run in asynchronous mode without Q available.';
      }
      this._running = null;
      this._deferQueue = [];
    }

    Async.prototype.silent = function(fn) {
      var promise,
        _this = this;
      if (this._silent) {
        promise = Q.resolve(fn());
      } else {
        this._silent = true;
        promise = Q.resolve(fn());
        promise.fin(function() {
          return _this._silent = false;
        });
      }
      return promise;
    };

    Async.prototype._defer = function() {
      var args, defer_fn, deferred, fn,
        _this = this;
      fn = arguments[0], args = 2 <= arguments.length ? __slice.call(arguments, 1) : [];
      deferred = Q.defer();
      defer_fn = function() {
        var result_promise;
        result_promise = Q.resolve(fn.apply(_this, args));
        return result_promise.then(function(result) {
          return deferred.resolve(result);
        });
      };
      this._deferQueue.push(defer_fn);
      if (!this._running) {
        this._runDefer();
      }
      return deferred.promise;
    };

    Async.prototype._runDefer = function() {
      var next_fn,
        _this = this;
      if (this._running || this._deferQueue.length === 0) {
        return;
      }
      next_fn = this._deferQueue.shift();
      this._running = next_fn();
      this._running.then(function() {
        _this._running = null;
        return _this._runDefer();
      }, function(err) {
        _this._running = null;
        return console.log("!! deferred function errored", err);
      });
    };

    Async.prototype.execute = function() {
      var args, name;
      name = arguments[0], args = 2 <= arguments.length ? __slice.call(arguments, 1) : [];
      return this._defer(this._executeAsync, name, args);
    };

    Async.prototype._executeAsync = function(name, args) {
      var command, data_promise, deferred,
        _this = this;
      this._assert(!this._transient, 'Cannot execute while transient action active.');
      command = this.commands[name];
      deferred = Q.defer();
      data_promise = Q.resolve(command.init.apply(command, [this.scope].concat(__slice.call(args))));
      data_promise.then(function(data) {
        var action, result_promise;
        action = {
          name: name,
          data: data
        };
        result_promise = Q.resolve(_this._run(action, 'run'));
        return result_promise.then(function(result) {
          if (_this._silent || !_this._agg(action)) {
            _this._push(action);
          }
          return deferred.resolve(result);
        });
      });
      return deferred.promise;
    };

    Async.prototype.redo = function() {
      return this._defer(this._redoAsync);
    };

    Async.prototype._redoAsync = function() {
      var action, promise,
        _this = this;
      this._assert(!this._transient, 'Cannot redo while transient action active.');
      this._assert(!this._compound, 'Cannot redo while compound action active.');
      action = this.getRedoActions(true);
      if (!action) {
        return Q.resolve(void 0);
      }
      promise = Q.resolve(this._run(action, 'run'));
      promise.then(function() {
        if (typeof _this.trigger === "function") {
          _this.trigger('redo', action);
        }
        return typeof _this.onRedo === "function" ? _this.onRedo(action) : void 0;
      });
      return promise;
    };

    Async.prototype.undo = function() {
      return this._defer(this._undoAsync);
    };

    Async.prototype._undoAsync = function() {
      var action, promise,
        _this = this;
      this._assert(!this._transient, 'Cannot undo while transient action active.');
      this._assert(!this._compound, 'Cannot undo while compound action active.');
      action = this.getUndoAction(true);
      if (!action) {
        return Q.resolve(void 0);
      }
      promise = Q.resolve(this._run(action, 'undo'));
      promise.then(function() {
        if (typeof _this.trigger === "function") {
          _this.trigger('undo', action);
        }
        return typeof _this.onUndo === "function" ? _this.onUndo(action) : void 0;
      });
      return promise;
    };

    Async.prototype.captureCompound = function() {
      return this._defer(Commandant.prototype.captureCompound);
    };

    Async.prototype.finishCompound = function() {
      return this._defer(Commandant.prototype.finishCompound);
    };

    Async.prototype.transient = function() {
      throw 'Transient not yet supported in Async mode';
    };

    return Async;

  })(Commandant);

  if (typeof module !== 'undefined') {
    module.exports = Commandant;
  } else if (typeof define === 'function' && define.amd) {
    define(function() {
      return Commandant;
    });
  } else {
    window.Commandant = Commandant;
  }

}).call(this);
