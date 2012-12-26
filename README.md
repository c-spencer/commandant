# Commandant

This library implements a [Command Pattern](http://en.wikipedia.org/wiki/Command_pattern) based approach to managing the application and rewind of actions applied to some target object. It has no dependencies and should be flexible enough to be used in most scenarios requiring the ability to undo and redo actions.

## Use

Core usage centres around the use of `register`, `execute`, `undo` and `redo`.

``` javascript
// Create a Commandant scoped to our target
var keen = new Commandant(my_document);

// Register our command with the Commandant
keen.register('ADD_PARAGRAPH', addParagraphCommand);

// Run a command against the target
keen.execute('ADD_PARAGRAPH', 'This is some text for my new paragraph');

// Step forwards and backwards
keen.undo();
keen.redo();

// Can also package commands together into a reusable constructor
var DocumentCommandant = Commandant.define({});
DocumentCommandant.register('ADD_PARAGRAPH', addParagraphCommand);

var keen = new DocumentCommandant(my_document);
```

## Commands

Commandant is centred around the building and application of Commands. Commands are simply JavaScript objects satisfying the following interface:

``` javascript

var Command = {
  // Initialisation function run once, only when a command is executed (and not
  // on redo or undo). Should return the data to be used for undo and redo.
  init: function (scope, arg1, arg2, arg3, ...) {
    return undo_data;
  },

  // Runs a command forwards.
  run: function (scope, data) {
    return some_result;
  },

  // Runs a command backwards.
  undo: function (scope, data) { },

  // OPTIONAL: Allows command to be used transiently.
  // Should return the new data for the action. Does not implicitly call run(), so
  // side effects should be done explicitly. ('this' will be the command, so you can
  // reuse the run logic if needed using 'this.run(scope, data)')
  // *Can* modify in place and return the data, rather than a new object.
  update: function (scope, data, arg1, arg2, ...) { },

  // OPTIONAL: Allows a command to transform the scope seen by run, undo, update
  scope: function (scope, data) {
    return new_scope;
  },

  // OPTIONAL: Allows a command to aggregate itself, given a previous and new action.
  // prev and next are of form { name, data }, and aggregate should return the same form
  // or undefined if no aggregation.
  aggregate: function (prev, next) {
    return { name, data };
  }
}

```

## Transient Commands

Some commands may need updating after their initialisation, but before they are
recorded into the action chain. An example of this might be adding a new element
to a diagram. If you wanted to display a preview of the element in position
under the mouse before placement, you might allow the position for the
`CREATE_ELEMENT` command to be updated after initialisation. This allows you to
use the command in both an interactive and non-interactive way, with minimal
duplication of code.

``` javascript
// Create our element
var new_element_action = keen.transient('CREATE_ELEMENT', 'square', 50, 50);

// Update the x, y (as taken by the update function). This could reconfigure the
// element completely, but in this case it's specialised to just edit position.
new_element_action.update(40, 60);
new_element_action.update(50, 80);

// Completes the action, and records the final result. Can also run .cancel() to
// rollback the change and not have an action recorded. Return value is the
// result of the 'run' function just after initialisation.
new_element = new_element_action.finish();

// Can use the same command in a non-transient manner.
new_element_2 = keen.execute('CREATE_ELEMENT', 'circle', 100, 100);
```

## Compound Commands

Compound actions are groups of actions that are run and undone in a single step.
They are created via normal commands, with the Commandant put into capture mode
with `captureCompound` and `finishCompound`.

``` javascript
keen.captureCompound();
keen.execute('CREATE_ELEMENT', 'circle', 100, 100);
keen.execute('CREATE_ELEMENT', 'circle', 100, 100);
keen.execute('CREATE_ELEMENT', 'circle', 100, 100);
keen.finishCompound();
```

## Bound Commandants

Quite often you will have commands that apply to sub-objects in your document,
rather than at the document level itself. In this case, you may end up with code
where the first argument repeatedly specifies the target.

``` javascript
keen.execute('MOVE_ELEMENT', element_5, 60, 80);
keen.execute('MOVE_ELEMENT', element_5, 400, 100);
etc.
```

To help with this, you can create a bound proxy to a Commandant, that has some
of its arguments pre-filled. (Only `execute` and `transient` are available on
this proxy.)

``` javascript
var element_5_commandant = keen.bind(element_5);
element_5_commandant.execute('MOVE_ELEMENT', 60, 80);
element_5_commandant.execute('MOVE_ELEMENT', 400, 100);
etc.
```

## Events and Hooks

Commandant supports a number of hook functions and event triggers, but does not
itself bundle an Events library. To take advantage of events, simply mix in your
favourite library to the Commandant prototype. For example, with Backbone:

``` javascript
_.extend(Commandant.prototype, Backbone.Events);
```

Supported events/hooks:

```
onReset(rollback) / 'reset':
Triggered when the Commandant is reset.

onRegisterCommand(name, command) / 'register_command':
Triggered when a new command is registered.

onRedo(action) / 'redo':
Triggered when an action is redone.

onUndo(action) / 'undo':
Triggered when an action is undone.

onExecute(action) / 'execute':
Triggered when a command is executed, or a transient completes.
```

## Additional API

```
Commandant.reset(rollback)
Resets the actions in the Commandant. Rollback determines whether the actions in
the stack are undone, or simply cleared. Defaults to true.

Commandant.storeStats() : { length, position }
Returns an object detailing the length and position within the current action
stack.

Commandant.silent(fn)
Runs the given function with no recording of new actions (but still executing).
```

## Command Implementation Considerations

When a command is executed, any other executions caused by that execution will
run themselves, but will not be recorded.

When objects are created in commands, they should be identified and modified via
stable ids, rather than directly on the object. This is because if the object is
created inside the `run` of a command, each time it is run, a new object will be
generated. If you generate the id inside `init` and then use that, then you have
a stable reference to where the object is. `scope` particularly is useful for
hiding this detail when modifying objects (though not when creating).

For a concrete example of an implementation satisfying these constraints, see
`examples/scene.js`.

### Concurrency

When implementing commands, Commandant tries to provide safety through how its
API is defined, but cannot guarantee it. The following limitations are put in
place, unless you turn off pedantic mode. (`new Commandant(o, {pedantic: false}`)

- While a transient is active, the Commandant execute, redo, undo, and transient
  functions will all throw exceptions.
- While a compound is active, redo and undo will throw exceptions.

These are put in place to avoid, and make obvious, possible concurrency issues.

## Further Work

- More examples, particularly an interactive one.
- More documentation.
- Action Aggregation (e.g. automatic merging of several actions into one)
- Asynchronous Commands (based on promises)
- Action stack synchronisation and broadcast (for basic document collaboration)

## License

MIT License
