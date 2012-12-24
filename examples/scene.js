Commandant = require('../commandant');

// Setup a specialised Commander constructor
var SceneCommandant = Commandant.define();

// Register default actions
SceneCommandant.register('POINT_ADD', {
  init: function (canvas, x, y) {
    return {
      id: ++canvas.id_counter,
      x: x,
      y: y
    };
  },

  update: function (canvas, data, x, y) {
    var point = canvas.points[data.id];
    point.x = x;
    point.y = y;
  },

  run: function (canvas, data) {
    var point = canvas.points[data.id] = { id: data.id, x: data.x, y: data.y };
    return point;
  },

  undo: function (canvas, data) {
    delete canvas.points[data.id];
  }
});

SceneCommandant.register('POINT_MOVE_TO', {
  init: function (canvas, id, x, y) {
    var point;

    if (typeof id == 'object') {
      point = id;
      id = point.id;
    } else
      point = canvas.points[id];

    if (x === undefined) x = point.x;
    if (y === undefined) y = point.y;

    return {
      id: id,
      before: { x: point.x, y: point.y },
      after: { x: x, y: y }
    };
  },

  scope: function (canvas, data) {
    return canvas.points[data.id];
  },

  update: function (point, data, x, y) {
    data.after = { x: x, y: y };
    this.run(point, data);
  },

  run: function (point, data) {
    point.x = data.after.x;
    point.y = data.after.y;
  },

  undo: function (point, data) {
    point.x = data.before.x;
    point.y = data.before.y;
  }
});

SceneCommandant.register('POINT_MOVE', {
  init: function (canvas, id, dx, dy) {
    if (typeof id == 'object') id = id.id;

    return { id: id, dx: dx || 0, dy: dy || 0 };
  },

  scope: function (canvas, data) {
    return canvas.points[data.id];
  },

  update: function (point, data, dx, dy) {
    point.x += dx - data.dx;
    point.y += dy - data.dy;
    data.dx = dx;
    data.dy = dy;
  },

  run: function (point, data) {
    point.x += data.dx;
    point.y += data.dy;
  },

  undo: function (point, data) {
    point.x -= data.dx;
    point.y -= data.dy;
  }
});

// Our control target
var my_scene = {points: {}, id_counter: 0};

// Create our Commandant
var keen = new SceneCommandant(my_scene);

// Simple methods return the result of the run method on execute.
var point_1 = keen.execute('POINT_ADD', 50, 50);

keen.execute('POINT_MOVE_TO', point_1, 100, 100);

// Can step through the commands executed previously.
keen.backward();
keen.forward();

// Can bind our Commandant to certain arguments.
var keen_point = keen.bind(point_1);
keen_point.execute('POINT_MOVE_TO', 60, 70);

// Transients allow you to change the data while recording the action.
var relative_drag = keen.transient('POINT_MOVE', point_1);
relative_drag.update(10, 10);
relative_drag.update(20, 20);
relative_drag.update(30, 30);
relative_drag.update(40, 40);
relative_drag.cancel();

// Can use bound with transients too.
var drag = keen_point.transient('POINT_MOVE_TO');
drag.update(60, 80);
drag.update(50, 60);
drag.finish();

// The compound command is a transient helper which lets you group multiple
// other commands into a single step.
var compound = keen.compound();
compound.update('POINT_ADD', 11, 11);
compound.update('POINT_ADD', 22, 22);
compound.update('POINT_ADD', 33, 33);
compound.finish();

console.log(JSON.stringify(my_scene));
keen.backward();
console.log(JSON.stringify(my_scene));
keen.forward();
console.log(JSON.stringify(my_scene));
