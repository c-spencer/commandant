if typeof require != 'undefined'
  try
    Q = require('q')
  catch exc


class StackStore
  constructor: ->
    @reset()

  record: (action) ->
    @stack.splice(@idx, Infinity)
    @stack.push action
    @idx = @stack.length

  getRedoActions: ->
    if @idx == @stack.length
      actions = []
    else
      actions = [@stack[@idx]]

    actions

  redo: (action) ->
    ++@idx

  undo: (action) ->
    --@idx

  reset: ->
    @stack = []
    @idx = 0

  getUndoAction: ->
    if @idx == 0
      action = null
    else
      action = @stack[@idx - 1]

    action

  stats: ->
    {
      length: @stack.length,
      position: @idx
    }


class Commandant
  constructor: (@scope, opts = {}) ->
    @commands = {
      __compound:
        run: (scope, data) =>
          for action in data
            @_run(action, 'run')
          return
        undo: (scope, data) =>
          data_rev = data.slice()
          data_rev.reverse()

          for action in data_rev
            @_run(action, 'undo')
          return
    }

    # Can generalise this when more options added.
    @opts = { pedantic: if opts.pedantic? then opts.pedantic else true }

    @store = new StackStore

    @_compound = null

  # Allow creation of new Commandants with predefined commands.
  @define: (commands={}) ->
    fn = (scope, opts) ->
      commander = new Commandant(scope, opts)
      for name, cmd of commands
        commander.register(name, cmd)
      commander

    fn.register = (name, command) ->
      commands[name] = command

    fn

  # Expose some information on the action store.
  storeStats: ->
    @store.stats()

  # Push an action
  _push: (action) ->
    if @_compound
      @_compound.push(action)
    else
      @store.record(action)
      @trigger?("execute", action)
      @onExecute?(action)

    return

  # Get the actions that redo could call.
  # If proceed is set, only return first one and advance the store.
  getRedoActions: (proceed = false) ->
    actions = @store.getRedoActions()
    if proceed
      action = actions[0]
      if !action
        return null
      @store.redo(action)
      return action
    else
      return actions

  # Get the action that undo could call, and rollback the store if proceed is true.
  getUndoAction: (proceed = false) ->
    action = @store.getUndoAction()
    @store.undo(action) if proceed and action
    action

  # Reset the Commandant.
  # By default it will unwind the actions.
  reset: (rollback=true) ->
    if rollback
      @undo() while @getUndoAction()
    @store.reset()

    @trigger?('reset', rollback)
    @onReset?(rollback)

    return

  # Register a new named command to be available for execution.
  register: (name, command) ->
    @commands[name] = command

    @trigger?('register_command', name, command)
    @onRegisterCommand?(name, command)

    return

  # Execute a function without recording any command executions.
  silent: (fn) ->
    if @_silent
      result = fn()
    else
      @_silent = true
      result = fn()
      @_silent = false

    return result

  # Create a proxy with partially bound arguments.
  # Doesn't support binding for compound command.
  bind: (scoped_args...) ->
    {
      execute: (name, args...) =>
        @execute.apply(@, [name, scoped_args..., args...])
      transient: (name, args...) =>
        @transient.apply(@, [name, scoped_args..., args...])
    }

  # Try and aggregate an action given the current state.
  _agg: (action) ->
    prev_action = if @_compound
      @_compound[@_compound.length - 1]
    else
      @getUndoAction()

    if prev_action
      if agg = @commands[prev_action.name].aggregate?(prev_action, action)
        prev_action.name = agg.name
        prev_action.data = agg.data
        return prev_action
    return

  # Execute a new command, with name and data.
  # Commands executed will be recorded and can execute other commands, but they
  # will not themselves be recorded.
  #
  # TODO: would auto-collection of executed subcommands into a compound action
  # be useful, or opaque/brittle? Could replace the __compound command.
  execute: (name, args...) ->
    @_assert(!@_transient, 'Cannot execute while transient action active.')

    command = @commands[name]
    data = command.init.apply(command, [@scope, args...])

    action = { name, data }

    result = @_run(action, 'run')

    if @_silent or !@_agg(action)
      @_push(action)

    return result

  # Run the Commandant redos one step. Does nothing if at end of chain.
  redo: ->
    @_assert(!@_transient, 'Cannot redo while transient action active.')
    @_assert(!@_compound, 'Cannot redo while compound action active.')

    action = @getRedoActions(true)
    return unless action
    @_run(action, 'run')

    @trigger?('redo', action)
    @onRedo?(action)

    return

  # Run the Commandant undos one step. Does nothing if at start of chain.
  undo: ->
    @_assert(!@_transient, 'Cannot undo while transient action active.')
    @_assert(!@_compound, 'Cannot undo while compound action active.')

    action = @getUndoAction(true)
    return unless action
    @_run(action, 'undo')

    @trigger?('undo', action)
    @onUndo?(action)

    return

  # Transient commands may update their data after being run for the first
  # time. The command named must support the `update` method.
  #
  # Useful for e.g. drag operations, where you want to record a single drag,
  # but update the final position many times before completion.
  #
  # No other commands, nor redo/undo, may be run while a transient is
  # active. This is for safety to ensure that there are no concurrency issues.
  transient: (name, args...) ->
    command = @commands[name]

    @_assert(command.update?,
      "Command #{name} does not support transient calling.")

    @_transient = true
    @_silent = true

    data = command.init.apply(command, [@scope, args...])
    ret_val = command.run(@_scope(command, data), data)

    return {
      update: (args...) =>
        data = command.update.apply(command, [@_scope(command, data), data, args...])
        return
      finish: =>
        @_transient = false
        @_silent = false

        action = { name, data }
        if !@_agg(action)
          @_push(action)

        return ret_val
      cancel: =>
        command.undo(scope, data)
        @_transient = false
        @_silent = false
        return
    }

  # Compound command capture
  captureCompound: ->
    @_assert(!@_transient, 'Cannot captureCompound while transient action active.')
    @_compound = []

  finishCompound: ->
    @_assert(!@_transient, 'Cannot finishCompound while transient action active.')
    cmds = @_compound
    @_compound = null

    @_push({ name: '__compound', data: cmds })
    return

  # Private helpers

  # Resolve a commands scope.
  _scope: (command, data) ->
    if command.scope then command.scope(@scope, data) else @scope

  _assert: (val, message) ->
    if @opts.pedantic and !val
      throw message
    return

  # Helper method for running a method on an action.
  _run: (action, method) ->
    command = @commands[action.name]
    @silent(=> command[method](@_scope(command, action.data), action.data))


