(function() {
  
;


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
      this._silence = false;
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

    Commandant.prototype.__silence = function(fn) {
      var result;
      if (this._silence) {
        result = fn();
      } else {
        this._silence = true;
        result = fn();
        this._silence = false;
      }
      return result;
    };

    Commandant.prototype.silent = Commandant.prototype._silence;

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
      if (this._silence || !this._agg(action)) {
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
      var args, command, data, name, ret_val;
      name = arguments[0], args = 2 <= arguments.length ? __slice.call(arguments, 1) : [];
      command = this.commands[name];
      this._assert(command.update != null, "Command " + name + " does not support transient calling.");
      data = command.init.apply(command, [this.scope].concat(__slice.call(args)));
      ret_val = this._run({
        name: name,
        data: data
      }, 'run');
      this._transient = {
        name: name,
        data: data,
        ret_val: ret_val
      };
    };

    Commandant.prototype.update = function() {
      var args;
      args = 1 <= arguments.length ? __slice.call(arguments, 0) : [];
      this._assert(this._transient, 'Cannot update without a transient action active.');
      return this._transient.data = this._run.apply(this, [this._transient, 'update'].concat(__slice.call(args)));
    };

    Commandant.prototype.finishTransient = function() {
      var action, ret_val;
      this._assert(this._transient, 'Cannot finishTransient without a transient action active.');
      action = {
        name: this._transient.name,
        data: this._transient.data
      };
      ret_val = this._transient.ret_val;
      this._transient = null;
      if (!this._agg(action)) {
        this._push(action);
      }
      return ret_val;
    };

    Commandant.prototype.cancelTransient = function() {
      var undo;
      this._assert(this._transient, 'Cannot cancelTransient without a transient action active.');
      undo = this._run(this._transient, 'undo');
      this._transient = null;
      return undo;
    };

    Commandant.prototype.captureCompound = function() {
      this._assert(!this._transient, 'Cannot captureCompound while transient action active.');
      return this._compound = [];
    };

    Commandant.prototype.finishCompound = function() {
      var cmds;
      this._assert(!this._transient, 'Cannot finishCompound while transient action active.');
      this._assert(this._compound, 'Cannot finishCompound without compound capture active.');
      cmds = this._compound;
      this._compound = null;
      this._push({
        name: '__compound',
        data: cmds
      });
    };

    Commandant.prototype.cancelCompound = function() {
      var result;
      this._assert(this._compound, 'Cannot cancelCompound without compound capture active.');
      result = this.commands['__compound'].undo(this.scope, this._compound);
      this._compound = null;
      return result;
    };

    Commandant.prototype._assert = function(val, message) {
      if (this.opts.pedantic && !val) {
        throw message;
      }
    };

    Commandant.prototype._run = function() {
      var action, args, command, method, scope,
        _this = this;
      action = arguments[0], method = arguments[1], args = 3 <= arguments.length ? __slice.call(arguments, 2) : [];
      command = this.commands[action.name];
      scope = command.scope ? command.scope(this.scope, action.data) : this.scope;
      return this.__silence(function() {
        return command[method].apply(command, [scope, action.data].concat(__slice.call(args)));
      });
    };

    return Commandant;

  })();

  
;


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
