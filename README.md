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
keen.transient('CREATE_ELEMENT', 'square', 50, 50);

// Update the x, y (as taken by the update function). This could reconfigure the
// element completely, but in this case it's specialised to just edit position.
keen.update(40, 60);
keen.update(50, 80);

// Completes the action, and records the final result. Can also run
// .cancelTransient() to rollback the change and not have an action recorded.
// Return value is the result of the 'run' function just after initialisation.
new_element = keen.finishTransient();

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

onRedo(action) / 'redo':
Triggered when an action is redone.

onUndo(action) / 'undo':
Triggered when an action is undone.

onExecute(action) / 'execute':
Triggered when a command is executed, or a transient completes.

onUpdate(action) / 'update':
Triggered when a transient action is updated.

onChange(name, arg) / 'change':
Triggered whenever any of the above are triggered.
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

## Asynchronous Commands

Commandant can operate in an aynchronous manner, which depends upon the [Q
promise library](https://github.com/kriskowal/q) (and a version of Commandant
bundling Q is provided for convenience). To use this mode, use the
`Commandant.Async` constructor. The API remains the same, and synchronous
commands will not need modification, however almost all API functions will now
return promises rather than values. Commands and operations will be run in the
order they are called.

To implement an Asynchronous Command, simply return a promise from any of the
command methods (apart from `scope` or `aggregate`).

``` javascript
keen.execute('ASYNC_COMMAND', 50);
keen.execute('ASYNC_COMMAND', 100).then(function () {
  // The two commands have been executed.
  keen.transient('ASYNC_COMMAND', 20);
  keen.update(40).then(function () {
    console.log('Updated to 40.');
  });
  keen.update(70);
  return keen.finishTransient();
}).then(function () {
  // The transient command has been executed.
});
```

This is still a fresh feature, and the behaviour/sementics around failure are
still to be decided (whether a failed command causes all queued actions to
abort, or to just skip that action.)

## Command Implementation Considerations

When a command is executed, any other executions caused by that execution will
run themselves, but will not be recorded.

When objects are created in commands, they should be identified and modified via
stable ids, rather than directly on the object. This is because if the object is
created inside the `run` of a command, each time it is run, a new object will be
generated. If you generate the id inside `init` and then use that, then you have
a stable reference to where the object is. `scope` particularly is useful for
hiding this detail when modifying objects (though not when creating).

### Concurrency

When implementing commands, Commandant tries to provide safety through how its
API is defined, but cannot guarantee it. The following limitations are put in
place, unless you turn off pedantic mode. (`new Commandant(o, {pedantic: false}`)

- While a transient is active, `execute`, `redo`, `undo`, and `transient`,
  `captureCompound` and `finishCompound` will throw exceptions.
- While a compound is active, redo and undo will throw exceptions.

These are put in place to avoid, and make obvious, possible concurrency issues.

## Filesize

Example filesizes, not guaranteed to be completely current.

```
File "./builds/commandant.noasync.min.js" created.
Uncompressed size: 11384 bytes.
Compressed size: 1623 bytes gzipped (6362 bytes minified).

File "./builds/commandant.min.js" created.
Uncompressed size: 19177 bytes.
Compressed size: 2491 bytes gzipped (10671 bytes minified).

File "./builds/commandant.q.min.js" created.
Uncompressed size: 68099 bytes.
Compressed size: 5994 bytes gzipped (21677 bytes minified).
```

## Further Work

- More examples, particularly an interactive one.
- More documentation.
- Consistent/helpful behaviour for asynchronous errors.
- Action stack synchronisation.

## License

MIT License
