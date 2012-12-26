// vim:ts=4:sts=4:sw=4:
/*!
 *
 * Copyright 2009-2012 Kris Kowal under the terms of the MIT
 * license found at http://github.com/kriskowal/q/raw/master/LICENSE
 *
 * With parts by Tyler Close
 * Copyright 2007-2009 Tyler Close under the terms of the MIT X license found
 * at http://www.opensource.org/licenses/mit-license.html
 * Forked at ref_send.js version: 2009-05-11
 *
 * With parts by Mark Miller
 * Copyright (C) 2011 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

(function (definition) {
    // Turn off strict mode for this function so we can assign to global.Q
    /*jshint strict: false*/

    // This file will function properly as a <script> tag, or a module
    // using CommonJS and NodeJS or RequireJS module formats.  In
    // Common/Node/RequireJS, the module exports the Q API and when
    // executed as a simple <script>, it creates a Q global instead.

    // Montage Require
    if (typeof bootstrap === "function") {
        bootstrap("promise", definition);

    // CommonJS
    } else if (typeof exports === "object") {
        definition(void 0, exports);

    // RequireJS
    } else if (typeof define === "function") {
        define(definition);

    // SES (Secure EcmaScript)
    } else if (typeof ses !== "undefined") {
        if (!ses.ok()) {
            return;
        } else {
            ses.makeQ = function () {
                var Q = {};
                return definition(void 0, Q);
            };
        }

    // <script>
    } else {
        definition(void 0, Q = {});
    }

})(function (require, exports) {
"use strict";

// All code after this point will be filtered from stack traces reported
// by Q.
var qStartingLine = captureLine();
var qFileName;

// shims

// used for fallback "defend" and in "allResolved"
var noop = function () {};

// for the security conscious, defend may be a deep freeze as provided
// by cajaVM.  Otherwise we try to provide a shallow freeze just to
// discourage promise changes that are not compatible with secure
// usage.  If Object.freeze does not exist, fall back to doing nothing
// (no op).
var defend = Object.freeze || noop;
if (typeof cajaVM !== "undefined") {
    defend = cajaVM.def;
}

// use the fastest possible means to execute a task in a future turn
// of the event loop.
var nextTick;
if (typeof process !== "undefined") {
    // node
    nextTick = process.nextTick;
} else if (typeof setImmediate === "function") {
    // In IE10, or use https://github.com/NobleJS/setImmediate
    nextTick = setImmediate;
} else if (typeof MessageChannel !== "undefined") {
    // modern browsers
    // http://www.nonblocking.io/2011/06/windownexttick.html
    var channel = new MessageChannel();
    // linked list of tasks (single, with head node)
    var head = {}, tail = head;
    channel.port1.onmessage = function () {
        head = head.next;
        var task = head.task;
        delete head.task;
        task();
    };
    nextTick = function (task) {
        tail = tail.next = {task: task};
        channel.port2.postMessage(0);
    };
} else {
    // old browsers
    nextTick = function (task) {
        setTimeout(task, 0);
    };
}

// Attempt to make generics safe in the face of downstream
// modifications.
// There is no situation where this is necessary.
// If you need a security guarantee, these primordials need to be
// deeply frozen anyway, and if you don’t need a security guarantee,
// this is just plain paranoid.
// However, this does have the nice side-effect of reducing the size
// of the code by reducing x.call() to merely x(), eliminating many
// hard-to-minify characters.
// See Mark Miller’s explanation of what this does.
// http://wiki.ecmascript.org/doku.php?id=conventions:safe_meta_programming
var uncurryThis;
// I have kept both variations because the first is theoretically
// faster, if bind is available.
if (Function.prototype.bind) {
    var Function_bind = Function.prototype.bind;
    uncurryThis = Function_bind.bind(Function_bind.call);
} else {
    uncurryThis = function (f) {
        return function () {
            return f.call.apply(f, arguments);
        };
    };
}

var array_slice = uncurryThis(Array.prototype.slice);

var array_reduce = uncurryThis(
    Array.prototype.reduce || function (callback, basis) {
        var index = 0,
            length = this.length;
        // concerning the initial value, if one is not provided
        if (arguments.length === 1) {
            // seek to the first value in the array, accounting
            // for the possibility that is is a sparse array
            do {
                if (index in this) {
                    basis = this[index++];
                    break;
                }
                if (++index >= length) {
                    throw new TypeError();
                }
            } while (1);
        }
        // reduce
        for (; index < length; index++) {
            // account for the possibility that the array is sparse
            if (index in this) {
                basis = callback(basis, this[index], index);
            }
        }
        return basis;
    }
);

var array_indexOf = uncurryThis(
    Array.prototype.indexOf || function (value) {
        // not a very good shim, but good enough for our one use of it
        for (var i = 0; i < this.length; i++) {
            if (this[i] === value) {
                return i;
            }
        }
        return -1;
    }
);

var array_map = uncurryThis(
    Array.prototype.map || function (callback, thisp) {
        var self = this;
        var collect = [];
        array_reduce(self, function (undefined, value, index) {
            collect.push(callback.call(thisp, value, index, self));
        }, void 0);
        return collect;
    }
);

var object_create = Object.create || function (prototype) {
    function Type() { }
    Type.prototype = prototype;
    return new Type();
};

var object_keys = Object.keys || function (object) {
    var keys = [];
    for (var key in object) {
        keys.push(key);
    }
    return keys;
};

var object_toString = Object.prototype.toString;

// generator related shims

function isStopIteration(exception) {
    return (
        object_toString(exception) === "[object StopIteration]" ||
        exception instanceof QReturnValue
    );
}

var QReturnValue;
if (typeof ReturnValue !== "undefined") {
    QReturnValue = ReturnValue;
} else {
    QReturnValue = function (value) {
        this.value = value;
    };
}

// long stack traces

var STACK_JUMP_SEPARATOR = "From previous event:";

function makeStackTraceLong(error, promise) {
    // If possible (that is, if in V8), transform the error stack
    // trace by removing Node and Q cruft, then concatenating with
    // the stack trace of the promise we are ``done``ing. See #57.
    if (promise.stack &&
        typeof error === "object" &&
        error !== null &&
        error.stack &&
        error.stack.indexOf(STACK_JUMP_SEPARATOR) === -1
    ) {
        error.stack = filterStackString(error.stack) +
            "\n" + STACK_JUMP_SEPARATOR + "\n" +
            filterStackString(promise.stack);
    }
}

function filterStackString(stackString) {
    var lines = stackString.split("\n");
    var desiredLines = [];
    for (var i = 0; i < lines.length; ++i) {
        var line = lines[i];

        if (!isInternalFrame(line) && !isNodeFrame(line)) {
            desiredLines.push(line);
        }
    }
    return desiredLines.join("\n");
}

function isNodeFrame(stackLine) {
    return stackLine.indexOf("(module.js:") !== -1 ||
           stackLine.indexOf("(node.js:") !== -1;
}

function isInternalFrame(stackLine) {
    var pieces = /at .+ \((.*):(\d+):\d+\)/.exec(stackLine);

    if (!pieces) {
        return false;
    }

    var fileName = pieces[1];
    var lineNumber = pieces[2];

    return fileName === qFileName &&
        lineNumber >= qStartingLine &&
        lineNumber <= qEndingLine;
}

// discover own file name and line number range for filtering stack
// traces
function captureLine() {
    if (Error.captureStackTrace) {
        var fileName, lineNumber;

        var oldPrepareStackTrace = Error.prepareStackTrace;

        Error.prepareStackTrace = function (error, frames) {
            fileName = frames[1].getFileName();
            lineNumber = frames[1].getLineNumber();
        };

        // teases call of temporary prepareStackTrace
        // JSHint and Closure Compiler generate known warnings here
        /*jshint expr: true */
        new Error().stack;

        Error.prepareStackTrace = oldPrepareStackTrace;
        qFileName = fileName;
        return lineNumber;
    }
}

function deprecate(callback, name, alternative) {
    return function () {
        if (typeof console !== "undefined" && typeof console.warn === "function") {
            console.warn(name + " is deprecated, use " + alternative + " instead.", new Error("").stack);
        }
        return callback.apply(callback, arguments);
    };
}

// end of shims
// beginning of real work

/**
 * Performs a task in a future turn of the event loop.
 * @param {Function} task
 */
exports.nextTick = nextTick;

/**
 * Constructs a {promise, resolve} object.
 *
 * The resolver is a callback to invoke with a more resolved value for the
 * promise. To fulfill the promise, invoke the resolver with any value that is
 * not a function. To reject the promise, invoke the resolver with a rejection
 * object. To put the promise in the same state as another promise, invoke the
 * resolver with that other promise.
 */
exports.defer = defer;
function defer() {
    // if "pending" is an "Array", that indicates that the promise has not yet
    // been resolved.  If it is "undefined", it has been resolved.  Each
    // element of the pending array is itself an array of complete arguments to
    // forward to the resolved promise.  We coerce the resolution value to a
    // promise using the ref promise because it handles both fully
    // resolved values and other promises gracefully.
    var pending = [], progressListeners = [], value;

    var deferred = object_create(defer.prototype);
    var promise = object_create(makePromise.prototype);

    promise.promiseSend = function (op, _, __, progress) {
        var args = array_slice(arguments);
        if (pending) {
            pending.push(args);
            if (op === "when" && progress) {
                progressListeners.push(progress);
            }
        } else {
            nextTick(function () {
                value.promiseSend.apply(value, args);
            });
        }
    };

    promise.valueOf = function () {
        if (pending) {
            return promise;
        }
        return value.valueOf();
    };

    if (Error.captureStackTrace) {
        Error.captureStackTrace(promise, defer);

        // Reify the stack into a string by using the accessor; this prevents
        // memory leaks as per GH-111. At the same time, cut off the first line;
        // it's always just "[object Promise]\n", as per the `toString`.
        promise.stack = promise.stack.substring(promise.stack.indexOf("\n") + 1);
    }

    function become(resolvedValue) {
        if (!pending) {
            return;
        }
        value = resolve(resolvedValue);
        array_reduce(pending, function (undefined, pending) {
            nextTick(function () {
                value.promiseSend.apply(value, pending);
            });
        }, void 0);
        pending = void 0;
        progressListeners = void 0;
    }

    defend(promise);

    deferred.promise = promise;
    deferred.resolve = become;
    deferred.reject = function (exception) {
        become(reject(exception));
    };
    deferred.notify = function (progress) {
        if (pending) {
            array_reduce(progressListeners, function (undefined, progressListener) {
                nextTick(function () {
                    progressListener(progress);
                });
            }, void 0);
        }
    };

    return deferred;
}

/**
 * Creates a Node-style callback that will resolve or reject the deferred
 * promise.
 * @returns a nodeback
 */
defer.prototype.makeNodeResolver = function () {
    var self = this;
    return function (error, value) {
        if (error) {
            self.reject(error);
        } else if (arguments.length > 2) {
            self.resolve(array_slice(arguments, 1));
        } else {
            self.resolve(value);
        }
    };
};
// XXX deprecated
defer.prototype.node = deprecate(defer.prototype.makeNodeResolver, "node", "makeNodeResolver");

/**
 * @param makePromise {Function} a function that returns nothing and accepts
 * the resolve, reject, and notify functions for a deferred.
 * @returns a promise that may be resolved with the given resolve and reject
 * functions, or rejected by a thrown exception in makePromise
 */
exports.promise = promise;
function promise(makePromise) {
    var deferred = defer();
    fcall(
        makePromise,
        deferred.resolve,
        deferred.reject,
        deferred.notify
    ).fail(deferred.reject);
    return deferred.promise;
}

/**
 * Constructs a Promise with a promise descriptor object and optional fallback
 * function.  The descriptor contains methods like when(rejected), get(name),
 * put(name, value), post(name, args), and delete(name), which all
 * return either a value, a promise for a value, or a rejection.  The fallback
 * accepts the operation name, a resolver, and any further arguments that would
 * have been forwarded to the appropriate method above had a method been
 * provided with the proper name.  The API makes no guarantees about the nature
 * of the returned object, apart from that it is usable whereever promises are
 * bought and sold.
 */
exports.makePromise = makePromise;
function makePromise(descriptor, fallback, valueOf, exception) {
    if (fallback === void 0) {
        fallback = function (op) {
            return reject(new Error("Promise does not support operation: " + op));
        };
    }

    var promise = object_create(makePromise.prototype);

    promise.promiseSend = function (op, resolved /* ...args */) {
        var args = array_slice(arguments, 2);
        var result;
        try {
            if (descriptor[op]) {
                result = descriptor[op].apply(promise, args);
            } else {
                result = fallback.apply(promise, [op].concat(args));
            }
        } catch (exception) {
            result = reject(exception);
        }
        if (resolved) {
            resolved(result);
        }
    };

    if (valueOf) {
        promise.valueOf = valueOf;
    }

    if (exception) {
        promise.exception = exception;
    }

    defend(promise);

    return promise;
}

// provide thenables, CommonJS/Promises/A
makePromise.prototype.then = function (fulfilled, rejected, progressed) {
    return when(this, fulfilled, rejected, progressed);
};

makePromise.prototype.thenResolve = function (value) {
    return when(this, function () { return value; });
};

// Chainable methods
array_reduce(
    [
        "isResolved", "isFulfilled", "isRejected",
        "when", "spread", "send",
        "get", "put", "del",
        "post", "invoke",
        "keys",
        "apply", "call", "bind",
        "fapply", "fcall", "fbind",
        "all", "allResolved",
        "view", "viewInfo",
        "timeout", "delay",
        "catch", "finally", "fail", "fin", "progress", "end", "done",
        "nfcall", "nfapply", "nfbind",
        "ncall", "napply", "nbind",
        "npost", "ninvoke",
        "nend", "nodeify"
    ],
    function (undefined, name) {
        makePromise.prototype[name] = function () {
            return exports[name].apply(
                exports,
                [this].concat(array_slice(arguments))
            );
        };
    },
    void 0
);

makePromise.prototype.toSource = function () {
    return this.toString();
};

makePromise.prototype.toString = function () {
    return "[object Promise]";
};

defend(makePromise.prototype);

/**
 * If an object is not a promise, it is as "near" as possible.
 * If a promise is rejected, it is as "near" as possible too.
 * If it’s a fulfilled promise, the fulfillment value is nearer.
 * If it’s a deferred promise and the deferred has been resolved, the
 * resolution is "nearer".
 * @param object
 * @returns most resolved (nearest) form of the object
 */
exports.nearer = valueOf;
function valueOf(value) {
    if (isPromise(value)) {
        return value.valueOf();
    }
    return value;
}

/**
 * @returns whether the given object is a promise.
 * Otherwise it is a fulfilled value.
 */
exports.isPromise = isPromise;
function isPromise(object) {
    return object && typeof object.promiseSend === "function";
}

/**
 * @returns whether the given object is a resolved promise.
 */
exports.isResolved = isResolved;
function isResolved(object) {
    return isFulfilled(object) || isRejected(object);
}

/**
 * @returns whether the given object is a value or fulfilled
 * promise.
 */
exports.isFulfilled = isFulfilled;
function isFulfilled(object) {
    return !isPromise(valueOf(object));
}

/**
 * @returns whether the given object is a rejected promise.
 */
exports.isRejected = isRejected;
function isRejected(object) {
    object = valueOf(object);
    return isPromise(object) && 'exception' in object;
}

var rejections = [];
var errors = [];
var errorsDisplayed;
function displayErrors() {
    if (
        !errorsDisplayed &&
        typeof window !== "undefined" &&
        !window.Touch &&
        window.console
    ) {
        // This promise library consumes exceptions thrown in handlers so
        // they can be handled by a subsequent promise.  The rejected
        // promises get added to this array when they are created, and
        // removed when they are handled.
        console.log("Should be empty:", errors);
    }
    errorsDisplayed = true;
}

/**
 * Constructs a rejected promise.
 * @param exception value describing the failure
 */
exports.reject = reject;
function reject(exception) {
    exception = exception || new Error();
    var rejection = makePromise({
        "when": function (rejected) {
            // note that the error has been handled
            if (rejected) {
                var at = array_indexOf(rejections, this);
                if (at !== -1) {
                    errors.splice(at, 1);
                    rejections.splice(at, 1);
                }
            }
            return rejected ? rejected(exception) : reject(exception);
        }
    }, function fallback() {
        return reject(exception);
    }, function valueOf() {
        return this;
    }, exception);
    // note that the error has not been handled
    displayErrors();
    rejections.push(rejection);
    errors.push(exception);
    return rejection;
}

/**
 * Constructs a promise for an immediate reference.
 * @param value immediate reference
 */
exports.begin = resolve; // XXX experimental
exports.resolve = resolve;
exports.ref = deprecate(resolve, "ref", "resolve"); // XXX deprecated, use resolve
function resolve(object) {
    // If the object is already a Promise, return it directly.  This enables
    // the resolve function to both be used to created references from objects,
    // but to tolerably coerce non-promises to promises.
    if (isPromise(object)) {
        return object;
    }
    // In order to break infinite recursion or loops between `then` and
    // `resolve`, it is necessary to attempt to extract fulfilled values
    // out of foreign promise implementations before attempting to wrap
    // them as unresolved promises.  It is my hope that other
    // implementations will implement `valueOf` to synchronously extract
    // the fulfillment value from their fulfilled promises.  If the
    // other promise library does not implement `valueOf`, the
    // implementations on primordial prototypes are harmless.
    object = valueOf(object);
    // assimilate thenables, CommonJS/Promises/A
    if (object && typeof object.then === "function") {
        var deferred = defer();
        object.then(deferred.resolve, deferred.reject, deferred.notify);
        return deferred.promise;
    }
    return makePromise({
        "when": function () {
            return object;
        },
        "get": function (name) {
            return object[name];
        },
        "put": function (name, value) {
            object[name] = value;
            return object;
        },
        "del": function (name) {
            delete object[name];
            return object;
        },
        "post": function (name, value) {
            return object[name].apply(object, value);
        },
        "apply": function (self, args) {
            return object.apply(self, args);
        },
        "fapply": function (args) {
            return object.apply(void 0, args);
        },
        "viewInfo": function () {
            var on = object;
            var properties = {};

            function fixFalsyProperty(name) {
                if (!properties[name]) {
                    properties[name] = typeof on[name];
                }
            }

            while (on) {
                Object.getOwnPropertyNames(on).forEach(fixFalsyProperty);
                on = Object.getPrototypeOf(on);
            }
            return {
                "type": typeof object,
                "properties": properties
            };
        },
        "keys": function () {
            return object_keys(object);
        }
    }, void 0, function valueOf() {
        return object;
    });
}

/**
 * Annotates an object such that it will never be
 * transferred away from this process over any promise
 * communication channel.
 * @param object
 * @returns promise a wrapping of that object that
 * additionally responds to the "isDef" message
 * without a rejection.
 */
exports.master = master;
function master(object) {
    return makePromise({
        "isDef": function () {}
    }, function fallback() {
        var args = array_slice(arguments);
        return send.apply(void 0, [object].concat(args));
    }, function () {
        return valueOf(object);
    });
}

exports.viewInfo = viewInfo;
function viewInfo(object, info) {
    object = resolve(object);
    if (info) {
        return makePromise({
            "viewInfo": function () {
                return info;
            }
        }, function fallback() {
            var args = array_slice(arguments);
            return send.apply(void 0, [object].concat(args));
        }, function () {
            return valueOf(object);
        });
    } else {
        return send(object, "viewInfo");
    }
}

exports.view = view;
function view(object) {
    return viewInfo(object).when(function (info) {
        var view;
        if (info.type === "function") {
            view = function () {
                return apply(object, void 0, arguments);
            };
        } else {
            view = {};
        }
        var properties = info.properties || {};
        object_keys(properties).forEach(function (name) {
            if (properties[name] === "function") {
                view[name] = function () {
                    return post(object, name, arguments);
                };
            }
        });
        return resolve(view);
    });
}

/**
 * Registers an observer on a promise.
 *
 * Guarantees:
 *
 * 1. that fulfilled and rejected will be called only once.
 * 2. that either the fulfilled callback or the rejected callback will be
 *    called, but not both.
 * 3. that fulfilled and rejected will not be called in this turn.
 *
 * @param value      promise or immediate reference to observe
 * @param fulfilled  function to be called with the fulfilled value
 * @param rejected   function to be called with the rejection exception
 * @param progressed function to be called on any progress notifications
 * @return promise for the return value from the invoked callback
 */
exports.when = when;
function when(value, fulfilled, rejected, progressed) {
    var deferred = defer();
    var done = false;   // ensure the untrusted promise makes at most a
                        // single call to one of the callbacks

    function _fulfilled(value) {
        try {
            return fulfilled ? fulfilled(value) : value;
        } catch (exception) {
            return reject(exception);
        }
    }

    function _rejected(exception) {
        if (rejected) {
            makeStackTraceLong(exception, resolvedValue);
            try {
                return rejected(exception);
            } catch (newException) {
                return reject(newException);
            }
        }
        return reject(exception);
    }

    function _progressed(value) {
        return progressed ? progressed(value) : value;
    }

    var resolvedValue = resolve(value);
    nextTick(function () {
        resolvedValue.promiseSend("when", function (value) {
            if (done) {
                return;
            }
            done = true;

            deferred.resolve(_fulfilled(value));
        }, function (exception) {
            if (done) {
                return;
            }
            done = true;

            deferred.resolve(_rejected(exception));
        });
    });

    // Progress propagator need to be attached in the current tick.
    resolvedValue.promiseSend("when", void 0, void 0, function (value) {
        deferred.notify(_progressed(value));
    });

    return deferred.promise;
}

/**
 * Spreads the values of a promised array of arguments into the
 * fulfillment callback.
 * @param fulfilled callback that receives variadic arguments from the
 * promised array
 * @param rejected callback that receives the exception if the promise
 * is rejected.
 * @returns a promise for the return value or thrown exception of
 * either callback.
 */
exports.spread = spread;
function spread(promise, fulfilled, rejected) {
    return when(promise, function (valuesOrPromises) {
        return all(valuesOrPromises).then(function (values) {
            return fulfilled.apply(void 0, values);
        }, rejected);
    }, rejected);
}

/**
 * The async function is a decorator for generator functions, turning
 * them into asynchronous generators.  This presently only works in
 * Firefox/Spidermonkey, however, this code does not cause syntax
 * errors in older engines.  This code should continue to work and
 * will in fact improve over time as the language improves.
 *
 * Decorates a generator function such that:
 *  - it may yield promises
 *  - execution will continue when that promise is fulfilled
 *  - the value of the yield expression will be the fulfilled value
 *  - it returns a promise for the return value (when the generator
 *    stops iterating)
 *  - the decorated function returns a promise for the return value
 *    of the generator or the first rejected promise among those
 *    yielded.
 *  - if an error is thrown in the generator, it propagates through
 *    every following yield until it is caught, or until it escapes
 *    the generator function altogether, and is translated into a
 *    rejection for the promise returned by the decorated generator.
 *  - in present implementations of generators, when a generator
 *    function is complete, it throws ``StopIteration``, ``return`` is
 *    a syntax error in the presence of ``yield``, so there is no
 *    observable return value. There is a proposal[1] to add support
 *    for ``return``, which would permit the value to be carried by a
 *    ``StopIteration`` instance, in which case it would fulfill the
 *    promise returned by the asynchronous generator.  This can be
 *    emulated today by throwing StopIteration explicitly with a value
 *    property.
 *
 *  [1]: http://wiki.ecmascript.org/doku.php?id=strawman:async_functions#reference_implementation
 *
 */
exports.async = async;
function async(makeGenerator) {
    return function () {
        // when verb is "send", arg is a value
        // when verb is "throw", arg is an exception
        function continuer(verb, arg) {
            var result;
            try {
                result = generator[verb](arg);
            } catch (exception) {
                if (isStopIteration(exception)) {
                    return exception.value;
                } else {
                    return reject(exception);
                }
            }
            return when(result, callback, errback);
        }
        var generator = makeGenerator.apply(this, arguments);
        var callback = continuer.bind(continuer, "send");
        var errback = continuer.bind(continuer, "throw");
        return callback();
    };
}

/**
 * Throws a ReturnValue exception to stop an asynchronous generator.
 * Only useful presently in Firefox/SpiderMonkey since generators are
 * implemented.
 * @param value the return value for the surrounding generator
 * @throws ReturnValue exception with the value.
 * @example
 * Q.async(function () {
 *      var foo = yield getFooPromise();
 *      var bar = yield getBarPromise();
 *      Q.return(foo + bar);
 * })
 */
exports['return'] = _return;
function _return(value) {
    throw new QReturnValue(value);
}

/**
 * The promised function decorator ensures that any promise arguments
 * are resolved and passed as values (`this` is also resolved and passed
 * as a value).  It will also ensure that the result of a function is
 * always a promise.
 *
 * @example
 * var add = Q.promised(function (a, b) {
 *     return a + b;
 * });
 * add(Q.resolve(a), Q.resolve(B));
 *
 * @param {function} callback The function to decorate
 * @returns {function} a function that has been decorated.
 */
exports.promised = promised;
function promised(callback) {
    return function () {
        return all([this, all(arguments)]).spread(function (self, args) {
          return callback.apply(self, args);
        });
    };
}

/**
 * Constructs a promise method that can be used to safely observe resolution of
 * a promise for an arbitrarily named method like "propfind" in a future turn.
 */
exports.sender = deprecate(sender, "sender", "dispatcher"); // XXX deprecated, use dispatcher
exports.Method = deprecate(sender, "Method", "dispatcher"); // XXX deprecated, use dispatcher
function sender(op) {
    return function (object) {
        var args = array_slice(arguments, 1);
        return send.apply(void 0, [object, op].concat(args));
    };
}

/**
 * sends a message to a value in a future turn
 * @param object* the recipient
 * @param op the name of the message operation, e.g., "when",
 * @param ...args further arguments to be forwarded to the operation
 * @returns result {Promise} a promise for the result of the operation
 */
exports.send = deprecate(send, "send", "dispatch"); // XXX deprecated, use dispatch
function send(object, op) {
    var deferred = defer();
    var args = array_slice(arguments, 2);
    object = resolve(object);
    nextTick(function () {
        object.promiseSend.apply(
            object,
            [op, deferred.resolve].concat(args)
        );
    });
    return deferred.promise;
}

/**
 * sends a message to a value in a future turn
 * @param object* the recipient
 * @param op the name of the message operation, e.g., "when",
 * @param args further arguments to be forwarded to the operation
 * @returns result {Promise} a promise for the result of the operation
 */
exports.dispatch = dispatch;
function dispatch(object, op, args) {
    var deferred = defer();
    object = resolve(object);
    nextTick(function () {
        object.promiseSend.apply(
            object,
            [op, deferred.resolve].concat(args)
        );
    });
    return deferred.promise;
}

/**
 * Constructs a promise method that can be used to safely observe resolution of
 * a promise for an arbitrarily named method like "propfind" in a future turn.
 *
 * "dispatcher" constructs methods like "get(promise, name)" and "put(promise)".
 */
exports.dispatcher = dispatcher;
function dispatcher(op) {
    return function (object) {
        var args = array_slice(arguments, 1);
        return dispatch(object, op, args);
    };
}

/**
 * Gets the value of a property in a future turn.
 * @param object    promise or immediate reference for target object
 * @param name      name of property to get
 * @return promise for the property value
 */
exports.get = dispatcher("get");

/**
 * Sets the value of a property in a future turn.
 * @param object    promise or immediate reference for object object
 * @param name      name of property to set
 * @param value     new value of property
 * @return promise for the return value
 */
exports.put = dispatcher("put");

/**
 * Deletes a property in a future turn.
 * @param object    promise or immediate reference for target object
 * @param name      name of property to delete
 * @return promise for the return value
 */
exports["delete"] = // XXX experimental
exports.del = dispatcher("del");

/**
 * Invokes a method in a future turn.
 * @param object    promise or immediate reference for target object
 * @param name      name of method to invoke
 * @param value     a value to post, typically an array of
 *                  invocation arguments for promises that
 *                  are ultimately backed with `resolve` values,
 *                  as opposed to those backed with URLs
 *                  wherein the posted value can be any
 *                  JSON serializable object.
 * @return promise for the return value
 */
// bound locally because it is used by other methods
var post = exports.post = dispatcher("post");

/**
 * Invokes a method in a future turn.
 * @param object    promise or immediate reference for target object
 * @param name      name of method to invoke
 * @param ...args   array of invocation arguments
 * @return promise for the return value
 */
exports.invoke = function (value, name) {
    var args = array_slice(arguments, 2);
    return post(value, name, args);
};

/**
 * Applies the promised function in a future turn.
 * @param object    promise or immediate reference for target function
 * @param thisp     the `this` object for the call
 * @param args      array of application arguments
 */
// XXX deprecated, use fapply
var apply = exports.apply = deprecate(dispatcher("apply"), "apply", "fapply");

/**
 * Applies the promised function in a future turn.
 * @param object    promise or immediate reference for target function
 * @param args      array of application arguments
 */
var fapply = exports.fapply = dispatcher("fapply");

/**
 * Calls the promised function in a future turn.
 * @param object    promise or immediate reference for target function
 * @param thisp     the `this` object for the call
 * @param ...args   array of application arguments
 */
// XXX deprecated, use fcall
exports.call = deprecate(call, "call", "fcall");
function call(value, thisp) {
    var args = array_slice(arguments, 2);
    return apply(value, thisp, args);
}

/**
 * Calls the promised function in a future turn.
 * @param object    promise or immediate reference for target function
 * @param ...args   array of application arguments
 */
exports["try"] = fcall; // XXX experimental
exports.fcall = fcall;
function fcall(value) {
    var args = array_slice(arguments, 1);
    return fapply(value, args);
}

/**
 * Binds the promised function, transforming return values into a fulfilled
 * promise and thrown errors into a rejected one.
 * @param object    promise or immediate reference for target function
 * @param thisp   the `this` object for the call
 * @param ...args   array of application arguments
 */
exports.bind = deprecate(bind, "bind", "fbind"); // XXX deprecated, use fbind
function bind(value, thisp) {
    var args = array_slice(arguments, 2);
    return function bound() {
        var allArgs = args.concat(array_slice(arguments));
        return apply(value, thisp, allArgs);
    };
}

/**
 * Binds the promised function, transforming return values into a fulfilled
 * promise and thrown errors into a rejected one.
 * @param object    promise or immediate reference for target function
 * @param ...args   array of application arguments
 */
exports.fbind = fbind;
function fbind(value) {
    var args = array_slice(arguments, 1);
    return function fbound() {
        var allArgs = args.concat(array_slice(arguments));
        return fapply(value, allArgs);
    };
}

/**
 * Requests the names of the owned properties of a promised
 * object in a future turn.
 * @param object    promise or immediate reference for target object
 * @return promise for the keys of the eventually resolved object
 */
exports.keys = dispatcher("keys");

/**
 * Turns an array of promises into a promise for an array.  If any of
 * the promises gets rejected, the whole array is rejected immediately.
 * @param {Array*} an array (or promise for an array) of values (or
 * promises for values)
 * @returns a promise for an array of the corresponding values
 */
// By Mark Miller
// http://wiki.ecmascript.org/doku.php?id=strawman:concurrency&rev=1308776521#allfulfilled
exports.all = all;
function all(promises) {
    return when(promises, function (promises) {
        var countDown = promises.length;
        if (countDown === 0) {
            return resolve(promises);
        }
        var deferred = defer();
        array_reduce(promises, function (undefined, promise, index) {
            if (isFulfilled(promise)) {
                promises[index] = valueOf(promise);
                if (--countDown === 0) {
                    deferred.resolve(promises);
                }
            } else {
                when(promise, function (value) {
                    promises[index] = value;
                    if (--countDown === 0) {
                        deferred.resolve(promises);
                    }
                })
                .fail(deferred.reject);
            }
        }, void 0);
        return deferred.promise;
    });
}

/**
 * Waits for all promises to be resolved, either fulfilled or
 * rejected.  This is distinct from `all` since that would stop
 * waiting at the first rejection.  The promise returned by
 * `allResolved` will never be rejected.
 * @param promises a promise for an array (or an array) of promises
 * (or values)
 * @return a promise for an array of promises
 */
exports.allResolved = allResolved;
function allResolved(promises) {
    return when(promises, function (promises) {
        return when(all(array_map(promises, function (promise) {
            return when(promise, noop, noop);
        })), function () {
            return array_map(promises, resolve);
        });
    });
}

/**
 * Captures the failure of a promise, giving an oportunity to recover
 * with a callback.  If the given promise is fulfilled, the returned
 * promise is fulfilled.
 * @param {Any*} promise for something
 * @param {Function} callback to fulfill the returned promise if the
 * given promise is rejected
 * @returns a promise for the return value of the callback
 */
exports["catch"] = // XXX experimental
exports.fail = fail;
function fail(promise, rejected) {
    return when(promise, void 0, rejected);
}

/**
 * Attaches a listener that can respond to progress notifications from a
 * promise's originating deferred. This listener receives the exact arguments
 * passed to ``deferred.notify``.
 * @param {Any*} promise for something
 * @param {Function} callback to receive any progress notifications
 * @returns the given promise, unchanged
 */
exports.progress = progress;
function progress(promise, progressed) {
    return when(promise, void 0, void 0, progressed);
}

/**
 * Provides an opportunity to observe the rejection of a promise,
 * regardless of whether the promise is fulfilled or rejected.  Forwards
 * the resolution to the returned promise when the callback is done.
 * The callback can return a promise to defer completion.
 * @param {Any*} promise
 * @param {Function} callback to observe the resolution of the given
 * promise, takes no arguments.
 * @returns a promise for the resolution of the given promise when
 * ``fin`` is done.
 */
exports["finally"] = // XXX experimental
exports.fin = fin;
function fin(promise, callback) {
    return when(promise, function (value) {
        return when(callback(), function () {
            return value;
        });
    }, function (exception) {
        return when(callback(), function () {
            return reject(exception);
        });
    });
}

/**
 * Terminates a chain of promises, forcing rejections to be
 * thrown as exceptions.
 * @param {Any*} promise at the end of a chain of promises
 * @returns nothing
 */
exports.end = deprecate(done, "end", "done"); // XXX deprecated, use done
exports.done = done;
function done(promise, fulfilled, rejected, progress) {
    function onUnhandledError(error) {
        // forward to a future turn so that ``when``
        // does not catch it and turn it into a rejection.
        nextTick(function () {
            makeStackTraceLong(error, promise);

            if (exports.onerror) {
                exports.onerror(error);
            } else {
                throw error;
            }
        });
    }

    // Avoid unnecessary `nextTick`ing via an unnecessary `when`.
    var promiseToHandle = fulfilled || rejected || progress ?
        when(promise, fulfilled, rejected, progress) :
        promise;

    fail(promiseToHandle, onUnhandledError);
}

/**
 * Causes a promise to be rejected if it does not get fulfilled before
 * some milliseconds time out.
 * @param {Any*} promise
 * @param {Number} milliseconds timeout
 * @returns a promise for the resolution of the given promise if it is
 * fulfilled before the timeout, otherwise rejected.
 */
exports.timeout = timeout;
function timeout(promise, ms) {
    var deferred = defer();
    var timeoutId = setTimeout(function () {
        deferred.reject(new Error("Timed out after " + ms + " ms"));
    }, ms);

    when(promise, function (value) {
        clearTimeout(timeoutId);
        deferred.resolve(value);
    }, function (exception) {
        clearTimeout(timeoutId);
        deferred.reject(exception);
    });

    return deferred.promise;
}

/**
 * Returns a promise for the given value (or promised value) after some
 * milliseconds.
 * @param {Any*} promise
 * @param {Number} milliseconds
 * @returns a promise for the resolution of the given promise after some
 * time has elapsed.
 */
exports.delay = delay;
function delay(promise, timeout) {
    if (timeout === void 0) {
        timeout = promise;
        promise = void 0;
    }
    var deferred = defer();
    setTimeout(function () {
        deferred.resolve(promise);
    }, timeout);
    return deferred.promise;
}

/**
 * Passes a continuation to a Node function, which is called with the given
 * arguments provided as an array, and returns a promise.
 *
 *      var readFile = require("fs").readFile;
 *      Q.nfapply(readFile, [__filename])
 *      .then(function (content) {
 *      })
 *
 */
exports.nfapply = nfapply;
function nfapply(callback, args) {
    var nodeArgs = array_slice(args);
    var deferred = defer();
    nodeArgs.push(deferred.makeNodeResolver());

    fapply(callback, nodeArgs).fail(deferred.reject);
    return deferred.promise;
}

/**
 * Passes a continuation to a Node function, which is called with the given
 * arguments provided individually, and returns a promise.
 *
 *      var readFile = require("fs").readFile;
 *      Q.nfcall(readFile, __filename)
 *      .then(function (content) {
 *      })
 *
 */
exports.nfcall = nfcall;
function nfcall(callback/*, ...args */) {
    var nodeArgs = array_slice(arguments, 1);
    var deferred = defer();
    nodeArgs.push(deferred.makeNodeResolver());

    fapply(callback, nodeArgs).fail(deferred.reject);
    return deferred.promise;
}

/**
 * Wraps a NodeJS continuation passing function and returns an equivalent
 * version that returns a promise.
 *
 *      Q.nfbind(FS.readFile, __filename)("utf-8")
 *      .then(console.log)
 *      .done()
 *
 */
exports.nfbind = nfbind;
function nfbind(callback/*, ...args */) {
    var baseArgs = array_slice(arguments, 1);
    return function () {
        var nodeArgs = baseArgs.concat(array_slice(arguments));
        var deferred = defer();
        nodeArgs.push(deferred.makeNodeResolver());

        fapply(callback, nodeArgs).fail(deferred.reject);
        return deferred.promise;
    };
}

/**
 * Passes a continuation to a Node function, which is called with a given
 * `this` value and arguments provided as an array, and returns a promise.
 *
 *      var FS = (require)("fs");
 *      Q.napply(FS.readFile, FS, [__filename])
 *      .then(function (content) {
 *      })
 *
 */
exports.napply = deprecate(napply, "napply", "npost");
function napply(callback, thisp, args) {
    return nbind(callback, thisp).apply(void 0, args);
}

/**
 * Passes a continuation to a Node function, which is called with a given
 * `this` value and arguments provided individually, and returns a promise.
 *
 *      var FS = (require)("fs");
 *      Q.ncall(FS.readFile, FS, __filename)
 *      .then(function (content) {
 *      })
 *
 */
exports.ncall = deprecate(ncall, "ncall", "ninvoke");
function ncall(callback, thisp /*, ...args*/) {
    var args = array_slice(arguments, 2);
    return napply(callback, thisp, args);
}

/**
 * Wraps a NodeJS continuation passing function and returns an equivalent
 * version that returns a promise.
 *
 *      Q.nbind(FS.readFile, FS)(__filename)
 *      .then(console.log)
 *      .done()
 *
 */
exports.nbind = deprecate(nbind, "nbind", "nfbind");
function nbind(callback /* thisp, ...args*/) {
    if (arguments.length > 1) {
        var thisp = arguments[1];
        var args = array_slice(arguments, 2);

        var originalCallback = callback;
        callback = function () {
            var combinedArgs = args.concat(array_slice(arguments));
            return originalCallback.apply(thisp, combinedArgs);
        };
    }
    return function () {
        var deferred = defer();
        var args = array_slice(arguments);
        // add a continuation that resolves the promise
        args.push(deferred.makeNodeResolver());
        // trap exceptions thrown by the callback
        fapply(callback, args)
        .fail(deferred.reject);
        return deferred.promise;
    };
}

/**
 * Calls a method of a Node-style object that accepts a Node-style
 * callback with a given array of arguments, plus a provided callback.
 * @param object an object that has the named method
 * @param {String} name name of the method of object
 * @param {Array} args arguments to pass to the method; the callback
 * will be provided by Q and appended to these arguments.
 * @returns a promise for the value or error
 */
exports.npost = npost;
function npost(object, name, args) {
    var nodeArgs = array_slice(args);
    var deferred = defer();
    nodeArgs.push(deferred.makeNodeResolver());

    post(object, name, nodeArgs).fail(deferred.reject);
    return deferred.promise;
}

/**
 * Calls a method of a Node-style object that accepts a Node-style
 * callback, forwarding the given variadic arguments, plus a provided
 * callback argument.
 * @param object an object that has the named method
 * @param {String} name name of the method of object
 * @param ...args arguments to pass to the method; the callback will
 * be provided by Q and appended to these arguments.
 * @returns a promise for the value or error
 */
exports.ninvoke = ninvoke;
function ninvoke(object, name /*, ...args*/) {
    var nodeArgs = array_slice(arguments, 2);
    var deferred = defer();
    nodeArgs.push(deferred.makeNodeResolver());

    post(object, name, nodeArgs).fail(deferred.reject);
    return deferred.promise;
}

exports.nend = deprecate(nodeify, "nend", "nodeify"); // XXX deprecated, use nodeify
exports.nodeify = nodeify;
function nodeify(promise, nodeback) {
    if (nodeback) {
        promise.then(function (value) {
            nextTick(function () {
                nodeback(null, value);
            });
        }, function (error) {
            nextTick(function () {
                nodeback(error);
            });
        });
    } else {
        return promise;
    }
}

// All code before this point will be filtered from stack traces.
var qEndingLine = captureLine();

});

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
      var args, command, data, name, ret_val;
      name = arguments[0], args = 2 <= arguments.length ? __slice.call(arguments, 1) : [];
      command = this.commands[name];
      this._assert(command.update != null, "Command " + name + " does not support transient calling.");
      this._silent = true;
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
      this._silent = false;
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
      this._silent = false;
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
      return this.silent(function() {
        return command[method].apply(command, [scope, action.data].concat(__slice.call(args)));
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
            result = Q.when(void 0);
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
            result = Q.when(void 0);
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
        promise = Q.when(fn());
      } else {
        this._silent = true;
        promise = Q.when(fn()).fin(function() {
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
        return Q.when(fn.apply(_this, args)).then(function(result) {
          return deferred.resolve(result);
        }, function(err) {
          console.log('Encountered error in deferred fn', err);
          return deferred.reject(err);
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
      this._running.fin(function() {
        _this._running = null;
        return _this._runDefer();
      });
    };

    Async.prototype.execute = function() {
      var args, name;
      name = arguments[0], args = 2 <= arguments.length ? __slice.call(arguments, 1) : [];
      return this._defer(this._executeAsync, name, args);
    };

    Async.prototype._executeAsync = function(name, args) {
      var action, command,
        _this = this;
      this._assert(!this._transient, 'Cannot execute while transient action active.');
      command = this.commands[name];
      action = null;
      return Q.resolve(command.init.apply(command, [this.scope].concat(__slice.call(args)))).then(function(data) {
        action = {
          name: name,
          data: data
        };
        return Q.resolve(_this._run(action, 'run'));
      }).then(function(result) {
        if (_this._silent || !_this._agg(action)) {
          _this._push(action);
        }
        return result;
      });
    };

    Async.prototype.redo = function() {
      return this._defer(this._redoAsync);
    };

    Async.prototype._redoAsync = function() {
      var action,
        _this = this;
      this._assert(!this._transient, 'Cannot redo while transient action active.');
      this._assert(!this._compound, 'Cannot redo while compound action active.');
      action = this.getRedoActions(true);
      if (!action) {
        return Q.resolve(void 0);
      }
      return Q.when(this._run(action, 'run')).then(function() {
        if (typeof _this.trigger === "function") {
          _this.trigger('redo', action);
        }
        return typeof _this.onRedo === "function" ? _this.onRedo(action) : void 0;
      });
    };

    Async.prototype.undo = function() {
      return this._defer(this._undoAsync);
    };

    Async.prototype._undoAsync = function() {
      var action,
        _this = this;
      this._assert(!this._transient, 'Cannot undo while transient action active.');
      this._assert(!this._compound, 'Cannot undo while compound action active.');
      action = this.getUndoAction(true);
      if (!action) {
        return Q.resolve(void 0);
      }
      return Q.when(this._run(action, 'undo')).then(function() {
        if (typeof _this.trigger === "function") {
          _this.trigger('undo', action);
        }
        return typeof _this.onUndo === "function" ? _this.onUndo(action) : void 0;
      });
    };

    Async.prototype.captureCompound = function() {
      return this._defer(Commandant.prototype.captureCompound);
    };

    Async.prototype.finishCompound = function() {
      return this._defer(Commandant.prototype.finishCompound);
    };

    Async.prototype.cancelCompound = function() {
      return this._defer(Commandant.prototype.cancelCompound);
    };

    Async.prototype.transient = function() {
      var args, name;
      name = arguments[0], args = 2 <= arguments.length ? __slice.call(arguments, 1) : [];
      return this._defer(this._transientAsync, name, args);
    };

    Async.prototype._transientAsync = function(name, args) {
      var command,
        _this = this;
      command = this.commands[name];
      this._assert(command.update != null, "Command " + name + " does not support transient calling.");
      this._silent = true;
      this._transient = {
        name: name
      };
      return Q.when(command.init.apply(command, [this.scope].concat(__slice.call(args)))).then(function(data) {
        _this._transient.data = data;
        return Q.when(_this._run(_this._transient, 'run'));
      }).then(function(ret_val) {
        return _this._transient.ret_val = ret_val;
      });
    };

    Async.prototype.update = function() {
      var args;
      args = 1 <= arguments.length ? __slice.call(arguments, 0) : [];
      return this._defer(this._updateAsync, args);
    };

    Async.prototype._updateAsync = function(args) {
      var _this = this;
      this._assert(this._transient, 'Cannot update without a transient action active.');
      return Q.when(this._run.apply(this, [this._transient, 'update'].concat(__slice.call(args)))).then(function(data) {
        return _this._transient.data = data;
      });
    };

    Async.prototype.finishTransient = function() {
      return this._defer(Commandant.prototype.finishTransient);
    };

    Async.prototype.cancelTransient = function() {
      return this._defer(Commandant.prototype.cancelTransient);
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