# Asynchronous version, using the Q promise library.
class Commandant.Async extends Commandant

  constructor: ->
    super

    @commands = {
      __compound:
        run: (scope, data) =>
          result = Q.resolve(undefined)

          for action in data
            do (action) =>
              result = result.then => @_run(action, 'run')

          result
        undo: (scope, data) =>
          result = Q.resolve(undefined)

          data_rev = data.slice()
          data_rev.reverse()

          for action in data
            do (action) =>
              result = result.then => @_run(action, 'undo')

          result
    }

    if typeof Q == 'undefined'
      throw 'Cannot run in asynchronous mode without Q available.'

    @_running = null
    @_deferQueue = []

  silent: (fn) ->
    if @_silent
      promise = Q.resolve(fn())
    else
      @_silent = true
      promise = Q.resolve(fn())
      promise.fin =>
        @_silent = false

    promise

  # Defer a fn to be run with the Commandant as scope.
  _defer: (fn, args...) ->
    deferred = Q.defer()

    defer_fn = =>
      result_promise = Q.resolve(fn.apply(@, args))

      result_promise.then (result) ->
        deferred.resolve(result)

    @_deferQueue.push defer_fn

    if !@_running
      @_runDefer()

    deferred.promise

  # Consume the deferred function queue.
  _runDefer: ->
    return if @_running or @_deferQueue.length == 0

    next_fn = @_deferQueue.shift()

    @_running = next_fn()

    @_running.then =>
      @_running = null
      @_runDefer()
    , (err) =>
      @_running = null
      console.log("!! deferred function errored", err)

    return

  execute: (name, args...) ->
    @_defer(@_executeAsync, name, args)

  _executeAsync: (name, args) ->
    @_assert(!@_transient, 'Cannot execute while transient action active.')

    command = @commands[name]

    deferred = Q.defer()

    data_promise = Q.resolve(command.init.apply(command, [@scope, args...]))

    data_promise.then (data) =>
      action = { name, data }

      result_promise = Q.resolve(@_run(action, 'run'))

      result_promise.then (result) =>
        if @_silent or !@_agg(action)
          @_push(action)
        deferred.resolve(result)

    deferred.promise

  redo: ->
    @_defer(@_redoAsync)

  _redoAsync: ->
    @_assert(!@_transient, 'Cannot redo while transient action active.')
    @_assert(!@_compound, 'Cannot redo while compound action active.')

    action = @getRedoActions(true)
    return Q.resolve(undefined) unless action
    promise = Q.resolve(@_run(action, 'run'))

    promise.then =>
      @trigger?('redo', action)
      @onRedo?(action)

    promise

  undo: ->
    @_defer(@_undoAsync)

  _undoAsync: ->
    @_assert(!@_transient, 'Cannot undo while transient action active.')
    @_assert(!@_compound, 'Cannot undo while compound action active.')

    action = @getUndoAction(true)
    return Q.resolve(undefined) unless action
    promise = Q.resolve(@_run(action, 'undo'))

    promise.then =>
      @trigger?('undo', action)
      @onUndo?(action)

    promise

  captureCompound: ->
    @_defer(Commandant::captureCompound)

  finishCompound: ->
    @_defer(Commandant::finishCompound)

  transient: ->
    throw 'Transient not yet supported in Async mode'


if typeof module != 'undefined'
  module.exports = Commandant
else if typeof define == 'function' and define.amd
  define(-> Commandant)
else
  window.Commandant = Commandant
