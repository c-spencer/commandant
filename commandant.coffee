class Commandant

  constructor: (@scope, opts = {}) ->
    @commands = {
      __compound:
        init: -> []
        run: (scope, data) =>
          for action in data
            @commands[action.name].run(scope, action.data)
          return
        update: (scope, prev_data, name, args...) =>
          command = @commands[name]
          data = command.init.apply(command, [@scope, args...])
          prev_data.push { name, data }
          @_run({ name, data }, 'run')
        undo: (scope, data) =>
          for action in data
            @commands[action.name].undo(scope, action.data)
          return
    }

    # Can generalise this when more options added.
    @opts = { pedantic: if opts.pedantic? then opts.pedantic else true }

    @stack = []
    @stack_idx = 0
    @_silent = false
    @_transient = false

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

  # Expose some information on the stack.
  stackStats: ->
    {
      length: @stack.length,
      position: @stack_idx
    }

  # Reset the Commandant.
  # By default it will unwind the actions on the stack.
  reset: (rollback=true) ->
    if rollback
      @undo() while @stack_idx
    else
      @stack_idx = 0
    @stack = []

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

    result = @_run({ name, data }, 'run')

    @_push({ name, data }) unless @_silent

    return result

  # Run the Commandant redos one step. Does nothing if at end of chain.
  redo: ->
    return if @stack_idx == @stack.length

    @_assert(!@_transient, 'Cannot redo while transient action active.')

    action = @stack[@stack_idx]
    @_run(action, 'run')
    ++@stack_idx

    @trigger?('redo', action)
    @onRedo?(action)

    return

  # Run the Commandant undos one step. Does nothing if at start of chain.
  undo: ->
    return if @stack_idx == 0

    @_assert(!@_transient, 'Cannot undo while transient action active.')

    --@stack_idx
    action = @stack[@stack_idx]
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
        command.update.apply(command, [@_scope(command, data), data, args...])
        return
      finish: =>
        @_push({ name, data })
        @_transient = false
        @_silent = false
        return ret_val
      cancel: =>
        command.undo(scope, data)
        @_transient = false
        @_silent = false
        return
    }

  # Convenice method for using the transient __compound Command.
  compound: -> @transient('__compound', [])

  # Private helpers

  # Resolve a commands scope.
  _scope: (command, data) ->
    if command.scope then command.scope(@scope, data) else @scope

  # Push an action onto the stack
  _push: (action) ->
    @stack.splice(@stack_idx, Infinity)
    @stack.push action
    @stack_idx = @stack.length

    @trigger?("execute", action)
    @onExecute?(action)

    return

  _assert: (val, message) ->
    if @opts.pedantic and !val
      throw message
    return

  # Helper method for running a method on an action.
  _run: (action, method) ->
    command = @commands[action.name]
    @silent(=> command[method](@_scope(command, action.data), action.data))

if typeof module != 'undefined'
  module.exports = Commandant
else if typeof define == 'function' and define.amd
  define(-> Commandant)
else
  window.Commandant = Commandant
