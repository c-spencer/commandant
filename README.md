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

  // OPTIONAL: Allows command to be used transiently (covered later)
  update: function (scope, data, arg1, arg2, ...) { },

  // OPTIONAL: Allows a command to transform the scope seen by run, undo, update
  scope: function (scope, data) {
    return new_scope;
  }
}

```

## Transitive Commands

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

// Can use the same command in a non-transitive manner.
new_element_2 = keen.execute('CREATE_ELEMENT', 'circle', 100, 100);
```

## Compound Commands

Compound actions are groups of actions that are run and undone in a single step.
They are implemented as a default command '__compound', with a helper function
Commandant.compound() for accessing it.

```
var compound = keen.compound();
compound.execute('CREATE_ELEMENT', 'circle', 100, 100);
compound.execute('CREATE_ELEMENT', 'circle', 100, 100);
compound.execute('CREATE_ELEMENT', 'circle', 100, 100);
compound.finish();
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

```
var element_5_commandant = keen.bind(element_5);
element_5_commandant.execute('MOVE_ELEMENT', 60, 80);
element_5_commandant.execute('MOVE_ELEMENT', 400, 100);
etc.
```

## Command Implementation Considerations

When a command is executed, any other executions caused by that execution will
run themselves, but will not be recorded. (This may change with a form of opt-in
automatic compound command collection.)

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
- TODO: while a compound is active, the same functions will also throw.

These are put in place to avoid, and make obvious, possible concurrency issues.

## Further Work

- More examples, particularly an interactive one.
- More documentation.
- Action Aggregation (e.g. automatic merging of several actions into one)
- Asynchronous Commands (based on promises)
- Action stack synchronisation and broadcast (for basic document collaboration)
