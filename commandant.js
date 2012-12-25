(function() {
  var Commandant, StackStore,
    __slice = [].slice;

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
          init: function() {
            return [];
          },
          run: function(scope, data) {
            var action, _i, _len;
            for (_i = 0, _len = data.length; _i < _len; _i++) {
              action = data[_i];
              _this.commands[action.name].run(scope, action.data);
            }
          },
          update: function() {
            var args, command, data, name, prev_data, scope;
            scope = arguments[0], prev_data = arguments[1], name = arguments[2], args = 4 <= arguments.length ? __slice.call(arguments, 3) : [];
            command = _this.commands[name];
            data = command.init.apply(command, [_this.scope].concat(__slice.call(args)));
            prev_data.push({
              name: name,
              data: data
            });
            return _this._run({
              name: name,
              data: data
            }, 'run');
          },
          undo: function(scope, data) {
            var action, _i, _len;
            for (_i = 0, _len = data.length; _i < _len; _i++) {
              action = data[_i];
              _this.commands[action.name].undo(scope, action.data);
            }
          }
        }
      };
      this.opts = {
        pedantic: opts.pedantic != null ? opts.pedantic : true
      };
      this.store = new StackStore;
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
      this.store.record(action);
      if (typeof this.trigger === "function") {
        this.trigger("execute", action);
      }
      if (typeof this.onExecute === "function") {
        this.onExecute(action);
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

    Commandant.prototype.execute = function() {
      var args, command, data, name, result;
      name = arguments[0], args = 2 <= arguments.length ? __slice.call(arguments, 1) : [];
      this._assert(!this._transient, 'Cannot execute while transient action active.');
      command = this.commands[name];
      data = command.init.apply(command, [this.scope].concat(__slice.call(args)));
      result = this._run({
        name: name,
        data: data
      }, 'run');
      if (!this._silent) {
        this._push({
          name: name,
          data: data
        });
      }
      return result;
    };

    Commandant.prototype.redo = function() {
      var action;
      this._assert(!this._transient, 'Cannot redo while transient action active.');
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
          command.update.apply(command, [_this._scope(command, data), data].concat(__slice.call(args)));
        },
        finish: function() {
          _this._push({
            name: name,
            data: data
          });
          _this._transient = false;
          _this._silent = false;
          return ret_val;
        },
        cancel: function() {
          command.undo(scope, data);
          _this._transient = false;
          _this._silent = false;
        }
      };
    };

    Commandant.prototype.compound = function() {
      return this.transient('__compound', []);
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
