"format global";
(function(global) {

  var defined = {};

  // indexOf polyfill for IE8
  var indexOf = Array.prototype.indexOf || function(item) {
    for (var i = 0, l = this.length; i < l; i++)
      if (this[i] === item)
        return i;
    return -1;
  }

  var getOwnPropertyDescriptor = true;
  try {
    Object.getOwnPropertyDescriptor({ a: 0 }, 'a');
  }
  catch(e) {
    getOwnPropertyDescriptor = false;
  }

  var defineProperty;
  (function () {
    try {
      if (!!Object.defineProperty({}, 'a', {}))
        defineProperty = Object.defineProperty;
    }
    catch (e) {
      defineProperty = function(obj, prop, opt) {
        try {
          obj[prop] = opt.value || opt.get.call(obj);
        }
        catch(e) {}
      }
    }
  })();

  function register(name, deps, declare) {
    if (arguments.length === 4)
      return registerDynamic.apply(this, arguments);
    doRegister(name, {
      declarative: true,
      deps: deps,
      declare: declare
    });
  }

  function registerDynamic(name, deps, executingRequire, execute) {
    doRegister(name, {
      declarative: false,
      deps: deps,
      executingRequire: executingRequire,
      execute: execute
    });
  }

  function doRegister(name, entry) {
    entry.name = name;

    // we never overwrite an existing define
    if (!(name in defined))
      defined[name] = entry;

    // we have to normalize dependencies
    // (assume dependencies are normalized for now)
    // entry.normalizedDeps = entry.deps.map(normalize);
    entry.normalizedDeps = entry.deps;
  }


  function buildGroups(entry, groups) {
    groups[entry.groupIndex] = groups[entry.groupIndex] || [];

    if (indexOf.call(groups[entry.groupIndex], entry) != -1)
      return;

    groups[entry.groupIndex].push(entry);

    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      var depEntry = defined[depName];

      // not in the registry means already linked / ES6
      if (!depEntry || depEntry.evaluated)
        continue;

      // now we know the entry is in our unlinked linkage group
      var depGroupIndex = entry.groupIndex + (depEntry.declarative != entry.declarative);

      // the group index of an entry is always the maximum
      if (depEntry.groupIndex === undefined || depEntry.groupIndex < depGroupIndex) {

        // if already in a group, remove from the old group
        if (depEntry.groupIndex !== undefined) {
          groups[depEntry.groupIndex].splice(indexOf.call(groups[depEntry.groupIndex], depEntry), 1);

          // if the old group is empty, then we have a mixed depndency cycle
          if (groups[depEntry.groupIndex].length == 0)
            throw new TypeError("Mixed dependency cycle detected");
        }

        depEntry.groupIndex = depGroupIndex;
      }

      buildGroups(depEntry, groups);
    }
  }

  function link(name) {
    var startEntry = defined[name];

    startEntry.groupIndex = 0;

    var groups = [];

    buildGroups(startEntry, groups);

    var curGroupDeclarative = !!startEntry.declarative == groups.length % 2;
    for (var i = groups.length - 1; i >= 0; i--) {
      var group = groups[i];
      for (var j = 0; j < group.length; j++) {
        var entry = group[j];

        // link each group
        if (curGroupDeclarative)
          linkDeclarativeModule(entry);
        else
          linkDynamicModule(entry);
      }
      curGroupDeclarative = !curGroupDeclarative; 
    }
  }

  // module binding records
  var moduleRecords = {};
  function getOrCreateModuleRecord(name) {
    return moduleRecords[name] || (moduleRecords[name] = {
      name: name,
      dependencies: [],
      exports: {}, // start from an empty module and extend
      importers: []
    })
  }

  function linkDeclarativeModule(entry) {
    // only link if already not already started linking (stops at circular)
    if (entry.module)
      return;

    var module = entry.module = getOrCreateModuleRecord(entry.name);
    var exports = entry.module.exports;

    var declaration = entry.declare.call(global, function(name, value) {
      module.locked = true;

      if (typeof name == 'object') {
        for (var p in name)
          exports[p] = name[p];
      }
      else {
        exports[name] = value;
      }

      for (var i = 0, l = module.importers.length; i < l; i++) {
        var importerModule = module.importers[i];
        if (!importerModule.locked) {
          for (var j = 0; j < importerModule.dependencies.length; ++j) {
            if (importerModule.dependencies[j] === module) {
              importerModule.setters[j](exports);
            }
          }
        }
      }

      module.locked = false;
      return value;
    });

    module.setters = declaration.setters;
    module.execute = declaration.execute;

    // now link all the module dependencies
    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      var depEntry = defined[depName];
      var depModule = moduleRecords[depName];

      // work out how to set depExports based on scenarios...
      var depExports;

      if (depModule) {
        depExports = depModule.exports;
      }
      else if (depEntry && !depEntry.declarative) {
        depExports = depEntry.esModule;
      }
      // in the module registry
      else if (!depEntry) {
        depExports = load(depName);
      }
      // we have an entry -> link
      else {
        linkDeclarativeModule(depEntry);
        depModule = depEntry.module;
        depExports = depModule.exports;
      }

      // only declarative modules have dynamic bindings
      if (depModule && depModule.importers) {
        depModule.importers.push(module);
        module.dependencies.push(depModule);
      }
      else
        module.dependencies.push(null);

      // run the setter for this dependency
      if (module.setters[i])
        module.setters[i](depExports);
    }
  }

  // An analog to loader.get covering execution of all three layers (real declarative, simulated declarative, simulated dynamic)
  function getModule(name) {
    var exports;
    var entry = defined[name];

    if (!entry) {
      exports = load(name);
      if (!exports)
        throw new Error("Unable to load dependency " + name + ".");
    }

    else {
      if (entry.declarative)
        ensureEvaluated(name, []);

      else if (!entry.evaluated)
        linkDynamicModule(entry);

      exports = entry.module.exports;
    }

    if ((!entry || entry.declarative) && exports && exports.__useDefault)
      return exports['default'];

    return exports;
  }

  function linkDynamicModule(entry) {
    if (entry.module)
      return;

    var exports = {};

    var module = entry.module = { exports: exports, id: entry.name };

    // AMD requires execute the tree first
    if (!entry.executingRequire) {
      for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
        var depName = entry.normalizedDeps[i];
        var depEntry = defined[depName];
        if (depEntry)
          linkDynamicModule(depEntry);
      }
    }

    // now execute
    entry.evaluated = true;
    var output = entry.execute.call(global, function(name) {
      for (var i = 0, l = entry.deps.length; i < l; i++) {
        if (entry.deps[i] != name)
          continue;
        return getModule(entry.normalizedDeps[i]);
      }
      throw new TypeError('Module ' + name + ' not declared as a dependency.');
    }, exports, module);

    if (output)
      module.exports = output;

    // create the esModule object, which allows ES6 named imports of dynamics
    exports = module.exports;
 
    if (exports && exports.__esModule) {
      entry.esModule = exports;
    }
    else {
      entry.esModule = {};
      
      // don't trigger getters/setters in environments that support them
      if (typeof exports == 'object' || typeof exports == 'function') {
        if (getOwnPropertyDescriptor) {
          var d;
          for (var p in exports)
            if (d = Object.getOwnPropertyDescriptor(exports, p))
              defineProperty(entry.esModule, p, d);
        }
        else {
          var hasOwnProperty = exports && exports.hasOwnProperty;
          for (var p in exports) {
            if (!hasOwnProperty || exports.hasOwnProperty(p))
              entry.esModule[p] = exports[p];
          }
         }
       }
      entry.esModule['default'] = exports;
      defineProperty(entry.esModule, '__useDefault', {
        value: true
      });
    }
  }

  /*
   * Given a module, and the list of modules for this current branch,
   *  ensure that each of the dependencies of this module is evaluated
   *  (unless one is a circular dependency already in the list of seen
   *  modules, in which case we execute it)
   *
   * Then we evaluate the module itself depth-first left to right 
   * execution to match ES6 modules
   */
  function ensureEvaluated(moduleName, seen) {
    var entry = defined[moduleName];

    // if already seen, that means it's an already-evaluated non circular dependency
    if (!entry || entry.evaluated || !entry.declarative)
      return;

    // this only applies to declarative modules which late-execute

    seen.push(moduleName);

    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      if (indexOf.call(seen, depName) == -1) {
        if (!defined[depName])
          load(depName);
        else
          ensureEvaluated(depName, seen);
      }
    }

    if (entry.evaluated)
      return;

    entry.evaluated = true;
    entry.module.execute.call(global);
  }

  // magical execution function
  var modules = {};
  function load(name) {
    if (modules[name])
      return modules[name];

    // node core modules
    if (name.substr(0, 6) == '@node/')
      return require(name.substr(6));

    var entry = defined[name];

    // first we check if this module has already been defined in the registry
    if (!entry)
      throw "Module " + name + " not present.";

    // recursively ensure that the module and all its 
    // dependencies are linked (with dependency group handling)
    link(name);

    // now handle dependency execution in correct order
    ensureEvaluated(name, []);

    // remove from the registry
    defined[name] = undefined;

    // exported modules get __esModule defined for interop
    if (entry.declarative)
      defineProperty(entry.module.exports, '__esModule', { value: true });

    // return the defined module object
    return modules[name] = entry.declarative ? entry.module.exports : entry.esModule;
  };

  return function(mains, depNames, declare) {
    return function(formatDetect) {
      formatDetect(function(deps) {
        var System = {
          _nodeRequire: typeof require != 'undefined' && require.resolve && typeof process != 'undefined' && require,
          register: register,
          registerDynamic: registerDynamic,
          get: load, 
          set: function(name, module) {
            modules[name] = module; 
          },
          newModule: function(module) {
            return module;
          }
        };
        System.set('@empty', {});

        // register external dependencies
        for (var i = 0; i < depNames.length; i++) (function(depName, dep) {
          if (dep && dep.__esModule)
            System.register(depName, [], function(_export) {
              return {
                setters: [],
                execute: function() {
                  for (var p in dep)
                    if (p != '__esModule' && !(typeof p == 'object' && p + '' == 'Module'))
                      _export(p, dep[p]);
                }
              };
            });
          else
            System.registerDynamic(depName, [], false, function() {
              return dep;
            });
        })(depNames[i], arguments[i]);

        // register modules in this bundle
        declare(System);

        // load mains
        var firstLoad = load(mains[0]);
        if (mains.length > 1)
          for (var i = 1; i < mains.length; i++)
            load(mains[i]);

        if (firstLoad.__useDefault)
          return firstLoad['default'];
        else
          return firstLoad;
      });
    };
  };

})(typeof self != 'undefined' ? self : global)
/* (['mainModule'], ['external-dep'], function($__System) {
  System.register(...);
})
(function(factory) {
  if (typeof define && define.amd)
    define(['external-dep'], factory);
  // etc UMD / module pattern
})*/

(['1'], [], function($__System) {

(function(__global) {
  var loader = $__System;
  var hasOwnProperty = Object.prototype.hasOwnProperty;
  var indexOf = Array.prototype.indexOf || function(item) {
    for (var i = 0, l = this.length; i < l; i++)
      if (this[i] === item)
        return i;
    return -1;
  }

  function readMemberExpression(p, value) {
    var pParts = p.split('.');
    while (pParts.length)
      value = value[pParts.shift()];
    return value;
  }

  // bare minimum ignores for IE8
  var ignoredGlobalProps = ['_g', 'sessionStorage', 'localStorage', 'clipboardData', 'frames', 'external', 'mozAnimationStartTime', 'webkitStorageInfo', 'webkitIndexedDB'];

  var globalSnapshot;

  function forEachGlobal(callback) {
    if (Object.keys)
      Object.keys(__global).forEach(callback);
    else
      for (var g in __global) {
        if (!hasOwnProperty.call(__global, g))
          continue;
        callback(g);
      }
  }

  function forEachGlobalValue(callback) {
    forEachGlobal(function(globalName) {
      if (indexOf.call(ignoredGlobalProps, globalName) != -1)
        return;
      try {
        var value = __global[globalName];
      }
      catch (e) {
        ignoredGlobalProps.push(globalName);
      }
      callback(globalName, value);
    });
  }

  loader.set('@@global-helpers', loader.newModule({
    prepareGlobal: function(moduleName, exportName, globals) {
      // disable module detection
      var curDefine = __global.define;
       
      __global.define = undefined;
      __global.exports = undefined;
      if (__global.module && __global.module.exports)
        __global.module = undefined;

      // set globals
      var oldGlobals;
      if (globals) {
        oldGlobals = {};
        for (var g in globals) {
          oldGlobals[g] = globals[g];
          __global[g] = globals[g];
        }
      }

      // store a complete copy of the global object in order to detect changes
      if (!exportName) {
        globalSnapshot = {};

        forEachGlobalValue(function(name, value) {
          globalSnapshot[name] = value;
        });
      }

      // return function to retrieve global
      return function() {
        var globalValue;

        if (exportName) {
          globalValue = readMemberExpression(exportName, __global);
        }
        else {
          var singleGlobal;
          var multipleExports;
          var exports = {};

          forEachGlobalValue(function(name, value) {
            if (globalSnapshot[name] === value)
              return;
            if (typeof value == 'undefined')
              return;
            exports[name] = value;

            if (typeof singleGlobal != 'undefined') {
              if (!multipleExports && singleGlobal !== value)
                multipleExports = true;
            }
            else {
              singleGlobal = value;
            }
          });
          globalValue = multipleExports ? exports : singleGlobal;
        }

        // revert globals
        if (oldGlobals) {
          for (var g in oldGlobals)
            __global[g] = oldGlobals[g];
        }
        __global.define = curDefine;

        return globalValue;
      };
    }
  }));

})(typeof self != 'undefined' ? self : global);

(function(__global) {
  var loader = $__System;
  var indexOf = Array.prototype.indexOf || function(item) {
    for (var i = 0, l = this.length; i < l; i++)
      if (this[i] === item)
        return i;
    return -1;
  }

  var commentRegEx = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg;
  var cjsRequirePre = "(?:^|[^$_a-zA-Z\\xA0-\\uFFFF.])";
  var cjsRequirePost = "\\s*\\(\\s*(\"([^\"]+)\"|'([^']+)')\\s*\\)";
  var fnBracketRegEx = /\(([^\)]*)\)/;
  var wsRegEx = /^\s+|\s+$/g;
  
  var requireRegExs = {};

  function getCJSDeps(source, requireIndex) {

    // remove comments
    source = source.replace(commentRegEx, '');

    // determine the require alias
    var params = source.match(fnBracketRegEx);
    var requireAlias = (params[1].split(',')[requireIndex] || 'require').replace(wsRegEx, '');

    // find or generate the regex for this requireAlias
    var requireRegEx = requireRegExs[requireAlias] || (requireRegExs[requireAlias] = new RegExp(cjsRequirePre + requireAlias + cjsRequirePost, 'g'));

    requireRegEx.lastIndex = 0;

    var deps = [];

    var match;
    while (match = requireRegEx.exec(source))
      deps.push(match[2] || match[3]);

    return deps;
  }

  /*
    AMD-compatible require
    To copy RequireJS, set window.require = window.requirejs = loader.amdRequire
  */
  function require(names, callback, errback, referer) {
    // in amd, first arg can be a config object... we just ignore
    if (typeof names == 'object' && !(names instanceof Array))
      return require.apply(null, Array.prototype.splice.call(arguments, 1, arguments.length - 1));

    // amd require
    if (typeof names == 'string' && typeof callback == 'function')
      names = [names];
    if (names instanceof Array) {
      var dynamicRequires = [];
      for (var i = 0; i < names.length; i++)
        dynamicRequires.push(loader['import'](names[i], referer));
      Promise.all(dynamicRequires).then(function(modules) {
        if (callback)
          callback.apply(null, modules);
      }, errback);
    }

    // commonjs require
    else if (typeof names == 'string') {
      var module = loader.get(names);
      return module.__useDefault ? module['default'] : module;
    }

    else
      throw new TypeError('Invalid require');
  }

  function define(name, deps, factory) {
    if (typeof name != 'string') {
      factory = deps;
      deps = name;
      name = null;
    }
    if (!(deps instanceof Array)) {
      factory = deps;
      deps = ['require', 'exports', 'module'].splice(0, factory.length);
    }

    if (typeof factory != 'function')
      factory = (function(factory) {
        return function() { return factory; }
      })(factory);

    // in IE8, a trailing comma becomes a trailing undefined entry
    if (deps[deps.length - 1] === undefined)
      deps.pop();

    // remove system dependencies
    var requireIndex, exportsIndex, moduleIndex;
    
    if ((requireIndex = indexOf.call(deps, 'require')) != -1) {
      
      deps.splice(requireIndex, 1);

      // only trace cjs requires for non-named
      // named defines assume the trace has already been done
      if (!name)
        deps = deps.concat(getCJSDeps(factory.toString(), requireIndex));
    }

    if ((exportsIndex = indexOf.call(deps, 'exports')) != -1)
      deps.splice(exportsIndex, 1);
    
    if ((moduleIndex = indexOf.call(deps, 'module')) != -1)
      deps.splice(moduleIndex, 1);

    var define = {
      name: name,
      deps: deps,
      execute: function(req, exports, module) {

        var depValues = [];
        for (var i = 0; i < deps.length; i++)
          depValues.push(req(deps[i]));

        module.uri = module.id;

        module.config = function() {};

        // add back in system dependencies
        if (moduleIndex != -1)
          depValues.splice(moduleIndex, 0, module);
        
        if (exportsIndex != -1)
          depValues.splice(exportsIndex, 0, exports);
        
        if (requireIndex != -1) 
          depValues.splice(requireIndex, 0, function(names, callback, errback) {
            if (typeof names == 'string' && typeof callback != 'function')
              return req(names);
            return require.call(loader, names, callback, errback, module.id);
          });

        var output = factory.apply(exportsIndex == -1 ? __global : exports, depValues);

        if (typeof output == 'undefined' && module)
          output = module.exports;

        if (typeof output != 'undefined')
          return output;
      }
    };

    // anonymous define
    if (!name) {
      // already defined anonymously -> throw
      if (lastModule.anonDefine)
        throw new TypeError('Multiple defines for anonymous module');
      lastModule.anonDefine = define;
    }
    // named define
    else {
      // if we don't have any other defines,
      // then let this be an anonymous define
      // this is just to support single modules of the form:
      // define('jquery')
      // still loading anonymously
      // because it is done widely enough to be useful
      if (!lastModule.anonDefine && !lastModule.isBundle) {
        lastModule.anonDefine = define;
      }
      // otherwise its a bundle only
      else {
        // if there is an anonDefine already (we thought it could have had a single named define)
        // then we define it now
        // this is to avoid defining named defines when they are actually anonymous
        if (lastModule.anonDefine && lastModule.anonDefine.name)
          loader.registerDynamic(lastModule.anonDefine.name, lastModule.anonDefine.deps, false, lastModule.anonDefine.execute);

        lastModule.anonDefine = null;
      }

      // note this is now a bundle
      lastModule.isBundle = true;

      // define the module through the register registry
      loader.registerDynamic(name, define.deps, false, define.execute);
    }
  }
  define.amd = {};

  // adds define as a global (potentially just temporarily)
  function createDefine(loader) {
    lastModule.anonDefine = null;
    lastModule.isBundle = false;

    // ensure no NodeJS environment detection
    var oldModule = __global.module;
    var oldExports = __global.exports;
    var oldDefine = __global.define;

    __global.module = undefined;
    __global.exports = undefined;
    __global.define = define;

    return function() {
      __global.define = oldDefine;
      __global.module = oldModule;
      __global.exports = oldExports;
    };
  }

  var lastModule = {
    isBundle: false,
    anonDefine: null
  };

  loader.set('@@amd-helpers', loader.newModule({
    createDefine: createDefine,
    require: require,
    define: define,
    lastModule: lastModule
  }));
  loader.amdDefine = define;
  loader.amdRequire = require;
})(typeof self != 'undefined' ? self : global);

"bundle";
$__System.register("2", [], function() { return { setters: [], execute: function() {} } });

(function() {
var _removeDefine = $__System.get("@@amd-helpers").createDefine();
(function(window, document, undefined) {
  var oldL = window.L,
      L = {};
  L.version = '0.7.7';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = L;
  } else if (typeof define === 'function' && define.amd) {
    define("3", [], L);
  }
  L.noConflict = function() {
    window.L = oldL;
    return this;
  };
  window.L = L;
  L.Util = {
    extend: function(dest) {
      var sources = Array.prototype.slice.call(arguments, 1),
          i,
          j,
          len,
          src;
      for (j = 0, len = sources.length; j < len; j++) {
        src = sources[j] || {};
        for (i in src) {
          if (src.hasOwnProperty(i)) {
            dest[i] = src[i];
          }
        }
      }
      return dest;
    },
    bind: function(fn, obj) {
      var args = arguments.length > 2 ? Array.prototype.slice.call(arguments, 2) : null;
      return function() {
        return fn.apply(obj, args || arguments);
      };
    },
    stamp: (function() {
      var lastId = 0,
          key = '_leaflet_id';
      return function(obj) {
        obj[key] = obj[key] || ++lastId;
        return obj[key];
      };
    }()),
    invokeEach: function(obj, method, context) {
      var i,
          args;
      if (typeof obj === 'object') {
        args = Array.prototype.slice.call(arguments, 3);
        for (i in obj) {
          method.apply(context, [i, obj[i]].concat(args));
        }
        return true;
      }
      return false;
    },
    limitExecByInterval: function(fn, time, context) {
      var lock,
          execOnUnlock;
      return function wrapperFn() {
        var args = arguments;
        if (lock) {
          execOnUnlock = true;
          return;
        }
        lock = true;
        setTimeout(function() {
          lock = false;
          if (execOnUnlock) {
            wrapperFn.apply(context, args);
            execOnUnlock = false;
          }
        }, time);
        fn.apply(context, args);
      };
    },
    falseFn: function() {
      return false;
    },
    formatNum: function(num, digits) {
      var pow = Math.pow(10, digits || 5);
      return Math.round(num * pow) / pow;
    },
    trim: function(str) {
      return str.trim ? str.trim() : str.replace(/^\s+|\s+$/g, '');
    },
    splitWords: function(str) {
      return L.Util.trim(str).split(/\s+/);
    },
    setOptions: function(obj, options) {
      obj.options = L.extend({}, obj.options, options);
      return obj.options;
    },
    getParamString: function(obj, existingUrl, uppercase) {
      var params = [];
      for (var i in obj) {
        params.push(encodeURIComponent(uppercase ? i.toUpperCase() : i) + '=' + encodeURIComponent(obj[i]));
      }
      return ((!existingUrl || existingUrl.indexOf('?') === -1) ? '?' : '&') + params.join('&');
    },
    template: function(str, data) {
      return str.replace(/\{ *([\w_]+) *\}/g, function(str, key) {
        var value = data[key];
        if (value === undefined) {
          throw new Error('No value provided for variable ' + str);
        } else if (typeof value === 'function') {
          value = value(data);
        }
        return value;
      });
    },
    isArray: Array.isArray || function(obj) {
      return (Object.prototype.toString.call(obj) === '[object Array]');
    },
    emptyImageUrl: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
  };
  (function() {
    function getPrefixed(name) {
      var i,
          fn,
          prefixes = ['webkit', 'moz', 'o', 'ms'];
      for (i = 0; i < prefixes.length && !fn; i++) {
        fn = window[prefixes[i] + name];
      }
      return fn;
    }
    var lastTime = 0;
    function timeoutDefer(fn) {
      var time = +new Date(),
          timeToCall = Math.max(0, 16 - (time - lastTime));
      lastTime = time + timeToCall;
      return window.setTimeout(fn, timeToCall);
    }
    var requestFn = window.requestAnimationFrame || getPrefixed('RequestAnimationFrame') || timeoutDefer;
    var cancelFn = window.cancelAnimationFrame || getPrefixed('CancelAnimationFrame') || getPrefixed('CancelRequestAnimationFrame') || function(id) {
      window.clearTimeout(id);
    };
    L.Util.requestAnimFrame = function(fn, context, immediate, element) {
      fn = L.bind(fn, context);
      if (immediate && requestFn === timeoutDefer) {
        fn();
      } else {
        return requestFn.call(window, fn, element);
      }
    };
    L.Util.cancelAnimFrame = function(id) {
      if (id) {
        cancelFn.call(window, id);
      }
    };
  }());
  L.extend = L.Util.extend;
  L.bind = L.Util.bind;
  L.stamp = L.Util.stamp;
  L.setOptions = L.Util.setOptions;
  L.Class = function() {};
  L.Class.extend = function(props) {
    var NewClass = function() {
      if (this.initialize) {
        this.initialize.apply(this, arguments);
      }
      if (this._initHooks) {
        this.callInitHooks();
      }
    };
    var F = function() {};
    F.prototype = this.prototype;
    var proto = new F();
    proto.constructor = NewClass;
    NewClass.prototype = proto;
    for (var i in this) {
      if (this.hasOwnProperty(i) && i !== 'prototype') {
        NewClass[i] = this[i];
      }
    }
    if (props.statics) {
      L.extend(NewClass, props.statics);
      delete props.statics;
    }
    if (props.includes) {
      L.Util.extend.apply(null, [proto].concat(props.includes));
      delete props.includes;
    }
    if (props.options && proto.options) {
      props.options = L.extend({}, proto.options, props.options);
    }
    L.extend(proto, props);
    proto._initHooks = [];
    var parent = this;
    NewClass.__super__ = parent.prototype;
    proto.callInitHooks = function() {
      if (this._initHooksCalled) {
        return;
      }
      if (parent.prototype.callInitHooks) {
        parent.prototype.callInitHooks.call(this);
      }
      this._initHooksCalled = true;
      for (var i = 0,
          len = proto._initHooks.length; i < len; i++) {
        proto._initHooks[i].call(this);
      }
    };
    return NewClass;
  };
  L.Class.include = function(props) {
    L.extend(this.prototype, props);
  };
  L.Class.mergeOptions = function(options) {
    L.extend(this.prototype.options, options);
  };
  L.Class.addInitHook = function(fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    var init = typeof fn === 'function' ? fn : function() {
      this[fn].apply(this, args);
    };
    this.prototype._initHooks = this.prototype._initHooks || [];
    this.prototype._initHooks.push(init);
  };
  var eventsKey = '_leaflet_events';
  L.Mixin = {};
  L.Mixin.Events = {
    addEventListener: function(types, fn, context) {
      if (L.Util.invokeEach(types, this.addEventListener, this, fn, context)) {
        return this;
      }
      var events = this[eventsKey] = this[eventsKey] || {},
          contextId = context && context !== this && L.stamp(context),
          i,
          len,
          event,
          type,
          indexKey,
          indexLenKey,
          typeIndex;
      types = L.Util.splitWords(types);
      for (i = 0, len = types.length; i < len; i++) {
        event = {
          action: fn,
          context: context || this
        };
        type = types[i];
        if (contextId) {
          indexKey = type + '_idx';
          indexLenKey = indexKey + '_len';
          typeIndex = events[indexKey] = events[indexKey] || {};
          if (!typeIndex[contextId]) {
            typeIndex[contextId] = [];
            events[indexLenKey] = (events[indexLenKey] || 0) + 1;
          }
          typeIndex[contextId].push(event);
        } else {
          events[type] = events[type] || [];
          events[type].push(event);
        }
      }
      return this;
    },
    hasEventListeners: function(type) {
      var events = this[eventsKey];
      return !!events && ((type in events && events[type].length > 0) || (type + '_idx' in events && events[type + '_idx_len'] > 0));
    },
    removeEventListener: function(types, fn, context) {
      if (!this[eventsKey]) {
        return this;
      }
      if (!types) {
        return this.clearAllEventListeners();
      }
      if (L.Util.invokeEach(types, this.removeEventListener, this, fn, context)) {
        return this;
      }
      var events = this[eventsKey],
          contextId = context && context !== this && L.stamp(context),
          i,
          len,
          type,
          listeners,
          j,
          indexKey,
          indexLenKey,
          typeIndex,
          removed;
      types = L.Util.splitWords(types);
      for (i = 0, len = types.length; i < len; i++) {
        type = types[i];
        indexKey = type + '_idx';
        indexLenKey = indexKey + '_len';
        typeIndex = events[indexKey];
        if (!fn) {
          delete events[type];
          delete events[indexKey];
          delete events[indexLenKey];
        } else {
          listeners = contextId && typeIndex ? typeIndex[contextId] : events[type];
          if (listeners) {
            for (j = listeners.length - 1; j >= 0; j--) {
              if ((listeners[j].action === fn) && (!context || (listeners[j].context === context))) {
                removed = listeners.splice(j, 1);
                removed[0].action = L.Util.falseFn;
              }
            }
            if (context && typeIndex && (listeners.length === 0)) {
              delete typeIndex[contextId];
              events[indexLenKey]--;
            }
          }
        }
      }
      return this;
    },
    clearAllEventListeners: function() {
      delete this[eventsKey];
      return this;
    },
    fireEvent: function(type, data) {
      if (!this.hasEventListeners(type)) {
        return this;
      }
      var event = L.Util.extend({}, data, {
        type: type,
        target: this
      });
      var events = this[eventsKey],
          listeners,
          i,
          len,
          typeIndex,
          contextId;
      if (events[type]) {
        listeners = events[type].slice();
        for (i = 0, len = listeners.length; i < len; i++) {
          listeners[i].action.call(listeners[i].context, event);
        }
      }
      typeIndex = events[type + '_idx'];
      for (contextId in typeIndex) {
        listeners = typeIndex[contextId].slice();
        if (listeners) {
          for (i = 0, len = listeners.length; i < len; i++) {
            listeners[i].action.call(listeners[i].context, event);
          }
        }
      }
      return this;
    },
    addOneTimeEventListener: function(types, fn, context) {
      if (L.Util.invokeEach(types, this.addOneTimeEventListener, this, fn, context)) {
        return this;
      }
      var handler = L.bind(function() {
        this.removeEventListener(types, fn, context).removeEventListener(types, handler, context);
      }, this);
      return this.addEventListener(types, fn, context).addEventListener(types, handler, context);
    }
  };
  L.Mixin.Events.on = L.Mixin.Events.addEventListener;
  L.Mixin.Events.off = L.Mixin.Events.removeEventListener;
  L.Mixin.Events.once = L.Mixin.Events.addOneTimeEventListener;
  L.Mixin.Events.fire = L.Mixin.Events.fireEvent;
  (function() {
    var ie = 'ActiveXObject' in window,
        ielt9 = ie && !document.addEventListener,
        ua = navigator.userAgent.toLowerCase(),
        webkit = ua.indexOf('webkit') !== -1,
        chrome = ua.indexOf('chrome') !== -1,
        phantomjs = ua.indexOf('phantom') !== -1,
        android = ua.indexOf('android') !== -1,
        android23 = ua.search('android [23]') !== -1,
        gecko = ua.indexOf('gecko') !== -1,
        mobile = typeof orientation !== undefined + '',
        msPointer = !window.PointerEvent && window.MSPointerEvent,
        pointer = (window.PointerEvent && window.navigator.pointerEnabled) || msPointer,
        retina = ('devicePixelRatio' in window && window.devicePixelRatio > 1) || ('matchMedia' in window && window.matchMedia('(min-resolution:144dpi)') && window.matchMedia('(min-resolution:144dpi)').matches),
        doc = document.documentElement,
        ie3d = ie && ('transition' in doc.style),
        webkit3d = ('WebKitCSSMatrix' in window) && ('m11' in new window.WebKitCSSMatrix()) && !android23,
        gecko3d = 'MozPerspective' in doc.style,
        opera3d = 'OTransition' in doc.style,
        any3d = !window.L_DISABLE_3D && (ie3d || webkit3d || gecko3d || opera3d) && !phantomjs;
    var touch = !window.L_NO_TOUCH && !phantomjs && (pointer || 'ontouchstart' in window || (window.DocumentTouch && document instanceof window.DocumentTouch));
    L.Browser = {
      ie: ie,
      ielt9: ielt9,
      webkit: webkit,
      gecko: gecko && !webkit && !window.opera && !ie,
      android: android,
      android23: android23,
      chrome: chrome,
      ie3d: ie3d,
      webkit3d: webkit3d,
      gecko3d: gecko3d,
      opera3d: opera3d,
      any3d: any3d,
      mobile: mobile,
      mobileWebkit: mobile && webkit,
      mobileWebkit3d: mobile && webkit3d,
      mobileOpera: mobile && window.opera,
      touch: touch,
      msPointer: msPointer,
      pointer: pointer,
      retina: retina
    };
  }());
  L.Point = function(x, y, round) {
    this.x = (round ? Math.round(x) : x);
    this.y = (round ? Math.round(y) : y);
  };
  L.Point.prototype = {
    clone: function() {
      return new L.Point(this.x, this.y);
    },
    add: function(point) {
      return this.clone()._add(L.point(point));
    },
    _add: function(point) {
      this.x += point.x;
      this.y += point.y;
      return this;
    },
    subtract: function(point) {
      return this.clone()._subtract(L.point(point));
    },
    _subtract: function(point) {
      this.x -= point.x;
      this.y -= point.y;
      return this;
    },
    divideBy: function(num) {
      return this.clone()._divideBy(num);
    },
    _divideBy: function(num) {
      this.x /= num;
      this.y /= num;
      return this;
    },
    multiplyBy: function(num) {
      return this.clone()._multiplyBy(num);
    },
    _multiplyBy: function(num) {
      this.x *= num;
      this.y *= num;
      return this;
    },
    round: function() {
      return this.clone()._round();
    },
    _round: function() {
      this.x = Math.round(this.x);
      this.y = Math.round(this.y);
      return this;
    },
    floor: function() {
      return this.clone()._floor();
    },
    _floor: function() {
      this.x = Math.floor(this.x);
      this.y = Math.floor(this.y);
      return this;
    },
    distanceTo: function(point) {
      point = L.point(point);
      var x = point.x - this.x,
          y = point.y - this.y;
      return Math.sqrt(x * x + y * y);
    },
    equals: function(point) {
      point = L.point(point);
      return point.x === this.x && point.y === this.y;
    },
    contains: function(point) {
      point = L.point(point);
      return Math.abs(point.x) <= Math.abs(this.x) && Math.abs(point.y) <= Math.abs(this.y);
    },
    toString: function() {
      return 'Point(' + L.Util.formatNum(this.x) + ', ' + L.Util.formatNum(this.y) + ')';
    }
  };
  L.point = function(x, y, round) {
    if (x instanceof L.Point) {
      return x;
    }
    if (L.Util.isArray(x)) {
      return new L.Point(x[0], x[1]);
    }
    if (x === undefined || x === null) {
      return x;
    }
    return new L.Point(x, y, round);
  };
  L.Bounds = function(a, b) {
    if (!a) {
      return;
    }
    var points = b ? [a, b] : a;
    for (var i = 0,
        len = points.length; i < len; i++) {
      this.extend(points[i]);
    }
  };
  L.Bounds.prototype = {
    extend: function(point) {
      point = L.point(point);
      if (!this.min && !this.max) {
        this.min = point.clone();
        this.max = point.clone();
      } else {
        this.min.x = Math.min(point.x, this.min.x);
        this.max.x = Math.max(point.x, this.max.x);
        this.min.y = Math.min(point.y, this.min.y);
        this.max.y = Math.max(point.y, this.max.y);
      }
      return this;
    },
    getCenter: function(round) {
      return new L.Point((this.min.x + this.max.x) / 2, (this.min.y + this.max.y) / 2, round);
    },
    getBottomLeft: function() {
      return new L.Point(this.min.x, this.max.y);
    },
    getTopRight: function() {
      return new L.Point(this.max.x, this.min.y);
    },
    getSize: function() {
      return this.max.subtract(this.min);
    },
    contains: function(obj) {
      var min,
          max;
      if (typeof obj[0] === 'number' || obj instanceof L.Point) {
        obj = L.point(obj);
      } else {
        obj = L.bounds(obj);
      }
      if (obj instanceof L.Bounds) {
        min = obj.min;
        max = obj.max;
      } else {
        min = max = obj;
      }
      return (min.x >= this.min.x) && (max.x <= this.max.x) && (min.y >= this.min.y) && (max.y <= this.max.y);
    },
    intersects: function(bounds) {
      bounds = L.bounds(bounds);
      var min = this.min,
          max = this.max,
          min2 = bounds.min,
          max2 = bounds.max,
          xIntersects = (max2.x >= min.x) && (min2.x <= max.x),
          yIntersects = (max2.y >= min.y) && (min2.y <= max.y);
      return xIntersects && yIntersects;
    },
    isValid: function() {
      return !!(this.min && this.max);
    }
  };
  L.bounds = function(a, b) {
    if (!a || a instanceof L.Bounds) {
      return a;
    }
    return new L.Bounds(a, b);
  };
  L.Transformation = function(a, b, c, d) {
    this._a = a;
    this._b = b;
    this._c = c;
    this._d = d;
  };
  L.Transformation.prototype = {
    transform: function(point, scale) {
      return this._transform(point.clone(), scale);
    },
    _transform: function(point, scale) {
      scale = scale || 1;
      point.x = scale * (this._a * point.x + this._b);
      point.y = scale * (this._c * point.y + this._d);
      return point;
    },
    untransform: function(point, scale) {
      scale = scale || 1;
      return new L.Point((point.x / scale - this._b) / this._a, (point.y / scale - this._d) / this._c);
    }
  };
  L.DomUtil = {
    get: function(id) {
      return (typeof id === 'string' ? document.getElementById(id) : id);
    },
    getStyle: function(el, style) {
      var value = el.style[style];
      if (!value && el.currentStyle) {
        value = el.currentStyle[style];
      }
      if ((!value || value === 'auto') && document.defaultView) {
        var css = document.defaultView.getComputedStyle(el, null);
        value = css ? css[style] : null;
      }
      return value === 'auto' ? null : value;
    },
    getViewportOffset: function(element) {
      var top = 0,
          left = 0,
          el = element,
          docBody = document.body,
          docEl = document.documentElement,
          pos;
      do {
        top += el.offsetTop || 0;
        left += el.offsetLeft || 0;
        top += parseInt(L.DomUtil.getStyle(el, 'borderTopWidth'), 10) || 0;
        left += parseInt(L.DomUtil.getStyle(el, 'borderLeftWidth'), 10) || 0;
        pos = L.DomUtil.getStyle(el, 'position');
        if (el.offsetParent === docBody && pos === 'absolute') {
          break;
        }
        if (pos === 'fixed') {
          top += docBody.scrollTop || docEl.scrollTop || 0;
          left += docBody.scrollLeft || docEl.scrollLeft || 0;
          break;
        }
        if (pos === 'relative' && !el.offsetLeft) {
          var width = L.DomUtil.getStyle(el, 'width'),
              maxWidth = L.DomUtil.getStyle(el, 'max-width'),
              r = el.getBoundingClientRect();
          if (width !== 'none' || maxWidth !== 'none') {
            left += r.left + el.clientLeft;
          }
          top += r.top + (docBody.scrollTop || docEl.scrollTop || 0);
          break;
        }
        el = el.offsetParent;
      } while (el);
      el = element;
      do {
        if (el === docBody) {
          break;
        }
        top -= el.scrollTop || 0;
        left -= el.scrollLeft || 0;
        el = el.parentNode;
      } while (el);
      return new L.Point(left, top);
    },
    documentIsLtr: function() {
      if (!L.DomUtil._docIsLtrCached) {
        L.DomUtil._docIsLtrCached = true;
        L.DomUtil._docIsLtr = L.DomUtil.getStyle(document.body, 'direction') === 'ltr';
      }
      return L.DomUtil._docIsLtr;
    },
    create: function(tagName, className, container) {
      var el = document.createElement(tagName);
      el.className = className;
      if (container) {
        container.appendChild(el);
      }
      return el;
    },
    hasClass: function(el, name) {
      if (el.classList !== undefined) {
        return el.classList.contains(name);
      }
      var className = L.DomUtil._getClass(el);
      return className.length > 0 && new RegExp('(^|\\s)' + name + '(\\s|$)').test(className);
    },
    addClass: function(el, name) {
      if (el.classList !== undefined) {
        var classes = L.Util.splitWords(name);
        for (var i = 0,
            len = classes.length; i < len; i++) {
          el.classList.add(classes[i]);
        }
      } else if (!L.DomUtil.hasClass(el, name)) {
        var className = L.DomUtil._getClass(el);
        L.DomUtil._setClass(el, (className ? className + ' ' : '') + name);
      }
    },
    removeClass: function(el, name) {
      if (el.classList !== undefined) {
        el.classList.remove(name);
      } else {
        L.DomUtil._setClass(el, L.Util.trim((' ' + L.DomUtil._getClass(el) + ' ').replace(' ' + name + ' ', ' ')));
      }
    },
    _setClass: function(el, name) {
      if (el.className.baseVal === undefined) {
        el.className = name;
      } else {
        el.className.baseVal = name;
      }
    },
    _getClass: function(el) {
      return el.className.baseVal === undefined ? el.className : el.className.baseVal;
    },
    setOpacity: function(el, value) {
      if ('opacity' in el.style) {
        el.style.opacity = value;
      } else if ('filter' in el.style) {
        var filter = false,
            filterName = 'DXImageTransform.Microsoft.Alpha';
        try {
          filter = el.filters.item(filterName);
        } catch (e) {
          if (value === 1) {
            return;
          }
        }
        value = Math.round(value * 100);
        if (filter) {
          filter.Enabled = (value !== 100);
          filter.Opacity = value;
        } else {
          el.style.filter += ' progid:' + filterName + '(opacity=' + value + ')';
        }
      }
    },
    testProp: function(props) {
      var style = document.documentElement.style;
      for (var i = 0; i < props.length; i++) {
        if (props[i] in style) {
          return props[i];
        }
      }
      return false;
    },
    getTranslateString: function(point) {
      var is3d = L.Browser.webkit3d,
          open = 'translate' + (is3d ? '3d' : '') + '(',
          close = (is3d ? ',0' : '') + ')';
      return open + point.x + 'px,' + point.y + 'px' + close;
    },
    getScaleString: function(scale, origin) {
      var preTranslateStr = L.DomUtil.getTranslateString(origin.add(origin.multiplyBy(-1 * scale))),
          scaleStr = ' scale(' + scale + ') ';
      return preTranslateStr + scaleStr;
    },
    setPosition: function(el, point, disable3D) {
      el._leaflet_pos = point;
      if (!disable3D && L.Browser.any3d) {
        el.style[L.DomUtil.TRANSFORM] = L.DomUtil.getTranslateString(point);
      } else {
        el.style.left = point.x + 'px';
        el.style.top = point.y + 'px';
      }
    },
    getPosition: function(el) {
      return el._leaflet_pos;
    }
  };
  L.DomUtil.TRANSFORM = L.DomUtil.testProp(['transform', 'WebkitTransform', 'OTransform', 'MozTransform', 'msTransform']);
  L.DomUtil.TRANSITION = L.DomUtil.testProp(['webkitTransition', 'transition', 'OTransition', 'MozTransition', 'msTransition']);
  L.DomUtil.TRANSITION_END = L.DomUtil.TRANSITION === 'webkitTransition' || L.DomUtil.TRANSITION === 'OTransition' ? L.DomUtil.TRANSITION + 'End' : 'transitionend';
  (function() {
    if ('onselectstart' in document) {
      L.extend(L.DomUtil, {
        disableTextSelection: function() {
          L.DomEvent.on(window, 'selectstart', L.DomEvent.preventDefault);
        },
        enableTextSelection: function() {
          L.DomEvent.off(window, 'selectstart', L.DomEvent.preventDefault);
        }
      });
    } else {
      var userSelectProperty = L.DomUtil.testProp(['userSelect', 'WebkitUserSelect', 'OUserSelect', 'MozUserSelect', 'msUserSelect']);
      L.extend(L.DomUtil, {
        disableTextSelection: function() {
          if (userSelectProperty) {
            var style = document.documentElement.style;
            this._userSelect = style[userSelectProperty];
            style[userSelectProperty] = 'none';
          }
        },
        enableTextSelection: function() {
          if (userSelectProperty) {
            document.documentElement.style[userSelectProperty] = this._userSelect;
            delete this._userSelect;
          }
        }
      });
    }
    L.extend(L.DomUtil, {
      disableImageDrag: function() {
        L.DomEvent.on(window, 'dragstart', L.DomEvent.preventDefault);
      },
      enableImageDrag: function() {
        L.DomEvent.off(window, 'dragstart', L.DomEvent.preventDefault);
      }
    });
  })();
  L.LatLng = function(lat, lng, alt) {
    lat = parseFloat(lat);
    lng = parseFloat(lng);
    if (isNaN(lat) || isNaN(lng)) {
      throw new Error('Invalid LatLng object: (' + lat + ', ' + lng + ')');
    }
    this.lat = lat;
    this.lng = lng;
    if (alt !== undefined) {
      this.alt = parseFloat(alt);
    }
  };
  L.extend(L.LatLng, {
    DEG_TO_RAD: Math.PI / 180,
    RAD_TO_DEG: 180 / Math.PI,
    MAX_MARGIN: 1.0E-9
  });
  L.LatLng.prototype = {
    equals: function(obj) {
      if (!obj) {
        return false;
      }
      obj = L.latLng(obj);
      var margin = Math.max(Math.abs(this.lat - obj.lat), Math.abs(this.lng - obj.lng));
      return margin <= L.LatLng.MAX_MARGIN;
    },
    toString: function(precision) {
      return 'LatLng(' + L.Util.formatNum(this.lat, precision) + ', ' + L.Util.formatNum(this.lng, precision) + ')';
    },
    distanceTo: function(other) {
      other = L.latLng(other);
      var R = 6378137,
          d2r = L.LatLng.DEG_TO_RAD,
          dLat = (other.lat - this.lat) * d2r,
          dLon = (other.lng - this.lng) * d2r,
          lat1 = this.lat * d2r,
          lat2 = other.lat * d2r,
          sin1 = Math.sin(dLat / 2),
          sin2 = Math.sin(dLon / 2);
      var a = sin1 * sin1 + sin2 * sin2 * Math.cos(lat1) * Math.cos(lat2);
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    },
    wrap: function(a, b) {
      var lng = this.lng;
      a = a || -180;
      b = b || 180;
      lng = (lng + b) % (b - a) + (lng < a || lng === b ? b : a);
      return new L.LatLng(this.lat, lng);
    }
  };
  L.latLng = function(a, b) {
    if (a instanceof L.LatLng) {
      return a;
    }
    if (L.Util.isArray(a)) {
      if (typeof a[0] === 'number' || typeof a[0] === 'string') {
        return new L.LatLng(a[0], a[1], a[2]);
      } else {
        return null;
      }
    }
    if (a === undefined || a === null) {
      return a;
    }
    if (typeof a === 'object' && 'lat' in a) {
      return new L.LatLng(a.lat, 'lng' in a ? a.lng : a.lon);
    }
    if (b === undefined) {
      return null;
    }
    return new L.LatLng(a, b);
  };
  L.LatLngBounds = function(southWest, northEast) {
    if (!southWest) {
      return;
    }
    var latlngs = northEast ? [southWest, northEast] : southWest;
    for (var i = 0,
        len = latlngs.length; i < len; i++) {
      this.extend(latlngs[i]);
    }
  };
  L.LatLngBounds.prototype = {
    extend: function(obj) {
      if (!obj) {
        return this;
      }
      var latLng = L.latLng(obj);
      if (latLng !== null) {
        obj = latLng;
      } else {
        obj = L.latLngBounds(obj);
      }
      if (obj instanceof L.LatLng) {
        if (!this._southWest && !this._northEast) {
          this._southWest = new L.LatLng(obj.lat, obj.lng);
          this._northEast = new L.LatLng(obj.lat, obj.lng);
        } else {
          this._southWest.lat = Math.min(obj.lat, this._southWest.lat);
          this._southWest.lng = Math.min(obj.lng, this._southWest.lng);
          this._northEast.lat = Math.max(obj.lat, this._northEast.lat);
          this._northEast.lng = Math.max(obj.lng, this._northEast.lng);
        }
      } else if (obj instanceof L.LatLngBounds) {
        this.extend(obj._southWest);
        this.extend(obj._northEast);
      }
      return this;
    },
    pad: function(bufferRatio) {
      var sw = this._southWest,
          ne = this._northEast,
          heightBuffer = Math.abs(sw.lat - ne.lat) * bufferRatio,
          widthBuffer = Math.abs(sw.lng - ne.lng) * bufferRatio;
      return new L.LatLngBounds(new L.LatLng(sw.lat - heightBuffer, sw.lng - widthBuffer), new L.LatLng(ne.lat + heightBuffer, ne.lng + widthBuffer));
    },
    getCenter: function() {
      return new L.LatLng((this._southWest.lat + this._northEast.lat) / 2, (this._southWest.lng + this._northEast.lng) / 2);
    },
    getSouthWest: function() {
      return this._southWest;
    },
    getNorthEast: function() {
      return this._northEast;
    },
    getNorthWest: function() {
      return new L.LatLng(this.getNorth(), this.getWest());
    },
    getSouthEast: function() {
      return new L.LatLng(this.getSouth(), this.getEast());
    },
    getWest: function() {
      return this._southWest.lng;
    },
    getSouth: function() {
      return this._southWest.lat;
    },
    getEast: function() {
      return this._northEast.lng;
    },
    getNorth: function() {
      return this._northEast.lat;
    },
    contains: function(obj) {
      if (typeof obj[0] === 'number' || obj instanceof L.LatLng) {
        obj = L.latLng(obj);
      } else {
        obj = L.latLngBounds(obj);
      }
      var sw = this._southWest,
          ne = this._northEast,
          sw2,
          ne2;
      if (obj instanceof L.LatLngBounds) {
        sw2 = obj.getSouthWest();
        ne2 = obj.getNorthEast();
      } else {
        sw2 = ne2 = obj;
      }
      return (sw2.lat >= sw.lat) && (ne2.lat <= ne.lat) && (sw2.lng >= sw.lng) && (ne2.lng <= ne.lng);
    },
    intersects: function(bounds) {
      bounds = L.latLngBounds(bounds);
      var sw = this._southWest,
          ne = this._northEast,
          sw2 = bounds.getSouthWest(),
          ne2 = bounds.getNorthEast(),
          latIntersects = (ne2.lat >= sw.lat) && (sw2.lat <= ne.lat),
          lngIntersects = (ne2.lng >= sw.lng) && (sw2.lng <= ne.lng);
      return latIntersects && lngIntersects;
    },
    toBBoxString: function() {
      return [this.getWest(), this.getSouth(), this.getEast(), this.getNorth()].join(',');
    },
    equals: function(bounds) {
      if (!bounds) {
        return false;
      }
      bounds = L.latLngBounds(bounds);
      return this._southWest.equals(bounds.getSouthWest()) && this._northEast.equals(bounds.getNorthEast());
    },
    isValid: function() {
      return !!(this._southWest && this._northEast);
    }
  };
  L.latLngBounds = function(a, b) {
    if (!a || a instanceof L.LatLngBounds) {
      return a;
    }
    return new L.LatLngBounds(a, b);
  };
  L.Projection = {};
  L.Projection.SphericalMercator = {
    MAX_LATITUDE: 85.0511287798,
    project: function(latlng) {
      var d = L.LatLng.DEG_TO_RAD,
          max = this.MAX_LATITUDE,
          lat = Math.max(Math.min(max, latlng.lat), -max),
          x = latlng.lng * d,
          y = lat * d;
      y = Math.log(Math.tan((Math.PI / 4) + (y / 2)));
      return new L.Point(x, y);
    },
    unproject: function(point) {
      var d = L.LatLng.RAD_TO_DEG,
          lng = point.x * d,
          lat = (2 * Math.atan(Math.exp(point.y)) - (Math.PI / 2)) * d;
      return new L.LatLng(lat, lng);
    }
  };
  L.Projection.LonLat = {
    project: function(latlng) {
      return new L.Point(latlng.lng, latlng.lat);
    },
    unproject: function(point) {
      return new L.LatLng(point.y, point.x);
    }
  };
  L.CRS = {
    latLngToPoint: function(latlng, zoom) {
      var projectedPoint = this.projection.project(latlng),
          scale = this.scale(zoom);
      return this.transformation._transform(projectedPoint, scale);
    },
    pointToLatLng: function(point, zoom) {
      var scale = this.scale(zoom),
          untransformedPoint = this.transformation.untransform(point, scale);
      return this.projection.unproject(untransformedPoint);
    },
    project: function(latlng) {
      return this.projection.project(latlng);
    },
    scale: function(zoom) {
      return 256 * Math.pow(2, zoom);
    },
    getSize: function(zoom) {
      var s = this.scale(zoom);
      return L.point(s, s);
    }
  };
  L.CRS.Simple = L.extend({}, L.CRS, {
    projection: L.Projection.LonLat,
    transformation: new L.Transformation(1, 0, -1, 0),
    scale: function(zoom) {
      return Math.pow(2, zoom);
    }
  });
  L.CRS.EPSG3857 = L.extend({}, L.CRS, {
    code: 'EPSG:3857',
    projection: L.Projection.SphericalMercator,
    transformation: new L.Transformation(0.5 / Math.PI, 0.5, -0.5 / Math.PI, 0.5),
    project: function(latlng) {
      var projectedPoint = this.projection.project(latlng),
          earthRadius = 6378137;
      return projectedPoint.multiplyBy(earthRadius);
    }
  });
  L.CRS.EPSG900913 = L.extend({}, L.CRS.EPSG3857, {code: 'EPSG:900913'});
  L.CRS.EPSG4326 = L.extend({}, L.CRS, {
    code: 'EPSG:4326',
    projection: L.Projection.LonLat,
    transformation: new L.Transformation(1 / 360, 0.5, -1 / 360, 0.5)
  });
  L.Map = L.Class.extend({
    includes: L.Mixin.Events,
    options: {
      crs: L.CRS.EPSG3857,
      fadeAnimation: L.DomUtil.TRANSITION && !L.Browser.android23,
      trackResize: true,
      markerZoomAnimation: L.DomUtil.TRANSITION && L.Browser.any3d
    },
    initialize: function(id, options) {
      options = L.setOptions(this, options);
      this._initContainer(id);
      this._initLayout();
      this._onResize = L.bind(this._onResize, this);
      this._initEvents();
      if (options.maxBounds) {
        this.setMaxBounds(options.maxBounds);
      }
      if (options.center && options.zoom !== undefined) {
        this.setView(L.latLng(options.center), options.zoom, {reset: true});
      }
      this._handlers = [];
      this._layers = {};
      this._zoomBoundLayers = {};
      this._tileLayersNum = 0;
      this.callInitHooks();
      this._addLayers(options.layers);
    },
    setView: function(center, zoom) {
      zoom = zoom === undefined ? this.getZoom() : zoom;
      this._resetView(L.latLng(center), this._limitZoom(zoom));
      return this;
    },
    setZoom: function(zoom, options) {
      if (!this._loaded) {
        this._zoom = this._limitZoom(zoom);
        return this;
      }
      return this.setView(this.getCenter(), zoom, {zoom: options});
    },
    zoomIn: function(delta, options) {
      return this.setZoom(this._zoom + (delta || 1), options);
    },
    zoomOut: function(delta, options) {
      return this.setZoom(this._zoom - (delta || 1), options);
    },
    setZoomAround: function(latlng, zoom, options) {
      var scale = this.getZoomScale(zoom),
          viewHalf = this.getSize().divideBy(2),
          containerPoint = latlng instanceof L.Point ? latlng : this.latLngToContainerPoint(latlng),
          centerOffset = containerPoint.subtract(viewHalf).multiplyBy(1 - 1 / scale),
          newCenter = this.containerPointToLatLng(viewHalf.add(centerOffset));
      return this.setView(newCenter, zoom, {zoom: options});
    },
    fitBounds: function(bounds, options) {
      options = options || {};
      bounds = bounds.getBounds ? bounds.getBounds() : L.latLngBounds(bounds);
      var paddingTL = L.point(options.paddingTopLeft || options.padding || [0, 0]),
          paddingBR = L.point(options.paddingBottomRight || options.padding || [0, 0]),
          zoom = this.getBoundsZoom(bounds, false, paddingTL.add(paddingBR));
      zoom = (options.maxZoom) ? Math.min(options.maxZoom, zoom) : zoom;
      var paddingOffset = paddingBR.subtract(paddingTL).divideBy(2),
          swPoint = this.project(bounds.getSouthWest(), zoom),
          nePoint = this.project(bounds.getNorthEast(), zoom),
          center = this.unproject(swPoint.add(nePoint).divideBy(2).add(paddingOffset), zoom);
      return this.setView(center, zoom, options);
    },
    fitWorld: function(options) {
      return this.fitBounds([[-90, -180], [90, 180]], options);
    },
    panTo: function(center, options) {
      return this.setView(center, this._zoom, {pan: options});
    },
    panBy: function(offset) {
      this.fire('movestart');
      this._rawPanBy(L.point(offset));
      this.fire('move');
      return this.fire('moveend');
    },
    setMaxBounds: function(bounds) {
      bounds = L.latLngBounds(bounds);
      this.options.maxBounds = bounds;
      if (!bounds) {
        return this.off('moveend', this._panInsideMaxBounds, this);
      }
      if (this._loaded) {
        this._panInsideMaxBounds();
      }
      return this.on('moveend', this._panInsideMaxBounds, this);
    },
    panInsideBounds: function(bounds, options) {
      var center = this.getCenter(),
          newCenter = this._limitCenter(center, this._zoom, bounds);
      if (center.equals(newCenter)) {
        return this;
      }
      return this.panTo(newCenter, options);
    },
    addLayer: function(layer) {
      var id = L.stamp(layer);
      if (this._layers[id]) {
        return this;
      }
      this._layers[id] = layer;
      if (layer.options && (!isNaN(layer.options.maxZoom) || !isNaN(layer.options.minZoom))) {
        this._zoomBoundLayers[id] = layer;
        this._updateZoomLevels();
      }
      if (this.options.zoomAnimation && L.TileLayer && (layer instanceof L.TileLayer)) {
        this._tileLayersNum++;
        this._tileLayersToLoad++;
        layer.on('load', this._onTileLayerLoad, this);
      }
      if (this._loaded) {
        this._layerAdd(layer);
      }
      return this;
    },
    removeLayer: function(layer) {
      var id = L.stamp(layer);
      if (!this._layers[id]) {
        return this;
      }
      if (this._loaded) {
        layer.onRemove(this);
      }
      delete this._layers[id];
      if (this._loaded) {
        this.fire('layerremove', {layer: layer});
      }
      if (this._zoomBoundLayers[id]) {
        delete this._zoomBoundLayers[id];
        this._updateZoomLevels();
      }
      if (this.options.zoomAnimation && L.TileLayer && (layer instanceof L.TileLayer)) {
        this._tileLayersNum--;
        this._tileLayersToLoad--;
        layer.off('load', this._onTileLayerLoad, this);
      }
      return this;
    },
    hasLayer: function(layer) {
      if (!layer) {
        return false;
      }
      return (L.stamp(layer) in this._layers);
    },
    eachLayer: function(method, context) {
      for (var i in this._layers) {
        method.call(context, this._layers[i]);
      }
      return this;
    },
    invalidateSize: function(options) {
      if (!this._loaded) {
        return this;
      }
      options = L.extend({
        animate: false,
        pan: true
      }, options === true ? {animate: true} : options);
      var oldSize = this.getSize();
      this._sizeChanged = true;
      this._initialCenter = null;
      var newSize = this.getSize(),
          oldCenter = oldSize.divideBy(2).round(),
          newCenter = newSize.divideBy(2).round(),
          offset = oldCenter.subtract(newCenter);
      if (!offset.x && !offset.y) {
        return this;
      }
      if (options.animate && options.pan) {
        this.panBy(offset);
      } else {
        if (options.pan) {
          this._rawPanBy(offset);
        }
        this.fire('move');
        if (options.debounceMoveend) {
          clearTimeout(this._sizeTimer);
          this._sizeTimer = setTimeout(L.bind(this.fire, this, 'moveend'), 200);
        } else {
          this.fire('moveend');
        }
      }
      return this.fire('resize', {
        oldSize: oldSize,
        newSize: newSize
      });
    },
    addHandler: function(name, HandlerClass) {
      if (!HandlerClass) {
        return this;
      }
      var handler = this[name] = new HandlerClass(this);
      this._handlers.push(handler);
      if (this.options[name]) {
        handler.enable();
      }
      return this;
    },
    remove: function() {
      if (this._loaded) {
        this.fire('unload');
      }
      this._initEvents('off');
      try {
        delete this._container._leaflet;
      } catch (e) {
        this._container._leaflet = undefined;
      }
      this._clearPanes();
      if (this._clearControlPos) {
        this._clearControlPos();
      }
      this._clearHandlers();
      return this;
    },
    getCenter: function() {
      this._checkIfLoaded();
      if (this._initialCenter && !this._moved()) {
        return this._initialCenter;
      }
      return this.layerPointToLatLng(this._getCenterLayerPoint());
    },
    getZoom: function() {
      return this._zoom;
    },
    getBounds: function() {
      var bounds = this.getPixelBounds(),
          sw = this.unproject(bounds.getBottomLeft()),
          ne = this.unproject(bounds.getTopRight());
      return new L.LatLngBounds(sw, ne);
    },
    getMinZoom: function() {
      return this.options.minZoom === undefined ? (this._layersMinZoom === undefined ? 0 : this._layersMinZoom) : this.options.minZoom;
    },
    getMaxZoom: function() {
      return this.options.maxZoom === undefined ? (this._layersMaxZoom === undefined ? Infinity : this._layersMaxZoom) : this.options.maxZoom;
    },
    getBoundsZoom: function(bounds, inside, padding) {
      bounds = L.latLngBounds(bounds);
      var zoom = this.getMinZoom() - (inside ? 1 : 0),
          maxZoom = this.getMaxZoom(),
          size = this.getSize(),
          nw = bounds.getNorthWest(),
          se = bounds.getSouthEast(),
          zoomNotFound = true,
          boundsSize;
      padding = L.point(padding || [0, 0]);
      do {
        zoom++;
        boundsSize = this.project(se, zoom).subtract(this.project(nw, zoom)).add(padding);
        zoomNotFound = !inside ? size.contains(boundsSize) : boundsSize.x < size.x || boundsSize.y < size.y;
      } while (zoomNotFound && zoom <= maxZoom);
      if (zoomNotFound && inside) {
        return null;
      }
      return inside ? zoom : zoom - 1;
    },
    getSize: function() {
      if (!this._size || this._sizeChanged) {
        this._size = new L.Point(this._container.clientWidth, this._container.clientHeight);
        this._sizeChanged = false;
      }
      return this._size.clone();
    },
    getPixelBounds: function() {
      var topLeftPoint = this._getTopLeftPoint();
      return new L.Bounds(topLeftPoint, topLeftPoint.add(this.getSize()));
    },
    getPixelOrigin: function() {
      this._checkIfLoaded();
      return this._initialTopLeftPoint;
    },
    getPanes: function() {
      return this._panes;
    },
    getContainer: function() {
      return this._container;
    },
    getZoomScale: function(toZoom) {
      var crs = this.options.crs;
      return crs.scale(toZoom) / crs.scale(this._zoom);
    },
    getScaleZoom: function(scale) {
      return this._zoom + (Math.log(scale) / Math.LN2);
    },
    project: function(latlng, zoom) {
      zoom = zoom === undefined ? this._zoom : zoom;
      return this.options.crs.latLngToPoint(L.latLng(latlng), zoom);
    },
    unproject: function(point, zoom) {
      zoom = zoom === undefined ? this._zoom : zoom;
      return this.options.crs.pointToLatLng(L.point(point), zoom);
    },
    layerPointToLatLng: function(point) {
      var projectedPoint = L.point(point).add(this.getPixelOrigin());
      return this.unproject(projectedPoint);
    },
    latLngToLayerPoint: function(latlng) {
      var projectedPoint = this.project(L.latLng(latlng))._round();
      return projectedPoint._subtract(this.getPixelOrigin());
    },
    containerPointToLayerPoint: function(point) {
      return L.point(point).subtract(this._getMapPanePos());
    },
    layerPointToContainerPoint: function(point) {
      return L.point(point).add(this._getMapPanePos());
    },
    containerPointToLatLng: function(point) {
      var layerPoint = this.containerPointToLayerPoint(L.point(point));
      return this.layerPointToLatLng(layerPoint);
    },
    latLngToContainerPoint: function(latlng) {
      return this.layerPointToContainerPoint(this.latLngToLayerPoint(L.latLng(latlng)));
    },
    mouseEventToContainerPoint: function(e) {
      return L.DomEvent.getMousePosition(e, this._container);
    },
    mouseEventToLayerPoint: function(e) {
      return this.containerPointToLayerPoint(this.mouseEventToContainerPoint(e));
    },
    mouseEventToLatLng: function(e) {
      return this.layerPointToLatLng(this.mouseEventToLayerPoint(e));
    },
    _initContainer: function(id) {
      var container = this._container = L.DomUtil.get(id);
      if (!container) {
        throw new Error('Map container not found.');
      } else if (container._leaflet) {
        throw new Error('Map container is already initialized.');
      }
      container._leaflet = true;
    },
    _initLayout: function() {
      var container = this._container;
      L.DomUtil.addClass(container, 'leaflet-container' + (L.Browser.touch ? ' leaflet-touch' : '') + (L.Browser.retina ? ' leaflet-retina' : '') + (L.Browser.ielt9 ? ' leaflet-oldie' : '') + (this.options.fadeAnimation ? ' leaflet-fade-anim' : ''));
      var position = L.DomUtil.getStyle(container, 'position');
      if (position !== 'absolute' && position !== 'relative' && position !== 'fixed') {
        container.style.position = 'relative';
      }
      this._initPanes();
      if (this._initControlPos) {
        this._initControlPos();
      }
    },
    _initPanes: function() {
      var panes = this._panes = {};
      this._mapPane = panes.mapPane = this._createPane('leaflet-map-pane', this._container);
      this._tilePane = panes.tilePane = this._createPane('leaflet-tile-pane', this._mapPane);
      panes.objectsPane = this._createPane('leaflet-objects-pane', this._mapPane);
      panes.shadowPane = this._createPane('leaflet-shadow-pane');
      panes.overlayPane = this._createPane('leaflet-overlay-pane');
      panes.markerPane = this._createPane('leaflet-marker-pane');
      panes.popupPane = this._createPane('leaflet-popup-pane');
      var zoomHide = ' leaflet-zoom-hide';
      if (!this.options.markerZoomAnimation) {
        L.DomUtil.addClass(panes.markerPane, zoomHide);
        L.DomUtil.addClass(panes.shadowPane, zoomHide);
        L.DomUtil.addClass(panes.popupPane, zoomHide);
      }
    },
    _createPane: function(className, container) {
      return L.DomUtil.create('div', className, container || this._panes.objectsPane);
    },
    _clearPanes: function() {
      this._container.removeChild(this._mapPane);
    },
    _addLayers: function(layers) {
      layers = layers ? (L.Util.isArray(layers) ? layers : [layers]) : [];
      for (var i = 0,
          len = layers.length; i < len; i++) {
        this.addLayer(layers[i]);
      }
    },
    _resetView: function(center, zoom, preserveMapOffset, afterZoomAnim) {
      var zoomChanged = (this._zoom !== zoom);
      if (!afterZoomAnim) {
        this.fire('movestart');
        if (zoomChanged) {
          this.fire('zoomstart');
        }
      }
      this._zoom = zoom;
      this._initialCenter = center;
      this._initialTopLeftPoint = this._getNewTopLeftPoint(center);
      if (!preserveMapOffset) {
        L.DomUtil.setPosition(this._mapPane, new L.Point(0, 0));
      } else {
        this._initialTopLeftPoint._add(this._getMapPanePos());
      }
      this._tileLayersToLoad = this._tileLayersNum;
      var loading = !this._loaded;
      this._loaded = true;
      this.fire('viewreset', {hard: !preserveMapOffset});
      if (loading) {
        this.fire('load');
        this.eachLayer(this._layerAdd, this);
      }
      this.fire('move');
      if (zoomChanged || afterZoomAnim) {
        this.fire('zoomend');
      }
      this.fire('moveend', {hard: !preserveMapOffset});
    },
    _rawPanBy: function(offset) {
      L.DomUtil.setPosition(this._mapPane, this._getMapPanePos().subtract(offset));
    },
    _getZoomSpan: function() {
      return this.getMaxZoom() - this.getMinZoom();
    },
    _updateZoomLevels: function() {
      var i,
          minZoom = Infinity,
          maxZoom = -Infinity,
          oldZoomSpan = this._getZoomSpan();
      for (i in this._zoomBoundLayers) {
        var layer = this._zoomBoundLayers[i];
        if (!isNaN(layer.options.minZoom)) {
          minZoom = Math.min(minZoom, layer.options.minZoom);
        }
        if (!isNaN(layer.options.maxZoom)) {
          maxZoom = Math.max(maxZoom, layer.options.maxZoom);
        }
      }
      if (i === undefined) {
        this._layersMaxZoom = this._layersMinZoom = undefined;
      } else {
        this._layersMaxZoom = maxZoom;
        this._layersMinZoom = minZoom;
      }
      if (oldZoomSpan !== this._getZoomSpan()) {
        this.fire('zoomlevelschange');
      }
    },
    _panInsideMaxBounds: function() {
      this.panInsideBounds(this.options.maxBounds);
    },
    _checkIfLoaded: function() {
      if (!this._loaded) {
        throw new Error('Set map center and zoom first.');
      }
    },
    _initEvents: function(onOff) {
      if (!L.DomEvent) {
        return;
      }
      onOff = onOff || 'on';
      L.DomEvent[onOff](this._container, 'click', this._onMouseClick, this);
      var events = ['dblclick', 'mousedown', 'mouseup', 'mouseenter', 'mouseleave', 'mousemove', 'contextmenu'],
          i,
          len;
      for (i = 0, len = events.length; i < len; i++) {
        L.DomEvent[onOff](this._container, events[i], this._fireMouseEvent, this);
      }
      if (this.options.trackResize) {
        L.DomEvent[onOff](window, 'resize', this._onResize, this);
      }
    },
    _onResize: function() {
      L.Util.cancelAnimFrame(this._resizeRequest);
      this._resizeRequest = L.Util.requestAnimFrame(function() {
        this.invalidateSize({debounceMoveend: true});
      }, this, false, this._container);
    },
    _onMouseClick: function(e) {
      if (!this._loaded || (!e._simulated && ((this.dragging && this.dragging.moved()) || (this.boxZoom && this.boxZoom.moved()))) || L.DomEvent._skipped(e)) {
        return;
      }
      this.fire('preclick');
      this._fireMouseEvent(e);
    },
    _fireMouseEvent: function(e) {
      if (!this._loaded || L.DomEvent._skipped(e)) {
        return;
      }
      var type = e.type;
      type = (type === 'mouseenter' ? 'mouseover' : (type === 'mouseleave' ? 'mouseout' : type));
      if (!this.hasEventListeners(type)) {
        return;
      }
      if (type === 'contextmenu') {
        L.DomEvent.preventDefault(e);
      }
      var containerPoint = this.mouseEventToContainerPoint(e),
          layerPoint = this.containerPointToLayerPoint(containerPoint),
          latlng = this.layerPointToLatLng(layerPoint);
      this.fire(type, {
        latlng: latlng,
        layerPoint: layerPoint,
        containerPoint: containerPoint,
        originalEvent: e
      });
    },
    _onTileLayerLoad: function() {
      this._tileLayersToLoad--;
      if (this._tileLayersNum && !this._tileLayersToLoad) {
        this.fire('tilelayersload');
      }
    },
    _clearHandlers: function() {
      for (var i = 0,
          len = this._handlers.length; i < len; i++) {
        this._handlers[i].disable();
      }
    },
    whenReady: function(callback, context) {
      if (this._loaded) {
        callback.call(context || this, this);
      } else {
        this.on('load', callback, context);
      }
      return this;
    },
    _layerAdd: function(layer) {
      layer.onAdd(this);
      this.fire('layeradd', {layer: layer});
    },
    _getMapPanePos: function() {
      return L.DomUtil.getPosition(this._mapPane);
    },
    _moved: function() {
      var pos = this._getMapPanePos();
      return pos && !pos.equals([0, 0]);
    },
    _getTopLeftPoint: function() {
      return this.getPixelOrigin().subtract(this._getMapPanePos());
    },
    _getNewTopLeftPoint: function(center, zoom) {
      var viewHalf = this.getSize()._divideBy(2);
      return this.project(center, zoom)._subtract(viewHalf)._round();
    },
    _latLngToNewLayerPoint: function(latlng, newZoom, newCenter) {
      var topLeft = this._getNewTopLeftPoint(newCenter, newZoom).add(this._getMapPanePos());
      return this.project(latlng, newZoom)._subtract(topLeft);
    },
    _getCenterLayerPoint: function() {
      return this.containerPointToLayerPoint(this.getSize()._divideBy(2));
    },
    _getCenterOffset: function(latlng) {
      return this.latLngToLayerPoint(latlng).subtract(this._getCenterLayerPoint());
    },
    _limitCenter: function(center, zoom, bounds) {
      if (!bounds) {
        return center;
      }
      var centerPoint = this.project(center, zoom),
          viewHalf = this.getSize().divideBy(2),
          viewBounds = new L.Bounds(centerPoint.subtract(viewHalf), centerPoint.add(viewHalf)),
          offset = this._getBoundsOffset(viewBounds, bounds, zoom);
      return this.unproject(centerPoint.add(offset), zoom);
    },
    _limitOffset: function(offset, bounds) {
      if (!bounds) {
        return offset;
      }
      var viewBounds = this.getPixelBounds(),
          newBounds = new L.Bounds(viewBounds.min.add(offset), viewBounds.max.add(offset));
      return offset.add(this._getBoundsOffset(newBounds, bounds));
    },
    _getBoundsOffset: function(pxBounds, maxBounds, zoom) {
      var nwOffset = this.project(maxBounds.getNorthWest(), zoom).subtract(pxBounds.min),
          seOffset = this.project(maxBounds.getSouthEast(), zoom).subtract(pxBounds.max),
          dx = this._rebound(nwOffset.x, -seOffset.x),
          dy = this._rebound(nwOffset.y, -seOffset.y);
      return new L.Point(dx, dy);
    },
    _rebound: function(left, right) {
      return left + right > 0 ? Math.round(left - right) / 2 : Math.max(0, Math.ceil(left)) - Math.max(0, Math.floor(right));
    },
    _limitZoom: function(zoom) {
      var min = this.getMinZoom(),
          max = this.getMaxZoom();
      return Math.max(min, Math.min(max, zoom));
    }
  });
  L.map = function(id, options) {
    return new L.Map(id, options);
  };
  L.Projection.Mercator = {
    MAX_LATITUDE: 85.0840591556,
    R_MINOR: 6356752.314245179,
    R_MAJOR: 6378137,
    project: function(latlng) {
      var d = L.LatLng.DEG_TO_RAD,
          max = this.MAX_LATITUDE,
          lat = Math.max(Math.min(max, latlng.lat), -max),
          r = this.R_MAJOR,
          r2 = this.R_MINOR,
          x = latlng.lng * d * r,
          y = lat * d,
          tmp = r2 / r,
          eccent = Math.sqrt(1.0 - tmp * tmp),
          con = eccent * Math.sin(y);
      con = Math.pow((1 - con) / (1 + con), eccent * 0.5);
      var ts = Math.tan(0.5 * ((Math.PI * 0.5) - y)) / con;
      y = -r * Math.log(ts);
      return new L.Point(x, y);
    },
    unproject: function(point) {
      var d = L.LatLng.RAD_TO_DEG,
          r = this.R_MAJOR,
          r2 = this.R_MINOR,
          lng = point.x * d / r,
          tmp = r2 / r,
          eccent = Math.sqrt(1 - (tmp * tmp)),
          ts = Math.exp(-point.y / r),
          phi = (Math.PI / 2) - 2 * Math.atan(ts),
          numIter = 15,
          tol = 1e-7,
          i = numIter,
          dphi = 0.1,
          con;
      while ((Math.abs(dphi) > tol) && (--i > 0)) {
        con = eccent * Math.sin(phi);
        dphi = (Math.PI / 2) - 2 * Math.atan(ts * Math.pow((1.0 - con) / (1.0 + con), 0.5 * eccent)) - phi;
        phi += dphi;
      }
      return new L.LatLng(phi * d, lng);
    }
  };
  L.CRS.EPSG3395 = L.extend({}, L.CRS, {
    code: 'EPSG:3395',
    projection: L.Projection.Mercator,
    transformation: (function() {
      var m = L.Projection.Mercator,
          r = m.R_MAJOR,
          scale = 0.5 / (Math.PI * r);
      return new L.Transformation(scale, 0.5, -scale, 0.5);
    }())
  });
  L.TileLayer = L.Class.extend({
    includes: L.Mixin.Events,
    options: {
      minZoom: 0,
      maxZoom: 18,
      tileSize: 256,
      subdomains: 'abc',
      errorTileUrl: '',
      attribution: '',
      zoomOffset: 0,
      opacity: 1,
      unloadInvisibleTiles: L.Browser.mobile,
      updateWhenIdle: L.Browser.mobile
    },
    initialize: function(url, options) {
      options = L.setOptions(this, options);
      if (options.detectRetina && L.Browser.retina && options.maxZoom > 0) {
        options.tileSize = Math.floor(options.tileSize / 2);
        options.zoomOffset++;
        if (options.minZoom > 0) {
          options.minZoom--;
        }
        this.options.maxZoom--;
      }
      if (options.bounds) {
        options.bounds = L.latLngBounds(options.bounds);
      }
      this._url = url;
      var subdomains = this.options.subdomains;
      if (typeof subdomains === 'string') {
        this.options.subdomains = subdomains.split('');
      }
    },
    onAdd: function(map) {
      this._map = map;
      this._animated = map._zoomAnimated;
      this._initContainer();
      map.on({
        'viewreset': this._reset,
        'moveend': this._update
      }, this);
      if (this._animated) {
        map.on({
          'zoomanim': this._animateZoom,
          'zoomend': this._endZoomAnim
        }, this);
      }
      if (!this.options.updateWhenIdle) {
        this._limitedUpdate = L.Util.limitExecByInterval(this._update, 150, this);
        map.on('move', this._limitedUpdate, this);
      }
      this._reset();
      this._update();
    },
    addTo: function(map) {
      map.addLayer(this);
      return this;
    },
    onRemove: function(map) {
      this._container.parentNode.removeChild(this._container);
      map.off({
        'viewreset': this._reset,
        'moveend': this._update
      }, this);
      if (this._animated) {
        map.off({
          'zoomanim': this._animateZoom,
          'zoomend': this._endZoomAnim
        }, this);
      }
      if (!this.options.updateWhenIdle) {
        map.off('move', this._limitedUpdate, this);
      }
      this._container = null;
      this._map = null;
    },
    bringToFront: function() {
      var pane = this._map._panes.tilePane;
      if (this._container) {
        pane.appendChild(this._container);
        this._setAutoZIndex(pane, Math.max);
      }
      return this;
    },
    bringToBack: function() {
      var pane = this._map._panes.tilePane;
      if (this._container) {
        pane.insertBefore(this._container, pane.firstChild);
        this._setAutoZIndex(pane, Math.min);
      }
      return this;
    },
    getAttribution: function() {
      return this.options.attribution;
    },
    getContainer: function() {
      return this._container;
    },
    setOpacity: function(opacity) {
      this.options.opacity = opacity;
      if (this._map) {
        this._updateOpacity();
      }
      return this;
    },
    setZIndex: function(zIndex) {
      this.options.zIndex = zIndex;
      this._updateZIndex();
      return this;
    },
    setUrl: function(url, noRedraw) {
      this._url = url;
      if (!noRedraw) {
        this.redraw();
      }
      return this;
    },
    redraw: function() {
      if (this._map) {
        this._reset({hard: true});
        this._update();
      }
      return this;
    },
    _updateZIndex: function() {
      if (this._container && this.options.zIndex !== undefined) {
        this._container.style.zIndex = this.options.zIndex;
      }
    },
    _setAutoZIndex: function(pane, compare) {
      var layers = pane.children,
          edgeZIndex = -compare(Infinity, -Infinity),
          zIndex,
          i,
          len;
      for (i = 0, len = layers.length; i < len; i++) {
        if (layers[i] !== this._container) {
          zIndex = parseInt(layers[i].style.zIndex, 10);
          if (!isNaN(zIndex)) {
            edgeZIndex = compare(edgeZIndex, zIndex);
          }
        }
      }
      this.options.zIndex = this._container.style.zIndex = (isFinite(edgeZIndex) ? edgeZIndex : 0) + compare(1, -1);
    },
    _updateOpacity: function() {
      var i,
          tiles = this._tiles;
      if (L.Browser.ielt9) {
        for (i in tiles) {
          L.DomUtil.setOpacity(tiles[i], this.options.opacity);
        }
      } else {
        L.DomUtil.setOpacity(this._container, this.options.opacity);
      }
    },
    _initContainer: function() {
      var tilePane = this._map._panes.tilePane;
      if (!this._container) {
        this._container = L.DomUtil.create('div', 'leaflet-layer');
        this._updateZIndex();
        if (this._animated) {
          var className = 'leaflet-tile-container';
          this._bgBuffer = L.DomUtil.create('div', className, this._container);
          this._tileContainer = L.DomUtil.create('div', className, this._container);
        } else {
          this._tileContainer = this._container;
        }
        tilePane.appendChild(this._container);
        if (this.options.opacity < 1) {
          this._updateOpacity();
        }
      }
    },
    _reset: function(e) {
      for (var key in this._tiles) {
        this.fire('tileunload', {tile: this._tiles[key]});
      }
      this._tiles = {};
      this._tilesToLoad = 0;
      if (this.options.reuseTiles) {
        this._unusedTiles = [];
      }
      this._tileContainer.innerHTML = '';
      if (this._animated && e && e.hard) {
        this._clearBgBuffer();
      }
      this._initContainer();
    },
    _getTileSize: function() {
      var map = this._map,
          zoom = map.getZoom() + this.options.zoomOffset,
          zoomN = this.options.maxNativeZoom,
          tileSize = this.options.tileSize;
      if (zoomN && zoom > zoomN) {
        tileSize = Math.round(map.getZoomScale(zoom) / map.getZoomScale(zoomN) * tileSize);
      }
      return tileSize;
    },
    _update: function() {
      if (!this._map) {
        return;
      }
      var map = this._map,
          bounds = map.getPixelBounds(),
          zoom = map.getZoom(),
          tileSize = this._getTileSize();
      if (zoom > this.options.maxZoom || zoom < this.options.minZoom) {
        return;
      }
      var tileBounds = L.bounds(bounds.min.divideBy(tileSize)._floor(), bounds.max.divideBy(tileSize)._floor());
      this._addTilesFromCenterOut(tileBounds);
      if (this.options.unloadInvisibleTiles || this.options.reuseTiles) {
        this._removeOtherTiles(tileBounds);
      }
    },
    _addTilesFromCenterOut: function(bounds) {
      var queue = [],
          center = bounds.getCenter();
      var j,
          i,
          point;
      for (j = bounds.min.y; j <= bounds.max.y; j++) {
        for (i = bounds.min.x; i <= bounds.max.x; i++) {
          point = new L.Point(i, j);
          if (this._tileShouldBeLoaded(point)) {
            queue.push(point);
          }
        }
      }
      var tilesToLoad = queue.length;
      if (tilesToLoad === 0) {
        return;
      }
      queue.sort(function(a, b) {
        return a.distanceTo(center) - b.distanceTo(center);
      });
      var fragment = document.createDocumentFragment();
      if (!this._tilesToLoad) {
        this.fire('loading');
      }
      this._tilesToLoad += tilesToLoad;
      for (i = 0; i < tilesToLoad; i++) {
        this._addTile(queue[i], fragment);
      }
      this._tileContainer.appendChild(fragment);
    },
    _tileShouldBeLoaded: function(tilePoint) {
      if ((tilePoint.x + ':' + tilePoint.y) in this._tiles) {
        return false;
      }
      var options = this.options;
      if (!options.continuousWorld) {
        var limit = this._getWrapTileNum();
        if ((options.noWrap && (tilePoint.x < 0 || tilePoint.x >= limit.x)) || tilePoint.y < 0 || tilePoint.y >= limit.y) {
          return false;
        }
      }
      if (options.bounds) {
        var tileSize = this._getTileSize(),
            nwPoint = tilePoint.multiplyBy(tileSize),
            sePoint = nwPoint.add([tileSize, tileSize]),
            nw = this._map.unproject(nwPoint),
            se = this._map.unproject(sePoint);
        if (!options.continuousWorld && !options.noWrap) {
          nw = nw.wrap();
          se = se.wrap();
        }
        if (!options.bounds.intersects([nw, se])) {
          return false;
        }
      }
      return true;
    },
    _removeOtherTiles: function(bounds) {
      var kArr,
          x,
          y,
          key;
      for (key in this._tiles) {
        kArr = key.split(':');
        x = parseInt(kArr[0], 10);
        y = parseInt(kArr[1], 10);
        if (x < bounds.min.x || x > bounds.max.x || y < bounds.min.y || y > bounds.max.y) {
          this._removeTile(key);
        }
      }
    },
    _removeTile: function(key) {
      var tile = this._tiles[key];
      this.fire('tileunload', {
        tile: tile,
        url: tile.src
      });
      if (this.options.reuseTiles) {
        L.DomUtil.removeClass(tile, 'leaflet-tile-loaded');
        this._unusedTiles.push(tile);
      } else if (tile.parentNode === this._tileContainer) {
        this._tileContainer.removeChild(tile);
      }
      if (!L.Browser.android) {
        tile.onload = null;
        tile.src = L.Util.emptyImageUrl;
      }
      delete this._tiles[key];
    },
    _addTile: function(tilePoint, container) {
      var tilePos = this._getTilePos(tilePoint);
      var tile = this._getTile();
      L.DomUtil.setPosition(tile, tilePos, L.Browser.chrome);
      this._tiles[tilePoint.x + ':' + tilePoint.y] = tile;
      this._loadTile(tile, tilePoint);
      if (tile.parentNode !== this._tileContainer) {
        container.appendChild(tile);
      }
    },
    _getZoomForUrl: function() {
      var options = this.options,
          zoom = this._map.getZoom();
      if (options.zoomReverse) {
        zoom = options.maxZoom - zoom;
      }
      zoom += options.zoomOffset;
      return options.maxNativeZoom ? Math.min(zoom, options.maxNativeZoom) : zoom;
    },
    _getTilePos: function(tilePoint) {
      var origin = this._map.getPixelOrigin(),
          tileSize = this._getTileSize();
      return tilePoint.multiplyBy(tileSize).subtract(origin);
    },
    getTileUrl: function(tilePoint) {
      return L.Util.template(this._url, L.extend({
        s: this._getSubdomain(tilePoint),
        z: tilePoint.z,
        x: tilePoint.x,
        y: tilePoint.y
      }, this.options));
    },
    _getWrapTileNum: function() {
      var crs = this._map.options.crs,
          size = crs.getSize(this._map.getZoom());
      return size.divideBy(this._getTileSize())._floor();
    },
    _adjustTilePoint: function(tilePoint) {
      var limit = this._getWrapTileNum();
      if (!this.options.continuousWorld && !this.options.noWrap) {
        tilePoint.x = ((tilePoint.x % limit.x) + limit.x) % limit.x;
      }
      if (this.options.tms) {
        tilePoint.y = limit.y - tilePoint.y - 1;
      }
      tilePoint.z = this._getZoomForUrl();
    },
    _getSubdomain: function(tilePoint) {
      var index = Math.abs(tilePoint.x + tilePoint.y) % this.options.subdomains.length;
      return this.options.subdomains[index];
    },
    _getTile: function() {
      if (this.options.reuseTiles && this._unusedTiles.length > 0) {
        var tile = this._unusedTiles.pop();
        this._resetTile(tile);
        return tile;
      }
      return this._createTile();
    },
    _resetTile: function() {},
    _createTile: function() {
      var tile = L.DomUtil.create('img', 'leaflet-tile');
      tile.style.width = tile.style.height = this._getTileSize() + 'px';
      tile.galleryimg = 'no';
      tile.onselectstart = tile.onmousemove = L.Util.falseFn;
      if (L.Browser.ielt9 && this.options.opacity !== undefined) {
        L.DomUtil.setOpacity(tile, this.options.opacity);
      }
      if (L.Browser.mobileWebkit3d) {
        tile.style.WebkitBackfaceVisibility = 'hidden';
      }
      return tile;
    },
    _loadTile: function(tile, tilePoint) {
      tile._layer = this;
      tile.onload = this._tileOnLoad;
      tile.onerror = this._tileOnError;
      this._adjustTilePoint(tilePoint);
      tile.src = this.getTileUrl(tilePoint);
      this.fire('tileloadstart', {
        tile: tile,
        url: tile.src
      });
    },
    _tileLoaded: function() {
      this._tilesToLoad--;
      if (this._animated) {
        L.DomUtil.addClass(this._tileContainer, 'leaflet-zoom-animated');
      }
      if (!this._tilesToLoad) {
        this.fire('load');
        if (this._animated) {
          clearTimeout(this._clearBgBufferTimer);
          this._clearBgBufferTimer = setTimeout(L.bind(this._clearBgBuffer, this), 500);
        }
      }
    },
    _tileOnLoad: function() {
      var layer = this._layer;
      if (this.src !== L.Util.emptyImageUrl) {
        L.DomUtil.addClass(this, 'leaflet-tile-loaded');
        layer.fire('tileload', {
          tile: this,
          url: this.src
        });
      }
      layer._tileLoaded();
    },
    _tileOnError: function() {
      var layer = this._layer;
      layer.fire('tileerror', {
        tile: this,
        url: this.src
      });
      var newUrl = layer.options.errorTileUrl;
      if (newUrl) {
        this.src = newUrl;
      }
      layer._tileLoaded();
    }
  });
  L.tileLayer = function(url, options) {
    return new L.TileLayer(url, options);
  };
  L.TileLayer.WMS = L.TileLayer.extend({
    defaultWmsParams: {
      service: 'WMS',
      request: 'GetMap',
      version: '1.1.1',
      layers: '',
      styles: '',
      format: 'image/jpeg',
      transparent: false
    },
    initialize: function(url, options) {
      this._url = url;
      var wmsParams = L.extend({}, this.defaultWmsParams),
          tileSize = options.tileSize || this.options.tileSize;
      if (options.detectRetina && L.Browser.retina) {
        wmsParams.width = wmsParams.height = tileSize * 2;
      } else {
        wmsParams.width = wmsParams.height = tileSize;
      }
      for (var i in options) {
        if (!this.options.hasOwnProperty(i) && i !== 'crs') {
          wmsParams[i] = options[i];
        }
      }
      this.wmsParams = wmsParams;
      L.setOptions(this, options);
    },
    onAdd: function(map) {
      this._crs = this.options.crs || map.options.crs;
      this._wmsVersion = parseFloat(this.wmsParams.version);
      var projectionKey = this._wmsVersion >= 1.3 ? 'crs' : 'srs';
      this.wmsParams[projectionKey] = this._crs.code;
      L.TileLayer.prototype.onAdd.call(this, map);
    },
    getTileUrl: function(tilePoint) {
      var map = this._map,
          tileSize = this.options.tileSize,
          nwPoint = tilePoint.multiplyBy(tileSize),
          sePoint = nwPoint.add([tileSize, tileSize]),
          nw = this._crs.project(map.unproject(nwPoint, tilePoint.z)),
          se = this._crs.project(map.unproject(sePoint, tilePoint.z)),
          bbox = this._wmsVersion >= 1.3 && this._crs === L.CRS.EPSG4326 ? [se.y, nw.x, nw.y, se.x].join(',') : [nw.x, se.y, se.x, nw.y].join(','),
          url = L.Util.template(this._url, {s: this._getSubdomain(tilePoint)});
      return url + L.Util.getParamString(this.wmsParams, url, true) + '&BBOX=' + bbox;
    },
    setParams: function(params, noRedraw) {
      L.extend(this.wmsParams, params);
      if (!noRedraw) {
        this.redraw();
      }
      return this;
    }
  });
  L.tileLayer.wms = function(url, options) {
    return new L.TileLayer.WMS(url, options);
  };
  L.TileLayer.Canvas = L.TileLayer.extend({
    options: {async: false},
    initialize: function(options) {
      L.setOptions(this, options);
    },
    redraw: function() {
      if (this._map) {
        this._reset({hard: true});
        this._update();
      }
      for (var i in this._tiles) {
        this._redrawTile(this._tiles[i]);
      }
      return this;
    },
    _redrawTile: function(tile) {
      this.drawTile(tile, tile._tilePoint, this._map._zoom);
    },
    _createTile: function() {
      var tile = L.DomUtil.create('canvas', 'leaflet-tile');
      tile.width = tile.height = this.options.tileSize;
      tile.onselectstart = tile.onmousemove = L.Util.falseFn;
      return tile;
    },
    _loadTile: function(tile, tilePoint) {
      tile._layer = this;
      tile._tilePoint = tilePoint;
      this._redrawTile(tile);
      if (!this.options.async) {
        this.tileDrawn(tile);
      }
    },
    drawTile: function() {},
    tileDrawn: function(tile) {
      this._tileOnLoad.call(tile);
    }
  });
  L.tileLayer.canvas = function(options) {
    return new L.TileLayer.Canvas(options);
  };
  L.ImageOverlay = L.Class.extend({
    includes: L.Mixin.Events,
    options: {opacity: 1},
    initialize: function(url, bounds, options) {
      this._url = url;
      this._bounds = L.latLngBounds(bounds);
      L.setOptions(this, options);
    },
    onAdd: function(map) {
      this._map = map;
      if (!this._image) {
        this._initImage();
      }
      map._panes.overlayPane.appendChild(this._image);
      map.on('viewreset', this._reset, this);
      if (map.options.zoomAnimation && L.Browser.any3d) {
        map.on('zoomanim', this._animateZoom, this);
      }
      this._reset();
    },
    onRemove: function(map) {
      map.getPanes().overlayPane.removeChild(this._image);
      map.off('viewreset', this._reset, this);
      if (map.options.zoomAnimation) {
        map.off('zoomanim', this._animateZoom, this);
      }
    },
    addTo: function(map) {
      map.addLayer(this);
      return this;
    },
    setOpacity: function(opacity) {
      this.options.opacity = opacity;
      this._updateOpacity();
      return this;
    },
    bringToFront: function() {
      if (this._image) {
        this._map._panes.overlayPane.appendChild(this._image);
      }
      return this;
    },
    bringToBack: function() {
      var pane = this._map._panes.overlayPane;
      if (this._image) {
        pane.insertBefore(this._image, pane.firstChild);
      }
      return this;
    },
    setUrl: function(url) {
      this._url = url;
      this._image.src = this._url;
    },
    getAttribution: function() {
      return this.options.attribution;
    },
    _initImage: function() {
      this._image = L.DomUtil.create('img', 'leaflet-image-layer');
      if (this._map.options.zoomAnimation && L.Browser.any3d) {
        L.DomUtil.addClass(this._image, 'leaflet-zoom-animated');
      } else {
        L.DomUtil.addClass(this._image, 'leaflet-zoom-hide');
      }
      this._updateOpacity();
      L.extend(this._image, {
        galleryimg: 'no',
        onselectstart: L.Util.falseFn,
        onmousemove: L.Util.falseFn,
        onload: L.bind(this._onImageLoad, this),
        src: this._url
      });
    },
    _animateZoom: function(e) {
      var map = this._map,
          image = this._image,
          scale = map.getZoomScale(e.zoom),
          nw = this._bounds.getNorthWest(),
          se = this._bounds.getSouthEast(),
          topLeft = map._latLngToNewLayerPoint(nw, e.zoom, e.center),
          size = map._latLngToNewLayerPoint(se, e.zoom, e.center)._subtract(topLeft),
          origin = topLeft._add(size._multiplyBy((1 / 2) * (1 - 1 / scale)));
      image.style[L.DomUtil.TRANSFORM] = L.DomUtil.getTranslateString(origin) + ' scale(' + scale + ') ';
    },
    _reset: function() {
      var image = this._image,
          topLeft = this._map.latLngToLayerPoint(this._bounds.getNorthWest()),
          size = this._map.latLngToLayerPoint(this._bounds.getSouthEast())._subtract(topLeft);
      L.DomUtil.setPosition(image, topLeft);
      image.style.width = size.x + 'px';
      image.style.height = size.y + 'px';
    },
    _onImageLoad: function() {
      this.fire('load');
    },
    _updateOpacity: function() {
      L.DomUtil.setOpacity(this._image, this.options.opacity);
    }
  });
  L.imageOverlay = function(url, bounds, options) {
    return new L.ImageOverlay(url, bounds, options);
  };
  L.Icon = L.Class.extend({
    options: {className: ''},
    initialize: function(options) {
      L.setOptions(this, options);
    },
    createIcon: function(oldIcon) {
      return this._createIcon('icon', oldIcon);
    },
    createShadow: function(oldIcon) {
      return this._createIcon('shadow', oldIcon);
    },
    _createIcon: function(name, oldIcon) {
      var src = this._getIconUrl(name);
      if (!src) {
        if (name === 'icon') {
          throw new Error('iconUrl not set in Icon options (see the docs).');
        }
        return null;
      }
      var img;
      if (!oldIcon || oldIcon.tagName !== 'IMG') {
        img = this._createImg(src);
      } else {
        img = this._createImg(src, oldIcon);
      }
      this._setIconStyles(img, name);
      return img;
    },
    _setIconStyles: function(img, name) {
      var options = this.options,
          size = L.point(options[name + 'Size']),
          anchor;
      if (name === 'shadow') {
        anchor = L.point(options.shadowAnchor || options.iconAnchor);
      } else {
        anchor = L.point(options.iconAnchor);
      }
      if (!anchor && size) {
        anchor = size.divideBy(2, true);
      }
      img.className = 'leaflet-marker-' + name + ' ' + options.className;
      if (anchor) {
        img.style.marginLeft = (-anchor.x) + 'px';
        img.style.marginTop = (-anchor.y) + 'px';
      }
      if (size) {
        img.style.width = size.x + 'px';
        img.style.height = size.y + 'px';
      }
    },
    _createImg: function(src, el) {
      el = el || document.createElement('img');
      el.src = src;
      return el;
    },
    _getIconUrl: function(name) {
      if (L.Browser.retina && this.options[name + 'RetinaUrl']) {
        return this.options[name + 'RetinaUrl'];
      }
      return this.options[name + 'Url'];
    }
  });
  L.icon = function(options) {
    return new L.Icon(options);
  };
  L.Icon.Default = L.Icon.extend({
    options: {
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41]
    },
    _getIconUrl: function(name) {
      var key = name + 'Url';
      if (this.options[key]) {
        return this.options[key];
      }
      if (L.Browser.retina && name === 'icon') {
        name += '-2x';
      }
      var path = L.Icon.Default.imagePath;
      if (!path) {
        throw new Error('Couldn\'t autodetect L.Icon.Default.imagePath, set it manually.');
      }
      return path + '/marker-' + name + '.png';
    }
  });
  L.Icon.Default.imagePath = (function() {
    var scripts = document.getElementsByTagName('script'),
        leafletRe = /[\/^]leaflet[\-\._]?([\w\-\._]*)\.js\??/;
    var i,
        len,
        src,
        matches,
        path;
    for (i = 0, len = scripts.length; i < len; i++) {
      src = scripts[i].src;
      matches = src.match(leafletRe);
      if (matches) {
        path = src.split(leafletRe)[0];
        return (path ? path + '/' : '') + 'images';
      }
    }
  }());
  L.Marker = L.Class.extend({
    includes: L.Mixin.Events,
    options: {
      icon: new L.Icon.Default(),
      title: '',
      alt: '',
      clickable: true,
      draggable: false,
      keyboard: true,
      zIndexOffset: 0,
      opacity: 1,
      riseOnHover: false,
      riseOffset: 250
    },
    initialize: function(latlng, options) {
      L.setOptions(this, options);
      this._latlng = L.latLng(latlng);
    },
    onAdd: function(map) {
      this._map = map;
      map.on('viewreset', this.update, this);
      this._initIcon();
      this.update();
      this.fire('add');
      if (map.options.zoomAnimation && map.options.markerZoomAnimation) {
        map.on('zoomanim', this._animateZoom, this);
      }
    },
    addTo: function(map) {
      map.addLayer(this);
      return this;
    },
    onRemove: function(map) {
      if (this.dragging) {
        this.dragging.disable();
      }
      this._removeIcon();
      this._removeShadow();
      this.fire('remove');
      map.off({
        'viewreset': this.update,
        'zoomanim': this._animateZoom
      }, this);
      this._map = null;
    },
    getLatLng: function() {
      return this._latlng;
    },
    setLatLng: function(latlng) {
      this._latlng = L.latLng(latlng);
      this.update();
      return this.fire('move', {latlng: this._latlng});
    },
    setZIndexOffset: function(offset) {
      this.options.zIndexOffset = offset;
      this.update();
      return this;
    },
    setIcon: function(icon) {
      this.options.icon = icon;
      if (this._map) {
        this._initIcon();
        this.update();
      }
      if (this._popup) {
        this.bindPopup(this._popup);
      }
      return this;
    },
    update: function() {
      if (this._icon) {
        this._setPos(this._map.latLngToLayerPoint(this._latlng).round());
      }
      return this;
    },
    _initIcon: function() {
      var options = this.options,
          map = this._map,
          animation = (map.options.zoomAnimation && map.options.markerZoomAnimation),
          classToAdd = animation ? 'leaflet-zoom-animated' : 'leaflet-zoom-hide';
      var icon = options.icon.createIcon(this._icon),
          addIcon = false;
      if (icon !== this._icon) {
        if (this._icon) {
          this._removeIcon();
        }
        addIcon = true;
        if (options.title) {
          icon.title = options.title;
        }
        if (options.alt) {
          icon.alt = options.alt;
        }
      }
      L.DomUtil.addClass(icon, classToAdd);
      if (options.keyboard) {
        icon.tabIndex = '0';
      }
      this._icon = icon;
      this._initInteraction();
      if (options.riseOnHover) {
        L.DomEvent.on(icon, 'mouseover', this._bringToFront, this).on(icon, 'mouseout', this._resetZIndex, this);
      }
      var newShadow = options.icon.createShadow(this._shadow),
          addShadow = false;
      if (newShadow !== this._shadow) {
        this._removeShadow();
        addShadow = true;
      }
      if (newShadow) {
        L.DomUtil.addClass(newShadow, classToAdd);
      }
      this._shadow = newShadow;
      if (options.opacity < 1) {
        this._updateOpacity();
      }
      var panes = this._map._panes;
      if (addIcon) {
        panes.markerPane.appendChild(this._icon);
      }
      if (newShadow && addShadow) {
        panes.shadowPane.appendChild(this._shadow);
      }
    },
    _removeIcon: function() {
      if (this.options.riseOnHover) {
        L.DomEvent.off(this._icon, 'mouseover', this._bringToFront).off(this._icon, 'mouseout', this._resetZIndex);
      }
      this._map._panes.markerPane.removeChild(this._icon);
      this._icon = null;
    },
    _removeShadow: function() {
      if (this._shadow) {
        this._map._panes.shadowPane.removeChild(this._shadow);
      }
      this._shadow = null;
    },
    _setPos: function(pos) {
      L.DomUtil.setPosition(this._icon, pos);
      if (this._shadow) {
        L.DomUtil.setPosition(this._shadow, pos);
      }
      this._zIndex = pos.y + this.options.zIndexOffset;
      this._resetZIndex();
    },
    _updateZIndex: function(offset) {
      this._icon.style.zIndex = this._zIndex + offset;
    },
    _animateZoom: function(opt) {
      var pos = this._map._latLngToNewLayerPoint(this._latlng, opt.zoom, opt.center).round();
      this._setPos(pos);
    },
    _initInteraction: function() {
      if (!this.options.clickable) {
        return;
      }
      var icon = this._icon,
          events = ['dblclick', 'mousedown', 'mouseover', 'mouseout', 'contextmenu'];
      L.DomUtil.addClass(icon, 'leaflet-clickable');
      L.DomEvent.on(icon, 'click', this._onMouseClick, this);
      L.DomEvent.on(icon, 'keypress', this._onKeyPress, this);
      for (var i = 0; i < events.length; i++) {
        L.DomEvent.on(icon, events[i], this._fireMouseEvent, this);
      }
      if (L.Handler.MarkerDrag) {
        this.dragging = new L.Handler.MarkerDrag(this);
        if (this.options.draggable) {
          this.dragging.enable();
        }
      }
    },
    _onMouseClick: function(e) {
      var wasDragged = this.dragging && this.dragging.moved();
      if (this.hasEventListeners(e.type) || wasDragged) {
        L.DomEvent.stopPropagation(e);
      }
      if (wasDragged) {
        return;
      }
      if ((!this.dragging || !this.dragging._enabled) && this._map.dragging && this._map.dragging.moved()) {
        return;
      }
      this.fire(e.type, {
        originalEvent: e,
        latlng: this._latlng
      });
    },
    _onKeyPress: function(e) {
      if (e.keyCode === 13) {
        this.fire('click', {
          originalEvent: e,
          latlng: this._latlng
        });
      }
    },
    _fireMouseEvent: function(e) {
      this.fire(e.type, {
        originalEvent: e,
        latlng: this._latlng
      });
      if (e.type === 'contextmenu' && this.hasEventListeners(e.type)) {
        L.DomEvent.preventDefault(e);
      }
      if (e.type !== 'mousedown') {
        L.DomEvent.stopPropagation(e);
      } else {
        L.DomEvent.preventDefault(e);
      }
    },
    setOpacity: function(opacity) {
      this.options.opacity = opacity;
      if (this._map) {
        this._updateOpacity();
      }
      return this;
    },
    _updateOpacity: function() {
      L.DomUtil.setOpacity(this._icon, this.options.opacity);
      if (this._shadow) {
        L.DomUtil.setOpacity(this._shadow, this.options.opacity);
      }
    },
    _bringToFront: function() {
      this._updateZIndex(this.options.riseOffset);
    },
    _resetZIndex: function() {
      this._updateZIndex(0);
    }
  });
  L.marker = function(latlng, options) {
    return new L.Marker(latlng, options);
  };
  L.DivIcon = L.Icon.extend({
    options: {
      iconSize: [12, 12],
      className: 'leaflet-div-icon',
      html: false
    },
    createIcon: function(oldIcon) {
      var div = (oldIcon && oldIcon.tagName === 'DIV') ? oldIcon : document.createElement('div'),
          options = this.options;
      if (options.html !== false) {
        div.innerHTML = options.html;
      } else {
        div.innerHTML = '';
      }
      if (options.bgPos) {
        div.style.backgroundPosition = (-options.bgPos.x) + 'px ' + (-options.bgPos.y) + 'px';
      }
      this._setIconStyles(div, 'icon');
      return div;
    },
    createShadow: function() {
      return null;
    }
  });
  L.divIcon = function(options) {
    return new L.DivIcon(options);
  };
  L.Map.mergeOptions({closePopupOnClick: true});
  L.Popup = L.Class.extend({
    includes: L.Mixin.Events,
    options: {
      minWidth: 50,
      maxWidth: 300,
      autoPan: true,
      closeButton: true,
      offset: [0, 7],
      autoPanPadding: [5, 5],
      keepInView: false,
      className: '',
      zoomAnimation: true
    },
    initialize: function(options, source) {
      L.setOptions(this, options);
      this._source = source;
      this._animated = L.Browser.any3d && this.options.zoomAnimation;
      this._isOpen = false;
    },
    onAdd: function(map) {
      this._map = map;
      if (!this._container) {
        this._initLayout();
      }
      var animFade = map.options.fadeAnimation;
      if (animFade) {
        L.DomUtil.setOpacity(this._container, 0);
      }
      map._panes.popupPane.appendChild(this._container);
      map.on(this._getEvents(), this);
      this.update();
      if (animFade) {
        L.DomUtil.setOpacity(this._container, 1);
      }
      this.fire('open');
      map.fire('popupopen', {popup: this});
      if (this._source) {
        this._source.fire('popupopen', {popup: this});
      }
    },
    addTo: function(map) {
      map.addLayer(this);
      return this;
    },
    openOn: function(map) {
      map.openPopup(this);
      return this;
    },
    onRemove: function(map) {
      map._panes.popupPane.removeChild(this._container);
      L.Util.falseFn(this._container.offsetWidth);
      map.off(this._getEvents(), this);
      if (map.options.fadeAnimation) {
        L.DomUtil.setOpacity(this._container, 0);
      }
      this._map = null;
      this.fire('close');
      map.fire('popupclose', {popup: this});
      if (this._source) {
        this._source.fire('popupclose', {popup: this});
      }
    },
    getLatLng: function() {
      return this._latlng;
    },
    setLatLng: function(latlng) {
      this._latlng = L.latLng(latlng);
      if (this._map) {
        this._updatePosition();
        this._adjustPan();
      }
      return this;
    },
    getContent: function() {
      return this._content;
    },
    setContent: function(content) {
      this._content = content;
      this.update();
      return this;
    },
    update: function() {
      if (!this._map) {
        return;
      }
      this._container.style.visibility = 'hidden';
      this._updateContent();
      this._updateLayout();
      this._updatePosition();
      this._container.style.visibility = '';
      this._adjustPan();
    },
    _getEvents: function() {
      var events = {viewreset: this._updatePosition};
      if (this._animated) {
        events.zoomanim = this._zoomAnimation;
      }
      if ('closeOnClick' in this.options ? this.options.closeOnClick : this._map.options.closePopupOnClick) {
        events.preclick = this._close;
      }
      if (this.options.keepInView) {
        events.moveend = this._adjustPan;
      }
      return events;
    },
    _close: function() {
      if (this._map) {
        this._map.closePopup(this);
      }
    },
    _initLayout: function() {
      var prefix = 'leaflet-popup',
          containerClass = prefix + ' ' + this.options.className + ' leaflet-zoom-' + (this._animated ? 'animated' : 'hide'),
          container = this._container = L.DomUtil.create('div', containerClass),
          closeButton;
      if (this.options.closeButton) {
        closeButton = this._closeButton = L.DomUtil.create('a', prefix + '-close-button', container);
        closeButton.href = '#close';
        closeButton.innerHTML = '&#215;';
        L.DomEvent.disableClickPropagation(closeButton);
        L.DomEvent.on(closeButton, 'click', this._onCloseButtonClick, this);
      }
      var wrapper = this._wrapper = L.DomUtil.create('div', prefix + '-content-wrapper', container);
      L.DomEvent.disableClickPropagation(wrapper);
      this._contentNode = L.DomUtil.create('div', prefix + '-content', wrapper);
      L.DomEvent.disableScrollPropagation(this._contentNode);
      L.DomEvent.on(wrapper, 'contextmenu', L.DomEvent.stopPropagation);
      this._tipContainer = L.DomUtil.create('div', prefix + '-tip-container', container);
      this._tip = L.DomUtil.create('div', prefix + '-tip', this._tipContainer);
    },
    _updateContent: function() {
      if (!this._content) {
        return;
      }
      if (typeof this._content === 'string') {
        this._contentNode.innerHTML = this._content;
      } else {
        while (this._contentNode.hasChildNodes()) {
          this._contentNode.removeChild(this._contentNode.firstChild);
        }
        this._contentNode.appendChild(this._content);
      }
      this.fire('contentupdate');
    },
    _updateLayout: function() {
      var container = this._contentNode,
          style = container.style;
      style.width = '';
      style.whiteSpace = 'nowrap';
      var width = container.offsetWidth;
      width = Math.min(width, this.options.maxWidth);
      width = Math.max(width, this.options.minWidth);
      style.width = (width + 1) + 'px';
      style.whiteSpace = '';
      style.height = '';
      var height = container.offsetHeight,
          maxHeight = this.options.maxHeight,
          scrolledClass = 'leaflet-popup-scrolled';
      if (maxHeight && height > maxHeight) {
        style.height = maxHeight + 'px';
        L.DomUtil.addClass(container, scrolledClass);
      } else {
        L.DomUtil.removeClass(container, scrolledClass);
      }
      this._containerWidth = this._container.offsetWidth;
    },
    _updatePosition: function() {
      if (!this._map) {
        return;
      }
      var pos = this._map.latLngToLayerPoint(this._latlng),
          animated = this._animated,
          offset = L.point(this.options.offset);
      if (animated) {
        L.DomUtil.setPosition(this._container, pos);
      }
      this._containerBottom = -offset.y - (animated ? 0 : pos.y);
      this._containerLeft = -Math.round(this._containerWidth / 2) + offset.x + (animated ? 0 : pos.x);
      this._container.style.bottom = this._containerBottom + 'px';
      this._container.style.left = this._containerLeft + 'px';
    },
    _zoomAnimation: function(opt) {
      var pos = this._map._latLngToNewLayerPoint(this._latlng, opt.zoom, opt.center);
      L.DomUtil.setPosition(this._container, pos);
    },
    _adjustPan: function() {
      if (!this.options.autoPan) {
        return;
      }
      var map = this._map,
          containerHeight = this._container.offsetHeight,
          containerWidth = this._containerWidth,
          layerPos = new L.Point(this._containerLeft, -containerHeight - this._containerBottom);
      if (this._animated) {
        layerPos._add(L.DomUtil.getPosition(this._container));
      }
      var containerPos = map.layerPointToContainerPoint(layerPos),
          padding = L.point(this.options.autoPanPadding),
          paddingTL = L.point(this.options.autoPanPaddingTopLeft || padding),
          paddingBR = L.point(this.options.autoPanPaddingBottomRight || padding),
          size = map.getSize(),
          dx = 0,
          dy = 0;
      if (containerPos.x + containerWidth + paddingBR.x > size.x) {
        dx = containerPos.x + containerWidth - size.x + paddingBR.x;
      }
      if (containerPos.x - dx - paddingTL.x < 0) {
        dx = containerPos.x - paddingTL.x;
      }
      if (containerPos.y + containerHeight + paddingBR.y > size.y) {
        dy = containerPos.y + containerHeight - size.y + paddingBR.y;
      }
      if (containerPos.y - dy - paddingTL.y < 0) {
        dy = containerPos.y - paddingTL.y;
      }
      if (dx || dy) {
        map.fire('autopanstart').panBy([dx, dy]);
      }
    },
    _onCloseButtonClick: function(e) {
      this._close();
      L.DomEvent.stop(e);
    }
  });
  L.popup = function(options, source) {
    return new L.Popup(options, source);
  };
  L.Map.include({
    openPopup: function(popup, latlng, options) {
      this.closePopup();
      if (!(popup instanceof L.Popup)) {
        var content = popup;
        popup = new L.Popup(options).setLatLng(latlng).setContent(content);
      }
      popup._isOpen = true;
      this._popup = popup;
      return this.addLayer(popup);
    },
    closePopup: function(popup) {
      if (!popup || popup === this._popup) {
        popup = this._popup;
        this._popup = null;
      }
      if (popup) {
        this.removeLayer(popup);
        popup._isOpen = false;
      }
      return this;
    }
  });
  L.Marker.include({
    openPopup: function() {
      if (this._popup && this._map && !this._map.hasLayer(this._popup)) {
        this._popup.setLatLng(this._latlng);
        this._map.openPopup(this._popup);
      }
      return this;
    },
    closePopup: function() {
      if (this._popup) {
        this._popup._close();
      }
      return this;
    },
    togglePopup: function() {
      if (this._popup) {
        if (this._popup._isOpen) {
          this.closePopup();
        } else {
          this.openPopup();
        }
      }
      return this;
    },
    bindPopup: function(content, options) {
      var anchor = L.point(this.options.icon.options.popupAnchor || [0, 0]);
      anchor = anchor.add(L.Popup.prototype.options.offset);
      if (options && options.offset) {
        anchor = anchor.add(options.offset);
      }
      options = L.extend({offset: anchor}, options);
      if (!this._popupHandlersAdded) {
        this.on('click', this.togglePopup, this).on('remove', this.closePopup, this).on('move', this._movePopup, this);
        this._popupHandlersAdded = true;
      }
      if (content instanceof L.Popup) {
        L.setOptions(content, options);
        this._popup = content;
        content._source = this;
      } else {
        this._popup = new L.Popup(options, this).setContent(content);
      }
      return this;
    },
    setPopupContent: function(content) {
      if (this._popup) {
        this._popup.setContent(content);
      }
      return this;
    },
    unbindPopup: function() {
      if (this._popup) {
        this._popup = null;
        this.off('click', this.togglePopup, this).off('remove', this.closePopup, this).off('move', this._movePopup, this);
        this._popupHandlersAdded = false;
      }
      return this;
    },
    getPopup: function() {
      return this._popup;
    },
    _movePopup: function(e) {
      this._popup.setLatLng(e.latlng);
    }
  });
  L.LayerGroup = L.Class.extend({
    initialize: function(layers) {
      this._layers = {};
      var i,
          len;
      if (layers) {
        for (i = 0, len = layers.length; i < len; i++) {
          this.addLayer(layers[i]);
        }
      }
    },
    addLayer: function(layer) {
      var id = this.getLayerId(layer);
      this._layers[id] = layer;
      if (this._map) {
        this._map.addLayer(layer);
      }
      return this;
    },
    removeLayer: function(layer) {
      var id = layer in this._layers ? layer : this.getLayerId(layer);
      if (this._map && this._layers[id]) {
        this._map.removeLayer(this._layers[id]);
      }
      delete this._layers[id];
      return this;
    },
    hasLayer: function(layer) {
      if (!layer) {
        return false;
      }
      return (layer in this._layers || this.getLayerId(layer) in this._layers);
    },
    clearLayers: function() {
      this.eachLayer(this.removeLayer, this);
      return this;
    },
    invoke: function(methodName) {
      var args = Array.prototype.slice.call(arguments, 1),
          i,
          layer;
      for (i in this._layers) {
        layer = this._layers[i];
        if (layer[methodName]) {
          layer[methodName].apply(layer, args);
        }
      }
      return this;
    },
    onAdd: function(map) {
      this._map = map;
      this.eachLayer(map.addLayer, map);
    },
    onRemove: function(map) {
      this.eachLayer(map.removeLayer, map);
      this._map = null;
    },
    addTo: function(map) {
      map.addLayer(this);
      return this;
    },
    eachLayer: function(method, context) {
      for (var i in this._layers) {
        method.call(context, this._layers[i]);
      }
      return this;
    },
    getLayer: function(id) {
      return this._layers[id];
    },
    getLayers: function() {
      var layers = [];
      for (var i in this._layers) {
        layers.push(this._layers[i]);
      }
      return layers;
    },
    setZIndex: function(zIndex) {
      return this.invoke('setZIndex', zIndex);
    },
    getLayerId: function(layer) {
      return L.stamp(layer);
    }
  });
  L.layerGroup = function(layers) {
    return new L.LayerGroup(layers);
  };
  L.FeatureGroup = L.LayerGroup.extend({
    includes: L.Mixin.Events,
    statics: {EVENTS: 'click dblclick mouseover mouseout mousemove contextmenu popupopen popupclose'},
    addLayer: function(layer) {
      if (this.hasLayer(layer)) {
        return this;
      }
      if ('on' in layer) {
        layer.on(L.FeatureGroup.EVENTS, this._propagateEvent, this);
      }
      L.LayerGroup.prototype.addLayer.call(this, layer);
      if (this._popupContent && layer.bindPopup) {
        layer.bindPopup(this._popupContent, this._popupOptions);
      }
      return this.fire('layeradd', {layer: layer});
    },
    removeLayer: function(layer) {
      if (!this.hasLayer(layer)) {
        return this;
      }
      if (layer in this._layers) {
        layer = this._layers[layer];
      }
      if ('off' in layer) {
        layer.off(L.FeatureGroup.EVENTS, this._propagateEvent, this);
      }
      L.LayerGroup.prototype.removeLayer.call(this, layer);
      if (this._popupContent) {
        this.invoke('unbindPopup');
      }
      return this.fire('layerremove', {layer: layer});
    },
    bindPopup: function(content, options) {
      this._popupContent = content;
      this._popupOptions = options;
      return this.invoke('bindPopup', content, options);
    },
    openPopup: function(latlng) {
      for (var id in this._layers) {
        this._layers[id].openPopup(latlng);
        break;
      }
      return this;
    },
    setStyle: function(style) {
      return this.invoke('setStyle', style);
    },
    bringToFront: function() {
      return this.invoke('bringToFront');
    },
    bringToBack: function() {
      return this.invoke('bringToBack');
    },
    getBounds: function() {
      var bounds = new L.LatLngBounds();
      this.eachLayer(function(layer) {
        bounds.extend(layer instanceof L.Marker ? layer.getLatLng() : layer.getBounds());
      });
      return bounds;
    },
    _propagateEvent: function(e) {
      e = L.extend({
        layer: e.target,
        target: this
      }, e);
      this.fire(e.type, e);
    }
  });
  L.featureGroup = function(layers) {
    return new L.FeatureGroup(layers);
  };
  L.Path = L.Class.extend({
    includes: [L.Mixin.Events],
    statics: {CLIP_PADDING: (function() {
        var max = L.Browser.mobile ? 1280 : 2000,
            target = (max / Math.max(window.outerWidth, window.outerHeight) - 1) / 2;
        return Math.max(0, Math.min(0.5, target));
      })()},
    options: {
      stroke: true,
      color: '#0033ff',
      dashArray: null,
      lineCap: null,
      lineJoin: null,
      weight: 5,
      opacity: 0.5,
      fill: false,
      fillColor: null,
      fillOpacity: 0.2,
      clickable: true
    },
    initialize: function(options) {
      L.setOptions(this, options);
    },
    onAdd: function(map) {
      this._map = map;
      if (!this._container) {
        this._initElements();
        this._initEvents();
      }
      this.projectLatlngs();
      this._updatePath();
      if (this._container) {
        this._map._pathRoot.appendChild(this._container);
      }
      this.fire('add');
      map.on({
        'viewreset': this.projectLatlngs,
        'moveend': this._updatePath
      }, this);
    },
    addTo: function(map) {
      map.addLayer(this);
      return this;
    },
    onRemove: function(map) {
      map._pathRoot.removeChild(this._container);
      this.fire('remove');
      this._map = null;
      if (L.Browser.vml) {
        this._container = null;
        this._stroke = null;
        this._fill = null;
      }
      map.off({
        'viewreset': this.projectLatlngs,
        'moveend': this._updatePath
      }, this);
    },
    projectLatlngs: function() {},
    setStyle: function(style) {
      L.setOptions(this, style);
      if (this._container) {
        this._updateStyle();
      }
      return this;
    },
    redraw: function() {
      if (this._map) {
        this.projectLatlngs();
        this._updatePath();
      }
      return this;
    }
  });
  L.Map.include({_updatePathViewport: function() {
      var p = L.Path.CLIP_PADDING,
          size = this.getSize(),
          panePos = L.DomUtil.getPosition(this._mapPane),
          min = panePos.multiplyBy(-1)._subtract(size.multiplyBy(p)._round()),
          max = min.add(size.multiplyBy(1 + p * 2)._round());
      this._pathViewport = new L.Bounds(min, max);
    }});
  L.Path.SVG_NS = 'http://www.w3.org/2000/svg';
  L.Browser.svg = !!(document.createElementNS && document.createElementNS(L.Path.SVG_NS, 'svg').createSVGRect);
  L.Path = L.Path.extend({
    statics: {SVG: L.Browser.svg},
    bringToFront: function() {
      var root = this._map._pathRoot,
          path = this._container;
      if (path && root.lastChild !== path) {
        root.appendChild(path);
      }
      return this;
    },
    bringToBack: function() {
      var root = this._map._pathRoot,
          path = this._container,
          first = root.firstChild;
      if (path && first !== path) {
        root.insertBefore(path, first);
      }
      return this;
    },
    getPathString: function() {},
    _createElement: function(name) {
      return document.createElementNS(L.Path.SVG_NS, name);
    },
    _initElements: function() {
      this._map._initPathRoot();
      this._initPath();
      this._initStyle();
    },
    _initPath: function() {
      this._container = this._createElement('g');
      this._path = this._createElement('path');
      if (this.options.className) {
        L.DomUtil.addClass(this._path, this.options.className);
      }
      this._container.appendChild(this._path);
    },
    _initStyle: function() {
      if (this.options.stroke) {
        this._path.setAttribute('stroke-linejoin', 'round');
        this._path.setAttribute('stroke-linecap', 'round');
      }
      if (this.options.fill) {
        this._path.setAttribute('fill-rule', 'evenodd');
      }
      if (this.options.pointerEvents) {
        this._path.setAttribute('pointer-events', this.options.pointerEvents);
      }
      if (!this.options.clickable && !this.options.pointerEvents) {
        this._path.setAttribute('pointer-events', 'none');
      }
      this._updateStyle();
    },
    _updateStyle: function() {
      if (this.options.stroke) {
        this._path.setAttribute('stroke', this.options.color);
        this._path.setAttribute('stroke-opacity', this.options.opacity);
        this._path.setAttribute('stroke-width', this.options.weight);
        if (this.options.dashArray) {
          this._path.setAttribute('stroke-dasharray', this.options.dashArray);
        } else {
          this._path.removeAttribute('stroke-dasharray');
        }
        if (this.options.lineCap) {
          this._path.setAttribute('stroke-linecap', this.options.lineCap);
        }
        if (this.options.lineJoin) {
          this._path.setAttribute('stroke-linejoin', this.options.lineJoin);
        }
      } else {
        this._path.setAttribute('stroke', 'none');
      }
      if (this.options.fill) {
        this._path.setAttribute('fill', this.options.fillColor || this.options.color);
        this._path.setAttribute('fill-opacity', this.options.fillOpacity);
      } else {
        this._path.setAttribute('fill', 'none');
      }
    },
    _updatePath: function() {
      var str = this.getPathString();
      if (!str) {
        str = 'M0 0';
      }
      this._path.setAttribute('d', str);
    },
    _initEvents: function() {
      if (this.options.clickable) {
        if (L.Browser.svg || !L.Browser.vml) {
          L.DomUtil.addClass(this._path, 'leaflet-clickable');
        }
        L.DomEvent.on(this._container, 'click', this._onMouseClick, this);
        var events = ['dblclick', 'mousedown', 'mouseover', 'mouseout', 'mousemove', 'contextmenu'];
        for (var i = 0; i < events.length; i++) {
          L.DomEvent.on(this._container, events[i], this._fireMouseEvent, this);
        }
      }
    },
    _onMouseClick: function(e) {
      if (this._map.dragging && this._map.dragging.moved()) {
        return;
      }
      this._fireMouseEvent(e);
    },
    _fireMouseEvent: function(e) {
      if (!this._map || !this.hasEventListeners(e.type)) {
        return;
      }
      var map = this._map,
          containerPoint = map.mouseEventToContainerPoint(e),
          layerPoint = map.containerPointToLayerPoint(containerPoint),
          latlng = map.layerPointToLatLng(layerPoint);
      this.fire(e.type, {
        latlng: latlng,
        layerPoint: layerPoint,
        containerPoint: containerPoint,
        originalEvent: e
      });
      if (e.type === 'contextmenu') {
        L.DomEvent.preventDefault(e);
      }
      if (e.type !== 'mousemove') {
        L.DomEvent.stopPropagation(e);
      }
    }
  });
  L.Map.include({
    _initPathRoot: function() {
      if (!this._pathRoot) {
        this._pathRoot = L.Path.prototype._createElement('svg');
        this._panes.overlayPane.appendChild(this._pathRoot);
        if (this.options.zoomAnimation && L.Browser.any3d) {
          L.DomUtil.addClass(this._pathRoot, 'leaflet-zoom-animated');
          this.on({
            'zoomanim': this._animatePathZoom,
            'zoomend': this._endPathZoom
          });
        } else {
          L.DomUtil.addClass(this._pathRoot, 'leaflet-zoom-hide');
        }
        this.on('moveend', this._updateSvgViewport);
        this._updateSvgViewport();
      }
    },
    _animatePathZoom: function(e) {
      var scale = this.getZoomScale(e.zoom),
          offset = this._getCenterOffset(e.center)._multiplyBy(-scale)._add(this._pathViewport.min);
      this._pathRoot.style[L.DomUtil.TRANSFORM] = L.DomUtil.getTranslateString(offset) + ' scale(' + scale + ') ';
      this._pathZooming = true;
    },
    _endPathZoom: function() {
      this._pathZooming = false;
    },
    _updateSvgViewport: function() {
      if (this._pathZooming) {
        return;
      }
      this._updatePathViewport();
      var vp = this._pathViewport,
          min = vp.min,
          max = vp.max,
          width = max.x - min.x,
          height = max.y - min.y,
          root = this._pathRoot,
          pane = this._panes.overlayPane;
      if (L.Browser.mobileWebkit) {
        pane.removeChild(root);
      }
      L.DomUtil.setPosition(root, min);
      root.setAttribute('width', width);
      root.setAttribute('height', height);
      root.setAttribute('viewBox', [min.x, min.y, width, height].join(' '));
      if (L.Browser.mobileWebkit) {
        pane.appendChild(root);
      }
    }
  });
  L.Path.include({
    bindPopup: function(content, options) {
      if (content instanceof L.Popup) {
        this._popup = content;
      } else {
        if (!this._popup || options) {
          this._popup = new L.Popup(options, this);
        }
        this._popup.setContent(content);
      }
      if (!this._popupHandlersAdded) {
        this.on('click', this._openPopup, this).on('remove', this.closePopup, this);
        this._popupHandlersAdded = true;
      }
      return this;
    },
    unbindPopup: function() {
      if (this._popup) {
        this._popup = null;
        this.off('click', this._openPopup).off('remove', this.closePopup);
        this._popupHandlersAdded = false;
      }
      return this;
    },
    openPopup: function(latlng) {
      if (this._popup) {
        latlng = latlng || this._latlng || this._latlngs[Math.floor(this._latlngs.length / 2)];
        this._openPopup({latlng: latlng});
      }
      return this;
    },
    closePopup: function() {
      if (this._popup) {
        this._popup._close();
      }
      return this;
    },
    _openPopup: function(e) {
      this._popup.setLatLng(e.latlng);
      this._map.openPopup(this._popup);
    }
  });
  L.Browser.vml = !L.Browser.svg && (function() {
    try {
      var div = document.createElement('div');
      div.innerHTML = '<v:shape adj="1"/>';
      var shape = div.firstChild;
      shape.style.behavior = 'url(#default#VML)';
      return shape && (typeof shape.adj === 'object');
    } catch (e) {
      return false;
    }
  }());
  L.Path = L.Browser.svg || !L.Browser.vml ? L.Path : L.Path.extend({
    statics: {
      VML: true,
      CLIP_PADDING: 0.02
    },
    _createElement: (function() {
      try {
        document.namespaces.add('lvml', 'urn:schemas-microsoft-com:vml');
        return function(name) {
          return document.createElement('<lvml:' + name + ' class="lvml">');
        };
      } catch (e) {
        return function(name) {
          return document.createElement('<' + name + ' xmlns="urn:schemas-microsoft.com:vml" class="lvml">');
        };
      }
    }()),
    _initPath: function() {
      var container = this._container = this._createElement('shape');
      L.DomUtil.addClass(container, 'leaflet-vml-shape' + (this.options.className ? ' ' + this.options.className : ''));
      if (this.options.clickable) {
        L.DomUtil.addClass(container, 'leaflet-clickable');
      }
      container.coordsize = '1 1';
      this._path = this._createElement('path');
      container.appendChild(this._path);
      this._map._pathRoot.appendChild(container);
    },
    _initStyle: function() {
      this._updateStyle();
    },
    _updateStyle: function() {
      var stroke = this._stroke,
          fill = this._fill,
          options = this.options,
          container = this._container;
      container.stroked = options.stroke;
      container.filled = options.fill;
      if (options.stroke) {
        if (!stroke) {
          stroke = this._stroke = this._createElement('stroke');
          stroke.endcap = 'round';
          container.appendChild(stroke);
        }
        stroke.weight = options.weight + 'px';
        stroke.color = options.color;
        stroke.opacity = options.opacity;
        if (options.dashArray) {
          stroke.dashStyle = L.Util.isArray(options.dashArray) ? options.dashArray.join(' ') : options.dashArray.replace(/( *, *)/g, ' ');
        } else {
          stroke.dashStyle = '';
        }
        if (options.lineCap) {
          stroke.endcap = options.lineCap.replace('butt', 'flat');
        }
        if (options.lineJoin) {
          stroke.joinstyle = options.lineJoin;
        }
      } else if (stroke) {
        container.removeChild(stroke);
        this._stroke = null;
      }
      if (options.fill) {
        if (!fill) {
          fill = this._fill = this._createElement('fill');
          container.appendChild(fill);
        }
        fill.color = options.fillColor || options.color;
        fill.opacity = options.fillOpacity;
      } else if (fill) {
        container.removeChild(fill);
        this._fill = null;
      }
    },
    _updatePath: function() {
      var style = this._container.style;
      style.display = 'none';
      this._path.v = this.getPathString() + ' ';
      style.display = '';
    }
  });
  L.Map.include(L.Browser.svg || !L.Browser.vml ? {} : {_initPathRoot: function() {
      if (this._pathRoot) {
        return;
      }
      var root = this._pathRoot = document.createElement('div');
      root.className = 'leaflet-vml-container';
      this._panes.overlayPane.appendChild(root);
      this.on('moveend', this._updatePathViewport);
      this._updatePathViewport();
    }});
  L.Browser.canvas = (function() {
    return !!document.createElement('canvas').getContext;
  }());
  L.Path = (L.Path.SVG && !window.L_PREFER_CANVAS) || !L.Browser.canvas ? L.Path : L.Path.extend({
    statics: {
      CANVAS: true,
      SVG: false
    },
    redraw: function() {
      if (this._map) {
        this.projectLatlngs();
        this._requestUpdate();
      }
      return this;
    },
    setStyle: function(style) {
      L.setOptions(this, style);
      if (this._map) {
        this._updateStyle();
        this._requestUpdate();
      }
      return this;
    },
    onRemove: function(map) {
      map.off('viewreset', this.projectLatlngs, this).off('moveend', this._updatePath, this);
      if (this.options.clickable) {
        this._map.off('click', this._onClick, this);
        this._map.off('mousemove', this._onMouseMove, this);
      }
      this._requestUpdate();
      this.fire('remove');
      this._map = null;
    },
    _requestUpdate: function() {
      if (this._map && !L.Path._updateRequest) {
        L.Path._updateRequest = L.Util.requestAnimFrame(this._fireMapMoveEnd, this._map);
      }
    },
    _fireMapMoveEnd: function() {
      L.Path._updateRequest = null;
      this.fire('moveend');
    },
    _initElements: function() {
      this._map._initPathRoot();
      this._ctx = this._map._canvasCtx;
    },
    _updateStyle: function() {
      var options = this.options;
      if (options.stroke) {
        this._ctx.lineWidth = options.weight;
        this._ctx.strokeStyle = options.color;
      }
      if (options.fill) {
        this._ctx.fillStyle = options.fillColor || options.color;
      }
      if (options.lineCap) {
        this._ctx.lineCap = options.lineCap;
      }
      if (options.lineJoin) {
        this._ctx.lineJoin = options.lineJoin;
      }
    },
    _drawPath: function() {
      var i,
          j,
          len,
          len2,
          point,
          drawMethod;
      this._ctx.beginPath();
      for (i = 0, len = this._parts.length; i < len; i++) {
        for (j = 0, len2 = this._parts[i].length; j < len2; j++) {
          point = this._parts[i][j];
          drawMethod = (j === 0 ? 'move' : 'line') + 'To';
          this._ctx[drawMethod](point.x, point.y);
        }
        if (this instanceof L.Polygon) {
          this._ctx.closePath();
        }
      }
    },
    _checkIfEmpty: function() {
      return !this._parts.length;
    },
    _updatePath: function() {
      if (this._checkIfEmpty()) {
        return;
      }
      var ctx = this._ctx,
          options = this.options;
      this._drawPath();
      ctx.save();
      this._updateStyle();
      if (options.fill) {
        ctx.globalAlpha = options.fillOpacity;
        ctx.fill(options.fillRule || 'evenodd');
      }
      if (options.stroke) {
        ctx.globalAlpha = options.opacity;
        ctx.stroke();
      }
      ctx.restore();
    },
    _initEvents: function() {
      if (this.options.clickable) {
        this._map.on('mousemove', this._onMouseMove, this);
        this._map.on('click dblclick contextmenu', this._fireMouseEvent, this);
      }
    },
    _fireMouseEvent: function(e) {
      if (this._containsPoint(e.layerPoint)) {
        this.fire(e.type, e);
      }
    },
    _onMouseMove: function(e) {
      if (!this._map || this._map._animatingZoom) {
        return;
      }
      if (this._containsPoint(e.layerPoint)) {
        this._ctx.canvas.style.cursor = 'pointer';
        this._mouseInside = true;
        this.fire('mouseover', e);
      } else if (this._mouseInside) {
        this._ctx.canvas.style.cursor = '';
        this._mouseInside = false;
        this.fire('mouseout', e);
      }
    }
  });
  L.Map.include((L.Path.SVG && !window.L_PREFER_CANVAS) || !L.Browser.canvas ? {} : {
    _initPathRoot: function() {
      var root = this._pathRoot,
          ctx;
      if (!root) {
        root = this._pathRoot = document.createElement('canvas');
        root.style.position = 'absolute';
        ctx = this._canvasCtx = root.getContext('2d');
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        this._panes.overlayPane.appendChild(root);
        if (this.options.zoomAnimation) {
          this._pathRoot.className = 'leaflet-zoom-animated';
          this.on('zoomanim', this._animatePathZoom);
          this.on('zoomend', this._endPathZoom);
        }
        this.on('moveend', this._updateCanvasViewport);
        this._updateCanvasViewport();
      }
    },
    _updateCanvasViewport: function() {
      if (this._pathZooming) {
        return;
      }
      this._updatePathViewport();
      var vp = this._pathViewport,
          min = vp.min,
          size = vp.max.subtract(min),
          root = this._pathRoot;
      L.DomUtil.setPosition(root, min);
      root.width = size.x;
      root.height = size.y;
      root.getContext('2d').translate(-min.x, -min.y);
    }
  });
  L.LineUtil = {
    simplify: function(points, tolerance) {
      if (!tolerance || !points.length) {
        return points.slice();
      }
      var sqTolerance = tolerance * tolerance;
      points = this._reducePoints(points, sqTolerance);
      points = this._simplifyDP(points, sqTolerance);
      return points;
    },
    pointToSegmentDistance: function(p, p1, p2) {
      return Math.sqrt(this._sqClosestPointOnSegment(p, p1, p2, true));
    },
    closestPointOnSegment: function(p, p1, p2) {
      return this._sqClosestPointOnSegment(p, p1, p2);
    },
    _simplifyDP: function(points, sqTolerance) {
      var len = points.length,
          ArrayConstructor = typeof Uint8Array !== undefined + '' ? Uint8Array : Array,
          markers = new ArrayConstructor(len);
      markers[0] = markers[len - 1] = 1;
      this._simplifyDPStep(points, markers, sqTolerance, 0, len - 1);
      var i,
          newPoints = [];
      for (i = 0; i < len; i++) {
        if (markers[i]) {
          newPoints.push(points[i]);
        }
      }
      return newPoints;
    },
    _simplifyDPStep: function(points, markers, sqTolerance, first, last) {
      var maxSqDist = 0,
          index,
          i,
          sqDist;
      for (i = first + 1; i <= last - 1; i++) {
        sqDist = this._sqClosestPointOnSegment(points[i], points[first], points[last], true);
        if (sqDist > maxSqDist) {
          index = i;
          maxSqDist = sqDist;
        }
      }
      if (maxSqDist > sqTolerance) {
        markers[index] = 1;
        this._simplifyDPStep(points, markers, sqTolerance, first, index);
        this._simplifyDPStep(points, markers, sqTolerance, index, last);
      }
    },
    _reducePoints: function(points, sqTolerance) {
      var reducedPoints = [points[0]];
      for (var i = 1,
          prev = 0,
          len = points.length; i < len; i++) {
        if (this._sqDist(points[i], points[prev]) > sqTolerance) {
          reducedPoints.push(points[i]);
          prev = i;
        }
      }
      if (prev < len - 1) {
        reducedPoints.push(points[len - 1]);
      }
      return reducedPoints;
    },
    clipSegment: function(a, b, bounds, useLastCode) {
      var codeA = useLastCode ? this._lastCode : this._getBitCode(a, bounds),
          codeB = this._getBitCode(b, bounds),
          codeOut,
          p,
          newCode;
      this._lastCode = codeB;
      while (true) {
        if (!(codeA | codeB)) {
          return [a, b];
        } else if (codeA & codeB) {
          return false;
        } else {
          codeOut = codeA || codeB;
          p = this._getEdgeIntersection(a, b, codeOut, bounds);
          newCode = this._getBitCode(p, bounds);
          if (codeOut === codeA) {
            a = p;
            codeA = newCode;
          } else {
            b = p;
            codeB = newCode;
          }
        }
      }
    },
    _getEdgeIntersection: function(a, b, code, bounds) {
      var dx = b.x - a.x,
          dy = b.y - a.y,
          min = bounds.min,
          max = bounds.max;
      if (code & 8) {
        return new L.Point(a.x + dx * (max.y - a.y) / dy, max.y);
      } else if (code & 4) {
        return new L.Point(a.x + dx * (min.y - a.y) / dy, min.y);
      } else if (code & 2) {
        return new L.Point(max.x, a.y + dy * (max.x - a.x) / dx);
      } else if (code & 1) {
        return new L.Point(min.x, a.y + dy * (min.x - a.x) / dx);
      }
    },
    _getBitCode: function(p, bounds) {
      var code = 0;
      if (p.x < bounds.min.x) {
        code |= 1;
      } else if (p.x > bounds.max.x) {
        code |= 2;
      }
      if (p.y < bounds.min.y) {
        code |= 4;
      } else if (p.y > bounds.max.y) {
        code |= 8;
      }
      return code;
    },
    _sqDist: function(p1, p2) {
      var dx = p2.x - p1.x,
          dy = p2.y - p1.y;
      return dx * dx + dy * dy;
    },
    _sqClosestPointOnSegment: function(p, p1, p2, sqDist) {
      var x = p1.x,
          y = p1.y,
          dx = p2.x - x,
          dy = p2.y - y,
          dot = dx * dx + dy * dy,
          t;
      if (dot > 0) {
        t = ((p.x - x) * dx + (p.y - y) * dy) / dot;
        if (t > 1) {
          x = p2.x;
          y = p2.y;
        } else if (t > 0) {
          x += dx * t;
          y += dy * t;
        }
      }
      dx = p.x - x;
      dy = p.y - y;
      return sqDist ? dx * dx + dy * dy : new L.Point(x, y);
    }
  };
  L.Polyline = L.Path.extend({
    initialize: function(latlngs, options) {
      L.Path.prototype.initialize.call(this, options);
      this._latlngs = this._convertLatLngs(latlngs);
    },
    options: {
      smoothFactor: 1.0,
      noClip: false
    },
    projectLatlngs: function() {
      this._originalPoints = [];
      for (var i = 0,
          len = this._latlngs.length; i < len; i++) {
        this._originalPoints[i] = this._map.latLngToLayerPoint(this._latlngs[i]);
      }
    },
    getPathString: function() {
      for (var i = 0,
          len = this._parts.length,
          str = ''; i < len; i++) {
        str += this._getPathPartStr(this._parts[i]);
      }
      return str;
    },
    getLatLngs: function() {
      return this._latlngs;
    },
    setLatLngs: function(latlngs) {
      this._latlngs = this._convertLatLngs(latlngs);
      return this.redraw();
    },
    addLatLng: function(latlng) {
      this._latlngs.push(L.latLng(latlng));
      return this.redraw();
    },
    spliceLatLngs: function() {
      var removed = [].splice.apply(this._latlngs, arguments);
      this._convertLatLngs(this._latlngs, true);
      this.redraw();
      return removed;
    },
    closestLayerPoint: function(p) {
      var minDistance = Infinity,
          parts = this._parts,
          p1,
          p2,
          minPoint = null;
      for (var j = 0,
          jLen = parts.length; j < jLen; j++) {
        var points = parts[j];
        for (var i = 1,
            len = points.length; i < len; i++) {
          p1 = points[i - 1];
          p2 = points[i];
          var sqDist = L.LineUtil._sqClosestPointOnSegment(p, p1, p2, true);
          if (sqDist < minDistance) {
            minDistance = sqDist;
            minPoint = L.LineUtil._sqClosestPointOnSegment(p, p1, p2);
          }
        }
      }
      if (minPoint) {
        minPoint.distance = Math.sqrt(minDistance);
      }
      return minPoint;
    },
    getBounds: function() {
      return new L.LatLngBounds(this.getLatLngs());
    },
    _convertLatLngs: function(latlngs, overwrite) {
      var i,
          len,
          target = overwrite ? latlngs : [];
      for (i = 0, len = latlngs.length; i < len; i++) {
        if (L.Util.isArray(latlngs[i]) && typeof latlngs[i][0] !== 'number') {
          return;
        }
        target[i] = L.latLng(latlngs[i]);
      }
      return target;
    },
    _initEvents: function() {
      L.Path.prototype._initEvents.call(this);
    },
    _getPathPartStr: function(points) {
      var round = L.Path.VML;
      for (var j = 0,
          len2 = points.length,
          str = '',
          p; j < len2; j++) {
        p = points[j];
        if (round) {
          p._round();
        }
        str += (j ? 'L' : 'M') + p.x + ' ' + p.y;
      }
      return str;
    },
    _clipPoints: function() {
      var points = this._originalPoints,
          len = points.length,
          i,
          k,
          segment;
      if (this.options.noClip) {
        this._parts = [points];
        return;
      }
      this._parts = [];
      var parts = this._parts,
          vp = this._map._pathViewport,
          lu = L.LineUtil;
      for (i = 0, k = 0; i < len - 1; i++) {
        segment = lu.clipSegment(points[i], points[i + 1], vp, i);
        if (!segment) {
          continue;
        }
        parts[k] = parts[k] || [];
        parts[k].push(segment[0]);
        if ((segment[1] !== points[i + 1]) || (i === len - 2)) {
          parts[k].push(segment[1]);
          k++;
        }
      }
    },
    _simplifyPoints: function() {
      var parts = this._parts,
          lu = L.LineUtil;
      for (var i = 0,
          len = parts.length; i < len; i++) {
        parts[i] = lu.simplify(parts[i], this.options.smoothFactor);
      }
    },
    _updatePath: function() {
      if (!this._map) {
        return;
      }
      this._clipPoints();
      this._simplifyPoints();
      L.Path.prototype._updatePath.call(this);
    }
  });
  L.polyline = function(latlngs, options) {
    return new L.Polyline(latlngs, options);
  };
  L.PolyUtil = {};
  L.PolyUtil.clipPolygon = function(points, bounds) {
    var clippedPoints,
        edges = [1, 4, 2, 8],
        i,
        j,
        k,
        a,
        b,
        len,
        edge,
        p,
        lu = L.LineUtil;
    for (i = 0, len = points.length; i < len; i++) {
      points[i]._code = lu._getBitCode(points[i], bounds);
    }
    for (k = 0; k < 4; k++) {
      edge = edges[k];
      clippedPoints = [];
      for (i = 0, len = points.length, j = len - 1; i < len; j = i++) {
        a = points[i];
        b = points[j];
        if (!(a._code & edge)) {
          if (b._code & edge) {
            p = lu._getEdgeIntersection(b, a, edge, bounds);
            p._code = lu._getBitCode(p, bounds);
            clippedPoints.push(p);
          }
          clippedPoints.push(a);
        } else if (!(b._code & edge)) {
          p = lu._getEdgeIntersection(b, a, edge, bounds);
          p._code = lu._getBitCode(p, bounds);
          clippedPoints.push(p);
        }
      }
      points = clippedPoints;
    }
    return points;
  };
  L.Polygon = L.Polyline.extend({
    options: {fill: true},
    initialize: function(latlngs, options) {
      L.Polyline.prototype.initialize.call(this, latlngs, options);
      this._initWithHoles(latlngs);
    },
    _initWithHoles: function(latlngs) {
      var i,
          len,
          hole;
      if (latlngs && L.Util.isArray(latlngs[0]) && (typeof latlngs[0][0] !== 'number')) {
        this._latlngs = this._convertLatLngs(latlngs[0]);
        this._holes = latlngs.slice(1);
        for (i = 0, len = this._holes.length; i < len; i++) {
          hole = this._holes[i] = this._convertLatLngs(this._holes[i]);
          if (hole[0].equals(hole[hole.length - 1])) {
            hole.pop();
          }
        }
      }
      latlngs = this._latlngs;
      if (latlngs.length >= 2 && latlngs[0].equals(latlngs[latlngs.length - 1])) {
        latlngs.pop();
      }
    },
    projectLatlngs: function() {
      L.Polyline.prototype.projectLatlngs.call(this);
      this._holePoints = [];
      if (!this._holes) {
        return;
      }
      var i,
          j,
          len,
          len2;
      for (i = 0, len = this._holes.length; i < len; i++) {
        this._holePoints[i] = [];
        for (j = 0, len2 = this._holes[i].length; j < len2; j++) {
          this._holePoints[i][j] = this._map.latLngToLayerPoint(this._holes[i][j]);
        }
      }
    },
    setLatLngs: function(latlngs) {
      if (latlngs && L.Util.isArray(latlngs[0]) && (typeof latlngs[0][0] !== 'number')) {
        this._initWithHoles(latlngs);
        return this.redraw();
      } else {
        return L.Polyline.prototype.setLatLngs.call(this, latlngs);
      }
    },
    _clipPoints: function() {
      var points = this._originalPoints,
          newParts = [];
      this._parts = [points].concat(this._holePoints);
      if (this.options.noClip) {
        return;
      }
      for (var i = 0,
          len = this._parts.length; i < len; i++) {
        var clipped = L.PolyUtil.clipPolygon(this._parts[i], this._map._pathViewport);
        if (clipped.length) {
          newParts.push(clipped);
        }
      }
      this._parts = newParts;
    },
    _getPathPartStr: function(points) {
      var str = L.Polyline.prototype._getPathPartStr.call(this, points);
      return str + (L.Browser.svg ? 'z' : 'x');
    }
  });
  L.polygon = function(latlngs, options) {
    return new L.Polygon(latlngs, options);
  };
  (function() {
    function createMulti(Klass) {
      return L.FeatureGroup.extend({
        initialize: function(latlngs, options) {
          this._layers = {};
          this._options = options;
          this.setLatLngs(latlngs);
        },
        setLatLngs: function(latlngs) {
          var i = 0,
              len = latlngs.length;
          this.eachLayer(function(layer) {
            if (i < len) {
              layer.setLatLngs(latlngs[i++]);
            } else {
              this.removeLayer(layer);
            }
          }, this);
          while (i < len) {
            this.addLayer(new Klass(latlngs[i++], this._options));
          }
          return this;
        },
        getLatLngs: function() {
          var latlngs = [];
          this.eachLayer(function(layer) {
            latlngs.push(layer.getLatLngs());
          });
          return latlngs;
        }
      });
    }
    L.MultiPolyline = createMulti(L.Polyline);
    L.MultiPolygon = createMulti(L.Polygon);
    L.multiPolyline = function(latlngs, options) {
      return new L.MultiPolyline(latlngs, options);
    };
    L.multiPolygon = function(latlngs, options) {
      return new L.MultiPolygon(latlngs, options);
    };
  }());
  L.Rectangle = L.Polygon.extend({
    initialize: function(latLngBounds, options) {
      L.Polygon.prototype.initialize.call(this, this._boundsToLatLngs(latLngBounds), options);
    },
    setBounds: function(latLngBounds) {
      this.setLatLngs(this._boundsToLatLngs(latLngBounds));
    },
    _boundsToLatLngs: function(latLngBounds) {
      latLngBounds = L.latLngBounds(latLngBounds);
      return [latLngBounds.getSouthWest(), latLngBounds.getNorthWest(), latLngBounds.getNorthEast(), latLngBounds.getSouthEast()];
    }
  });
  L.rectangle = function(latLngBounds, options) {
    return new L.Rectangle(latLngBounds, options);
  };
  L.Circle = L.Path.extend({
    initialize: function(latlng, radius, options) {
      L.Path.prototype.initialize.call(this, options);
      this._latlng = L.latLng(latlng);
      this._mRadius = radius;
    },
    options: {fill: true},
    setLatLng: function(latlng) {
      this._latlng = L.latLng(latlng);
      return this.redraw();
    },
    setRadius: function(radius) {
      this._mRadius = radius;
      return this.redraw();
    },
    projectLatlngs: function() {
      var lngRadius = this._getLngRadius(),
          latlng = this._latlng,
          pointLeft = this._map.latLngToLayerPoint([latlng.lat, latlng.lng - lngRadius]);
      this._point = this._map.latLngToLayerPoint(latlng);
      this._radius = Math.max(this._point.x - pointLeft.x, 1);
    },
    getBounds: function() {
      var lngRadius = this._getLngRadius(),
          latRadius = (this._mRadius / 40075017) * 360,
          latlng = this._latlng;
      return new L.LatLngBounds([latlng.lat - latRadius, latlng.lng - lngRadius], [latlng.lat + latRadius, latlng.lng + lngRadius]);
    },
    getLatLng: function() {
      return this._latlng;
    },
    getPathString: function() {
      var p = this._point,
          r = this._radius;
      if (this._checkIfEmpty()) {
        return '';
      }
      if (L.Browser.svg) {
        return 'M' + p.x + ',' + (p.y - r) + 'A' + r + ',' + r + ',0,1,1,' + (p.x - 0.1) + ',' + (p.y - r) + ' z';
      } else {
        p._round();
        r = Math.round(r);
        return 'AL ' + p.x + ',' + p.y + ' ' + r + ',' + r + ' 0,' + (65535 * 360);
      }
    },
    getRadius: function() {
      return this._mRadius;
    },
    _getLatRadius: function() {
      return (this._mRadius / 40075017) * 360;
    },
    _getLngRadius: function() {
      return this._getLatRadius() / Math.cos(L.LatLng.DEG_TO_RAD * this._latlng.lat);
    },
    _checkIfEmpty: function() {
      if (!this._map) {
        return false;
      }
      var vp = this._map._pathViewport,
          r = this._radius,
          p = this._point;
      return p.x - r > vp.max.x || p.y - r > vp.max.y || p.x + r < vp.min.x || p.y + r < vp.min.y;
    }
  });
  L.circle = function(latlng, radius, options) {
    return new L.Circle(latlng, radius, options);
  };
  L.CircleMarker = L.Circle.extend({
    options: {
      radius: 10,
      weight: 2
    },
    initialize: function(latlng, options) {
      L.Circle.prototype.initialize.call(this, latlng, null, options);
      this._radius = this.options.radius;
    },
    projectLatlngs: function() {
      this._point = this._map.latLngToLayerPoint(this._latlng);
    },
    _updateStyle: function() {
      L.Circle.prototype._updateStyle.call(this);
      this.setRadius(this.options.radius);
    },
    setLatLng: function(latlng) {
      L.Circle.prototype.setLatLng.call(this, latlng);
      if (this._popup && this._popup._isOpen) {
        this._popup.setLatLng(latlng);
      }
      return this;
    },
    setRadius: function(radius) {
      this.options.radius = this._radius = radius;
      return this.redraw();
    },
    getRadius: function() {
      return this._radius;
    }
  });
  L.circleMarker = function(latlng, options) {
    return new L.CircleMarker(latlng, options);
  };
  L.Polyline.include(!L.Path.CANVAS ? {} : {_containsPoint: function(p, closed) {
      var i,
          j,
          k,
          len,
          len2,
          dist,
          part,
          w = this.options.weight / 2;
      if (L.Browser.touch) {
        w += 10;
      }
      for (i = 0, len = this._parts.length; i < len; i++) {
        part = this._parts[i];
        for (j = 0, len2 = part.length, k = len2 - 1; j < len2; k = j++) {
          if (!closed && (j === 0)) {
            continue;
          }
          dist = L.LineUtil.pointToSegmentDistance(p, part[k], part[j]);
          if (dist <= w) {
            return true;
          }
        }
      }
      return false;
    }});
  L.Polygon.include(!L.Path.CANVAS ? {} : {_containsPoint: function(p) {
      var inside = false,
          part,
          p1,
          p2,
          i,
          j,
          k,
          len,
          len2;
      if (L.Polyline.prototype._containsPoint.call(this, p, true)) {
        return true;
      }
      for (i = 0, len = this._parts.length; i < len; i++) {
        part = this._parts[i];
        for (j = 0, len2 = part.length, k = len2 - 1; j < len2; k = j++) {
          p1 = part[j];
          p2 = part[k];
          if (((p1.y > p.y) !== (p2.y > p.y)) && (p.x < (p2.x - p1.x) * (p.y - p1.y) / (p2.y - p1.y) + p1.x)) {
            inside = !inside;
          }
        }
      }
      return inside;
    }});
  L.Circle.include(!L.Path.CANVAS ? {} : {
    _drawPath: function() {
      var p = this._point;
      this._ctx.beginPath();
      this._ctx.arc(p.x, p.y, this._radius, 0, Math.PI * 2, false);
    },
    _containsPoint: function(p) {
      var center = this._point,
          w2 = this.options.stroke ? this.options.weight / 2 : 0;
      return (p.distanceTo(center) <= this._radius + w2);
    }
  });
  L.CircleMarker.include(!L.Path.CANVAS ? {} : {_updateStyle: function() {
      L.Path.prototype._updateStyle.call(this);
    }});
  L.GeoJSON = L.FeatureGroup.extend({
    initialize: function(geojson, options) {
      L.setOptions(this, options);
      this._layers = {};
      if (geojson) {
        this.addData(geojson);
      }
    },
    addData: function(geojson) {
      var features = L.Util.isArray(geojson) ? geojson : geojson.features,
          i,
          len,
          feature;
      if (features) {
        for (i = 0, len = features.length; i < len; i++) {
          feature = features[i];
          if (feature.geometries || feature.geometry || feature.features || feature.coordinates) {
            this.addData(features[i]);
          }
        }
        return this;
      }
      var options = this.options;
      if (options.filter && !options.filter(geojson)) {
        return;
      }
      var layer = L.GeoJSON.geometryToLayer(geojson, options.pointToLayer, options.coordsToLatLng, options);
      layer.feature = L.GeoJSON.asFeature(geojson);
      layer.defaultOptions = layer.options;
      this.resetStyle(layer);
      if (options.onEachFeature) {
        options.onEachFeature(geojson, layer);
      }
      return this.addLayer(layer);
    },
    resetStyle: function(layer) {
      var style = this.options.style;
      if (style) {
        L.Util.extend(layer.options, layer.defaultOptions);
        this._setLayerStyle(layer, style);
      }
    },
    setStyle: function(style) {
      this.eachLayer(function(layer) {
        this._setLayerStyle(layer, style);
      }, this);
    },
    _setLayerStyle: function(layer, style) {
      if (typeof style === 'function') {
        style = style(layer.feature);
      }
      if (layer.setStyle) {
        layer.setStyle(style);
      }
    }
  });
  L.extend(L.GeoJSON, {
    geometryToLayer: function(geojson, pointToLayer, coordsToLatLng, vectorOptions) {
      var geometry = geojson.type === 'Feature' ? geojson.geometry : geojson,
          coords = geometry.coordinates,
          layers = [],
          latlng,
          latlngs,
          i,
          len;
      coordsToLatLng = coordsToLatLng || this.coordsToLatLng;
      switch (geometry.type) {
        case 'Point':
          latlng = coordsToLatLng(coords);
          return pointToLayer ? pointToLayer(geojson, latlng) : new L.Marker(latlng);
        case 'MultiPoint':
          for (i = 0, len = coords.length; i < len; i++) {
            latlng = coordsToLatLng(coords[i]);
            layers.push(pointToLayer ? pointToLayer(geojson, latlng) : new L.Marker(latlng));
          }
          return new L.FeatureGroup(layers);
        case 'LineString':
          latlngs = this.coordsToLatLngs(coords, 0, coordsToLatLng);
          return new L.Polyline(latlngs, vectorOptions);
        case 'Polygon':
          if (coords.length === 2 && !coords[1].length) {
            throw new Error('Invalid GeoJSON object.');
          }
          latlngs = this.coordsToLatLngs(coords, 1, coordsToLatLng);
          return new L.Polygon(latlngs, vectorOptions);
        case 'MultiLineString':
          latlngs = this.coordsToLatLngs(coords, 1, coordsToLatLng);
          return new L.MultiPolyline(latlngs, vectorOptions);
        case 'MultiPolygon':
          latlngs = this.coordsToLatLngs(coords, 2, coordsToLatLng);
          return new L.MultiPolygon(latlngs, vectorOptions);
        case 'GeometryCollection':
          for (i = 0, len = geometry.geometries.length; i < len; i++) {
            layers.push(this.geometryToLayer({
              geometry: geometry.geometries[i],
              type: 'Feature',
              properties: geojson.properties
            }, pointToLayer, coordsToLatLng, vectorOptions));
          }
          return new L.FeatureGroup(layers);
        default:
          throw new Error('Invalid GeoJSON object.');
      }
    },
    coordsToLatLng: function(coords) {
      return new L.LatLng(coords[1], coords[0], coords[2]);
    },
    coordsToLatLngs: function(coords, levelsDeep, coordsToLatLng) {
      var latlng,
          i,
          len,
          latlngs = [];
      for (i = 0, len = coords.length; i < len; i++) {
        latlng = levelsDeep ? this.coordsToLatLngs(coords[i], levelsDeep - 1, coordsToLatLng) : (coordsToLatLng || this.coordsToLatLng)(coords[i]);
        latlngs.push(latlng);
      }
      return latlngs;
    },
    latLngToCoords: function(latlng) {
      var coords = [latlng.lng, latlng.lat];
      if (latlng.alt !== undefined) {
        coords.push(latlng.alt);
      }
      return coords;
    },
    latLngsToCoords: function(latLngs) {
      var coords = [];
      for (var i = 0,
          len = latLngs.length; i < len; i++) {
        coords.push(L.GeoJSON.latLngToCoords(latLngs[i]));
      }
      return coords;
    },
    getFeature: function(layer, newGeometry) {
      return layer.feature ? L.extend({}, layer.feature, {geometry: newGeometry}) : L.GeoJSON.asFeature(newGeometry);
    },
    asFeature: function(geoJSON) {
      if (geoJSON.type === 'Feature') {
        return geoJSON;
      }
      return {
        type: 'Feature',
        properties: {},
        geometry: geoJSON
      };
    }
  });
  var PointToGeoJSON = {toGeoJSON: function() {
      return L.GeoJSON.getFeature(this, {
        type: 'Point',
        coordinates: L.GeoJSON.latLngToCoords(this.getLatLng())
      });
    }};
  L.Marker.include(PointToGeoJSON);
  L.Circle.include(PointToGeoJSON);
  L.CircleMarker.include(PointToGeoJSON);
  L.Polyline.include({toGeoJSON: function() {
      return L.GeoJSON.getFeature(this, {
        type: 'LineString',
        coordinates: L.GeoJSON.latLngsToCoords(this.getLatLngs())
      });
    }});
  L.Polygon.include({toGeoJSON: function() {
      var coords = [L.GeoJSON.latLngsToCoords(this.getLatLngs())],
          i,
          len,
          hole;
      coords[0].push(coords[0][0]);
      if (this._holes) {
        for (i = 0, len = this._holes.length; i < len; i++) {
          hole = L.GeoJSON.latLngsToCoords(this._holes[i]);
          hole.push(hole[0]);
          coords.push(hole);
        }
      }
      return L.GeoJSON.getFeature(this, {
        type: 'Polygon',
        coordinates: coords
      });
    }});
  (function() {
    function multiToGeoJSON(type) {
      return function() {
        var coords = [];
        this.eachLayer(function(layer) {
          coords.push(layer.toGeoJSON().geometry.coordinates);
        });
        return L.GeoJSON.getFeature(this, {
          type: type,
          coordinates: coords
        });
      };
    }
    L.MultiPolyline.include({toGeoJSON: multiToGeoJSON('MultiLineString')});
    L.MultiPolygon.include({toGeoJSON: multiToGeoJSON('MultiPolygon')});
    L.LayerGroup.include({toGeoJSON: function() {
        var geometry = this.feature && this.feature.geometry,
            jsons = [],
            json;
        if (geometry && geometry.type === 'MultiPoint') {
          return multiToGeoJSON('MultiPoint').call(this);
        }
        var isGeometryCollection = geometry && geometry.type === 'GeometryCollection';
        this.eachLayer(function(layer) {
          if (layer.toGeoJSON) {
            json = layer.toGeoJSON();
            jsons.push(isGeometryCollection ? json.geometry : L.GeoJSON.asFeature(json));
          }
        });
        if (isGeometryCollection) {
          return L.GeoJSON.getFeature(this, {
            geometries: jsons,
            type: 'GeometryCollection'
          });
        }
        return {
          type: 'FeatureCollection',
          features: jsons
        };
      }});
  }());
  L.geoJson = function(geojson, options) {
    return new L.GeoJSON(geojson, options);
  };
  L.DomEvent = {
    addListener: function(obj, type, fn, context) {
      var id = L.stamp(fn),
          key = '_leaflet_' + type + id,
          handler,
          originalHandler,
          newType;
      if (obj[key]) {
        return this;
      }
      handler = function(e) {
        return fn.call(context || obj, e || L.DomEvent._getEvent());
      };
      if (L.Browser.pointer && type.indexOf('touch') === 0) {
        return this.addPointerListener(obj, type, handler, id);
      }
      if (L.Browser.touch && (type === 'dblclick') && this.addDoubleTapListener) {
        this.addDoubleTapListener(obj, handler, id);
      }
      if ('addEventListener' in obj) {
        if (type === 'mousewheel') {
          obj.addEventListener('DOMMouseScroll', handler, false);
          obj.addEventListener(type, handler, false);
        } else if ((type === 'mouseenter') || (type === 'mouseleave')) {
          originalHandler = handler;
          newType = (type === 'mouseenter' ? 'mouseover' : 'mouseout');
          handler = function(e) {
            if (!L.DomEvent._checkMouse(obj, e)) {
              return;
            }
            return originalHandler(e);
          };
          obj.addEventListener(newType, handler, false);
        } else if (type === 'click' && L.Browser.android) {
          originalHandler = handler;
          handler = function(e) {
            return L.DomEvent._filterClick(e, originalHandler);
          };
          obj.addEventListener(type, handler, false);
        } else {
          obj.addEventListener(type, handler, false);
        }
      } else if ('attachEvent' in obj) {
        obj.attachEvent('on' + type, handler);
      }
      obj[key] = handler;
      return this;
    },
    removeListener: function(obj, type, fn) {
      var id = L.stamp(fn),
          key = '_leaflet_' + type + id,
          handler = obj[key];
      if (!handler) {
        return this;
      }
      if (L.Browser.pointer && type.indexOf('touch') === 0) {
        this.removePointerListener(obj, type, id);
      } else if (L.Browser.touch && (type === 'dblclick') && this.removeDoubleTapListener) {
        this.removeDoubleTapListener(obj, id);
      } else if ('removeEventListener' in obj) {
        if (type === 'mousewheel') {
          obj.removeEventListener('DOMMouseScroll', handler, false);
          obj.removeEventListener(type, handler, false);
        } else if ((type === 'mouseenter') || (type === 'mouseleave')) {
          obj.removeEventListener((type === 'mouseenter' ? 'mouseover' : 'mouseout'), handler, false);
        } else {
          obj.removeEventListener(type, handler, false);
        }
      } else if ('detachEvent' in obj) {
        obj.detachEvent('on' + type, handler);
      }
      obj[key] = null;
      return this;
    },
    stopPropagation: function(e) {
      if (e.stopPropagation) {
        e.stopPropagation();
      } else {
        e.cancelBubble = true;
      }
      L.DomEvent._skipped(e);
      return this;
    },
    disableScrollPropagation: function(el) {
      var stop = L.DomEvent.stopPropagation;
      return L.DomEvent.on(el, 'mousewheel', stop).on(el, 'MozMousePixelScroll', stop);
    },
    disableClickPropagation: function(el) {
      var stop = L.DomEvent.stopPropagation;
      for (var i = L.Draggable.START.length - 1; i >= 0; i--) {
        L.DomEvent.on(el, L.Draggable.START[i], stop);
      }
      return L.DomEvent.on(el, 'click', L.DomEvent._fakeStop).on(el, 'dblclick', stop);
    },
    preventDefault: function(e) {
      if (e.preventDefault) {
        e.preventDefault();
      } else {
        e.returnValue = false;
      }
      return this;
    },
    stop: function(e) {
      return L.DomEvent.preventDefault(e).stopPropagation(e);
    },
    getMousePosition: function(e, container) {
      if (!container) {
        return new L.Point(e.clientX, e.clientY);
      }
      var rect = container.getBoundingClientRect();
      return new L.Point(e.clientX - rect.left - container.clientLeft, e.clientY - rect.top - container.clientTop);
    },
    getWheelDelta: function(e) {
      var delta = 0;
      if (e.wheelDelta) {
        delta = e.wheelDelta / 120;
      }
      if (e.detail) {
        delta = -e.detail / 3;
      }
      return delta;
    },
    _skipEvents: {},
    _fakeStop: function(e) {
      L.DomEvent._skipEvents[e.type] = true;
    },
    _skipped: function(e) {
      var skipped = this._skipEvents[e.type];
      this._skipEvents[e.type] = false;
      return skipped;
    },
    _checkMouse: function(el, e) {
      var related = e.relatedTarget;
      if (!related) {
        return true;
      }
      try {
        while (related && (related !== el)) {
          related = related.parentNode;
        }
      } catch (err) {
        return false;
      }
      return (related !== el);
    },
    _getEvent: function() {
      var e = window.event;
      if (!e) {
        var caller = arguments.callee.caller;
        while (caller) {
          e = caller['arguments'][0];
          if (e && window.Event === e.constructor) {
            break;
          }
          caller = caller.caller;
        }
      }
      return e;
    },
    _filterClick: function(e, handler) {
      var timeStamp = (e.timeStamp || e.originalEvent.timeStamp),
          elapsed = L.DomEvent._lastClick && (timeStamp - L.DomEvent._lastClick);
      if ((elapsed && elapsed > 100 && elapsed < 500) || (e.target._simulatedClick && !e._simulated)) {
        L.DomEvent.stop(e);
        return;
      }
      L.DomEvent._lastClick = timeStamp;
      return handler(e);
    }
  };
  L.DomEvent.on = L.DomEvent.addListener;
  L.DomEvent.off = L.DomEvent.removeListener;
  L.Draggable = L.Class.extend({
    includes: L.Mixin.Events,
    statics: {
      START: L.Browser.touch ? ['touchstart', 'mousedown'] : ['mousedown'],
      END: {
        mousedown: 'mouseup',
        touchstart: 'touchend',
        pointerdown: 'touchend',
        MSPointerDown: 'touchend'
      },
      MOVE: {
        mousedown: 'mousemove',
        touchstart: 'touchmove',
        pointerdown: 'touchmove',
        MSPointerDown: 'touchmove'
      }
    },
    initialize: function(element, dragStartTarget) {
      this._element = element;
      this._dragStartTarget = dragStartTarget || element;
    },
    enable: function() {
      if (this._enabled) {
        return;
      }
      for (var i = L.Draggable.START.length - 1; i >= 0; i--) {
        L.DomEvent.on(this._dragStartTarget, L.Draggable.START[i], this._onDown, this);
      }
      this._enabled = true;
    },
    disable: function() {
      if (!this._enabled) {
        return;
      }
      for (var i = L.Draggable.START.length - 1; i >= 0; i--) {
        L.DomEvent.off(this._dragStartTarget, L.Draggable.START[i], this._onDown, this);
      }
      this._enabled = false;
      this._moved = false;
    },
    _onDown: function(e) {
      this._moved = false;
      if (e.shiftKey || ((e.which !== 1) && (e.button !== 1) && !e.touches)) {
        return;
      }
      L.DomEvent.stopPropagation(e);
      if (L.Draggable._disabled) {
        return;
      }
      L.DomUtil.disableImageDrag();
      L.DomUtil.disableTextSelection();
      if (this._moving) {
        return;
      }
      var first = e.touches ? e.touches[0] : e;
      this._startPoint = new L.Point(first.clientX, first.clientY);
      this._startPos = this._newPos = L.DomUtil.getPosition(this._element);
      L.DomEvent.on(document, L.Draggable.MOVE[e.type], this._onMove, this).on(document, L.Draggable.END[e.type], this._onUp, this);
    },
    _onMove: function(e) {
      if (e.touches && e.touches.length > 1) {
        this._moved = true;
        return;
      }
      var first = (e.touches && e.touches.length === 1 ? e.touches[0] : e),
          newPoint = new L.Point(first.clientX, first.clientY),
          offset = newPoint.subtract(this._startPoint);
      if (!offset.x && !offset.y) {
        return;
      }
      if (L.Browser.touch && Math.abs(offset.x) + Math.abs(offset.y) < 3) {
        return;
      }
      L.DomEvent.preventDefault(e);
      if (!this._moved) {
        this.fire('dragstart');
        this._moved = true;
        this._startPos = L.DomUtil.getPosition(this._element).subtract(offset);
        L.DomUtil.addClass(document.body, 'leaflet-dragging');
        this._lastTarget = e.target || e.srcElement;
        L.DomUtil.addClass(this._lastTarget, 'leaflet-drag-target');
      }
      this._newPos = this._startPos.add(offset);
      this._moving = true;
      L.Util.cancelAnimFrame(this._animRequest);
      this._animRequest = L.Util.requestAnimFrame(this._updatePosition, this, true, this._dragStartTarget);
    },
    _updatePosition: function() {
      this.fire('predrag');
      L.DomUtil.setPosition(this._element, this._newPos);
      this.fire('drag');
    },
    _onUp: function() {
      L.DomUtil.removeClass(document.body, 'leaflet-dragging');
      if (this._lastTarget) {
        L.DomUtil.removeClass(this._lastTarget, 'leaflet-drag-target');
        this._lastTarget = null;
      }
      for (var i in L.Draggable.MOVE) {
        L.DomEvent.off(document, L.Draggable.MOVE[i], this._onMove).off(document, L.Draggable.END[i], this._onUp);
      }
      L.DomUtil.enableImageDrag();
      L.DomUtil.enableTextSelection();
      if (this._moved && this._moving) {
        L.Util.cancelAnimFrame(this._animRequest);
        this.fire('dragend', {distance: this._newPos.distanceTo(this._startPos)});
      }
      this._moving = false;
    }
  });
  L.Handler = L.Class.extend({
    initialize: function(map) {
      this._map = map;
    },
    enable: function() {
      if (this._enabled) {
        return;
      }
      this._enabled = true;
      this.addHooks();
    },
    disable: function() {
      if (!this._enabled) {
        return;
      }
      this._enabled = false;
      this.removeHooks();
    },
    enabled: function() {
      return !!this._enabled;
    }
  });
  L.Map.mergeOptions({
    dragging: true,
    inertia: !L.Browser.android23,
    inertiaDeceleration: 3400,
    inertiaMaxSpeed: Infinity,
    inertiaThreshold: L.Browser.touch ? 32 : 18,
    easeLinearity: 0.25,
    worldCopyJump: false
  });
  L.Map.Drag = L.Handler.extend({
    addHooks: function() {
      if (!this._draggable) {
        var map = this._map;
        this._draggable = new L.Draggable(map._mapPane, map._container);
        this._draggable.on({
          'dragstart': this._onDragStart,
          'drag': this._onDrag,
          'dragend': this._onDragEnd
        }, this);
        if (map.options.worldCopyJump) {
          this._draggable.on('predrag', this._onPreDrag, this);
          map.on('viewreset', this._onViewReset, this);
          map.whenReady(this._onViewReset, this);
        }
      }
      this._draggable.enable();
    },
    removeHooks: function() {
      this._draggable.disable();
    },
    moved: function() {
      return this._draggable && this._draggable._moved;
    },
    _onDragStart: function() {
      var map = this._map;
      if (map._panAnim) {
        map._panAnim.stop();
      }
      map.fire('movestart').fire('dragstart');
      if (map.options.inertia) {
        this._positions = [];
        this._times = [];
      }
    },
    _onDrag: function() {
      if (this._map.options.inertia) {
        var time = this._lastTime = +new Date(),
            pos = this._lastPos = this._draggable._newPos;
        this._positions.push(pos);
        this._times.push(time);
        if (time - this._times[0] > 200) {
          this._positions.shift();
          this._times.shift();
        }
      }
      this._map.fire('move').fire('drag');
    },
    _onViewReset: function() {
      var pxCenter = this._map.getSize()._divideBy(2),
          pxWorldCenter = this._map.latLngToLayerPoint([0, 0]);
      this._initialWorldOffset = pxWorldCenter.subtract(pxCenter).x;
      this._worldWidth = this._map.project([0, 180]).x;
    },
    _onPreDrag: function() {
      var worldWidth = this._worldWidth,
          halfWidth = Math.round(worldWidth / 2),
          dx = this._initialWorldOffset,
          x = this._draggable._newPos.x,
          newX1 = (x - halfWidth + dx) % worldWidth + halfWidth - dx,
          newX2 = (x + halfWidth + dx) % worldWidth - halfWidth - dx,
          newX = Math.abs(newX1 + dx) < Math.abs(newX2 + dx) ? newX1 : newX2;
      this._draggable._newPos.x = newX;
    },
    _onDragEnd: function(e) {
      var map = this._map,
          options = map.options,
          delay = +new Date() - this._lastTime,
          noInertia = !options.inertia || delay > options.inertiaThreshold || !this._positions[0];
      map.fire('dragend', e);
      if (noInertia) {
        map.fire('moveend');
      } else {
        var direction = this._lastPos.subtract(this._positions[0]),
            duration = (this._lastTime + delay - this._times[0]) / 1000,
            ease = options.easeLinearity,
            speedVector = direction.multiplyBy(ease / duration),
            speed = speedVector.distanceTo([0, 0]),
            limitedSpeed = Math.min(options.inertiaMaxSpeed, speed),
            limitedSpeedVector = speedVector.multiplyBy(limitedSpeed / speed),
            decelerationDuration = limitedSpeed / (options.inertiaDeceleration * ease),
            offset = limitedSpeedVector.multiplyBy(-decelerationDuration / 2).round();
        if (!offset.x || !offset.y) {
          map.fire('moveend');
        } else {
          offset = map._limitOffset(offset, map.options.maxBounds);
          L.Util.requestAnimFrame(function() {
            map.panBy(offset, {
              duration: decelerationDuration,
              easeLinearity: ease,
              noMoveStart: true
            });
          });
        }
      }
    }
  });
  L.Map.addInitHook('addHandler', 'dragging', L.Map.Drag);
  L.Map.mergeOptions({doubleClickZoom: true});
  L.Map.DoubleClickZoom = L.Handler.extend({
    addHooks: function() {
      this._map.on('dblclick', this._onDoubleClick, this);
    },
    removeHooks: function() {
      this._map.off('dblclick', this._onDoubleClick, this);
    },
    _onDoubleClick: function(e) {
      var map = this._map,
          zoom = map.getZoom() + (e.originalEvent.shiftKey ? -1 : 1);
      if (map.options.doubleClickZoom === 'center') {
        map.setZoom(zoom);
      } else {
        map.setZoomAround(e.containerPoint, zoom);
      }
    }
  });
  L.Map.addInitHook('addHandler', 'doubleClickZoom', L.Map.DoubleClickZoom);
  L.Map.mergeOptions({scrollWheelZoom: true});
  L.Map.ScrollWheelZoom = L.Handler.extend({
    addHooks: function() {
      L.DomEvent.on(this._map._container, 'mousewheel', this._onWheelScroll, this);
      L.DomEvent.on(this._map._container, 'MozMousePixelScroll', L.DomEvent.preventDefault);
      this._delta = 0;
    },
    removeHooks: function() {
      L.DomEvent.off(this._map._container, 'mousewheel', this._onWheelScroll);
      L.DomEvent.off(this._map._container, 'MozMousePixelScroll', L.DomEvent.preventDefault);
    },
    _onWheelScroll: function(e) {
      var delta = L.DomEvent.getWheelDelta(e);
      this._delta += delta;
      this._lastMousePos = this._map.mouseEventToContainerPoint(e);
      if (!this._startTime) {
        this._startTime = +new Date();
      }
      var left = Math.max(40 - (+new Date() - this._startTime), 0);
      clearTimeout(this._timer);
      this._timer = setTimeout(L.bind(this._performZoom, this), left);
      L.DomEvent.preventDefault(e);
      L.DomEvent.stopPropagation(e);
    },
    _performZoom: function() {
      var map = this._map,
          delta = this._delta,
          zoom = map.getZoom();
      delta = delta > 0 ? Math.ceil(delta) : Math.floor(delta);
      delta = Math.max(Math.min(delta, 4), -4);
      delta = map._limitZoom(zoom + delta) - zoom;
      this._delta = 0;
      this._startTime = null;
      if (!delta) {
        return;
      }
      if (map.options.scrollWheelZoom === 'center') {
        map.setZoom(zoom + delta);
      } else {
        map.setZoomAround(this._lastMousePos, zoom + delta);
      }
    }
  });
  L.Map.addInitHook('addHandler', 'scrollWheelZoom', L.Map.ScrollWheelZoom);
  L.extend(L.DomEvent, {
    _touchstart: L.Browser.msPointer ? 'MSPointerDown' : L.Browser.pointer ? 'pointerdown' : 'touchstart',
    _touchend: L.Browser.msPointer ? 'MSPointerUp' : L.Browser.pointer ? 'pointerup' : 'touchend',
    addDoubleTapListener: function(obj, handler, id) {
      var last,
          doubleTap = false,
          delay = 250,
          touch,
          pre = '_leaflet_',
          touchstart = this._touchstart,
          touchend = this._touchend,
          trackedTouches = [];
      function onTouchStart(e) {
        var count;
        if (L.Browser.pointer) {
          trackedTouches.push(e.pointerId);
          count = trackedTouches.length;
        } else {
          count = e.touches.length;
        }
        if (count > 1) {
          return;
        }
        var now = Date.now(),
            delta = now - (last || now);
        touch = e.touches ? e.touches[0] : e;
        doubleTap = (delta > 0 && delta <= delay);
        last = now;
      }
      function onTouchEnd(e) {
        if (L.Browser.pointer) {
          var idx = trackedTouches.indexOf(e.pointerId);
          if (idx === -1) {
            return;
          }
          trackedTouches.splice(idx, 1);
        }
        if (doubleTap) {
          if (L.Browser.pointer) {
            var newTouch = {},
                prop;
            for (var i in touch) {
              prop = touch[i];
              if (typeof prop === 'function') {
                newTouch[i] = prop.bind(touch);
              } else {
                newTouch[i] = prop;
              }
            }
            touch = newTouch;
          }
          touch.type = 'dblclick';
          handler(touch);
          last = null;
        }
      }
      obj[pre + touchstart + id] = onTouchStart;
      obj[pre + touchend + id] = onTouchEnd;
      var endElement = L.Browser.pointer ? document.documentElement : obj;
      obj.addEventListener(touchstart, onTouchStart, false);
      endElement.addEventListener(touchend, onTouchEnd, false);
      if (L.Browser.pointer) {
        endElement.addEventListener(L.DomEvent.POINTER_CANCEL, onTouchEnd, false);
      }
      return this;
    },
    removeDoubleTapListener: function(obj, id) {
      var pre = '_leaflet_';
      obj.removeEventListener(this._touchstart, obj[pre + this._touchstart + id], false);
      (L.Browser.pointer ? document.documentElement : obj).removeEventListener(this._touchend, obj[pre + this._touchend + id], false);
      if (L.Browser.pointer) {
        document.documentElement.removeEventListener(L.DomEvent.POINTER_CANCEL, obj[pre + this._touchend + id], false);
      }
      return this;
    }
  });
  L.extend(L.DomEvent, {
    POINTER_DOWN: L.Browser.msPointer ? 'MSPointerDown' : 'pointerdown',
    POINTER_MOVE: L.Browser.msPointer ? 'MSPointerMove' : 'pointermove',
    POINTER_UP: L.Browser.msPointer ? 'MSPointerUp' : 'pointerup',
    POINTER_CANCEL: L.Browser.msPointer ? 'MSPointerCancel' : 'pointercancel',
    _pointers: [],
    _pointerDocumentListener: false,
    addPointerListener: function(obj, type, handler, id) {
      switch (type) {
        case 'touchstart':
          return this.addPointerListenerStart(obj, type, handler, id);
        case 'touchend':
          return this.addPointerListenerEnd(obj, type, handler, id);
        case 'touchmove':
          return this.addPointerListenerMove(obj, type, handler, id);
        default:
          throw 'Unknown touch event type';
      }
    },
    addPointerListenerStart: function(obj, type, handler, id) {
      var pre = '_leaflet_',
          pointers = this._pointers;
      var cb = function(e) {
        if (e.pointerType !== 'mouse' && e.pointerType !== e.MSPOINTER_TYPE_MOUSE) {
          L.DomEvent.preventDefault(e);
        }
        var alreadyInArray = false;
        for (var i = 0; i < pointers.length; i++) {
          if (pointers[i].pointerId === e.pointerId) {
            alreadyInArray = true;
            break;
          }
        }
        if (!alreadyInArray) {
          pointers.push(e);
        }
        e.touches = pointers.slice();
        e.changedTouches = [e];
        handler(e);
      };
      obj[pre + 'touchstart' + id] = cb;
      obj.addEventListener(this.POINTER_DOWN, cb, false);
      if (!this._pointerDocumentListener) {
        var internalCb = function(e) {
          for (var i = 0; i < pointers.length; i++) {
            if (pointers[i].pointerId === e.pointerId) {
              pointers.splice(i, 1);
              break;
            }
          }
        };
        document.documentElement.addEventListener(this.POINTER_UP, internalCb, false);
        document.documentElement.addEventListener(this.POINTER_CANCEL, internalCb, false);
        this._pointerDocumentListener = true;
      }
      return this;
    },
    addPointerListenerMove: function(obj, type, handler, id) {
      var pre = '_leaflet_',
          touches = this._pointers;
      function cb(e) {
        if ((e.pointerType === e.MSPOINTER_TYPE_MOUSE || e.pointerType === 'mouse') && e.buttons === 0) {
          return;
        }
        for (var i = 0; i < touches.length; i++) {
          if (touches[i].pointerId === e.pointerId) {
            touches[i] = e;
            break;
          }
        }
        e.touches = touches.slice();
        e.changedTouches = [e];
        handler(e);
      }
      obj[pre + 'touchmove' + id] = cb;
      obj.addEventListener(this.POINTER_MOVE, cb, false);
      return this;
    },
    addPointerListenerEnd: function(obj, type, handler, id) {
      var pre = '_leaflet_',
          touches = this._pointers;
      var cb = function(e) {
        for (var i = 0; i < touches.length; i++) {
          if (touches[i].pointerId === e.pointerId) {
            touches.splice(i, 1);
            break;
          }
        }
        e.touches = touches.slice();
        e.changedTouches = [e];
        handler(e);
      };
      obj[pre + 'touchend' + id] = cb;
      obj.addEventListener(this.POINTER_UP, cb, false);
      obj.addEventListener(this.POINTER_CANCEL, cb, false);
      return this;
    },
    removePointerListener: function(obj, type, id) {
      var pre = '_leaflet_',
          cb = obj[pre + type + id];
      switch (type) {
        case 'touchstart':
          obj.removeEventListener(this.POINTER_DOWN, cb, false);
          break;
        case 'touchmove':
          obj.removeEventListener(this.POINTER_MOVE, cb, false);
          break;
        case 'touchend':
          obj.removeEventListener(this.POINTER_UP, cb, false);
          obj.removeEventListener(this.POINTER_CANCEL, cb, false);
          break;
      }
      return this;
    }
  });
  L.Map.mergeOptions({
    touchZoom: L.Browser.touch && !L.Browser.android23,
    bounceAtZoomLimits: true
  });
  L.Map.TouchZoom = L.Handler.extend({
    addHooks: function() {
      L.DomEvent.on(this._map._container, 'touchstart', this._onTouchStart, this);
    },
    removeHooks: function() {
      L.DomEvent.off(this._map._container, 'touchstart', this._onTouchStart, this);
    },
    _onTouchStart: function(e) {
      var map = this._map;
      if (!e.touches || e.touches.length !== 2 || map._animatingZoom || this._zooming) {
        return;
      }
      var p1 = map.mouseEventToLayerPoint(e.touches[0]),
          p2 = map.mouseEventToLayerPoint(e.touches[1]),
          viewCenter = map._getCenterLayerPoint();
      this._startCenter = p1.add(p2)._divideBy(2);
      this._startDist = p1.distanceTo(p2);
      this._moved = false;
      this._zooming = true;
      this._centerOffset = viewCenter.subtract(this._startCenter);
      if (map._panAnim) {
        map._panAnim.stop();
      }
      L.DomEvent.on(document, 'touchmove', this._onTouchMove, this).on(document, 'touchend', this._onTouchEnd, this);
      L.DomEvent.preventDefault(e);
    },
    _onTouchMove: function(e) {
      var map = this._map;
      if (!e.touches || e.touches.length !== 2 || !this._zooming) {
        return;
      }
      var p1 = map.mouseEventToLayerPoint(e.touches[0]),
          p2 = map.mouseEventToLayerPoint(e.touches[1]);
      this._scale = p1.distanceTo(p2) / this._startDist;
      this._delta = p1._add(p2)._divideBy(2)._subtract(this._startCenter);
      if (this._scale === 1) {
        return;
      }
      if (!map.options.bounceAtZoomLimits) {
        if ((map.getZoom() === map.getMinZoom() && this._scale < 1) || (map.getZoom() === map.getMaxZoom() && this._scale > 1)) {
          return;
        }
      }
      if (!this._moved) {
        L.DomUtil.addClass(map._mapPane, 'leaflet-touching');
        map.fire('movestart').fire('zoomstart');
        this._moved = true;
      }
      L.Util.cancelAnimFrame(this._animRequest);
      this._animRequest = L.Util.requestAnimFrame(this._updateOnMove, this, true, this._map._container);
      L.DomEvent.preventDefault(e);
    },
    _updateOnMove: function() {
      var map = this._map,
          origin = this._getScaleOrigin(),
          center = map.layerPointToLatLng(origin),
          zoom = map.getScaleZoom(this._scale);
      map._animateZoom(center, zoom, this._startCenter, this._scale, this._delta, false, true);
    },
    _onTouchEnd: function() {
      if (!this._moved || !this._zooming) {
        this._zooming = false;
        return;
      }
      var map = this._map;
      this._zooming = false;
      L.DomUtil.removeClass(map._mapPane, 'leaflet-touching');
      L.Util.cancelAnimFrame(this._animRequest);
      L.DomEvent.off(document, 'touchmove', this._onTouchMove).off(document, 'touchend', this._onTouchEnd);
      var origin = this._getScaleOrigin(),
          center = map.layerPointToLatLng(origin),
          oldZoom = map.getZoom(),
          floatZoomDelta = map.getScaleZoom(this._scale) - oldZoom,
          roundZoomDelta = (floatZoomDelta > 0 ? Math.ceil(floatZoomDelta) : Math.floor(floatZoomDelta)),
          zoom = map._limitZoom(oldZoom + roundZoomDelta),
          scale = map.getZoomScale(zoom) / this._scale;
      map._animateZoom(center, zoom, origin, scale);
    },
    _getScaleOrigin: function() {
      var centerOffset = this._centerOffset.subtract(this._delta).divideBy(this._scale);
      return this._startCenter.add(centerOffset);
    }
  });
  L.Map.addInitHook('addHandler', 'touchZoom', L.Map.TouchZoom);
  L.Map.mergeOptions({
    tap: true,
    tapTolerance: 15
  });
  L.Map.Tap = L.Handler.extend({
    addHooks: function() {
      L.DomEvent.on(this._map._container, 'touchstart', this._onDown, this);
    },
    removeHooks: function() {
      L.DomEvent.off(this._map._container, 'touchstart', this._onDown, this);
    },
    _onDown: function(e) {
      if (!e.touches) {
        return;
      }
      L.DomEvent.preventDefault(e);
      this._fireClick = true;
      if (e.touches.length > 1) {
        this._fireClick = false;
        clearTimeout(this._holdTimeout);
        return;
      }
      var first = e.touches[0],
          el = first.target;
      this._startPos = this._newPos = new L.Point(first.clientX, first.clientY);
      if (el.tagName && el.tagName.toLowerCase() === 'a') {
        L.DomUtil.addClass(el, 'leaflet-active');
      }
      this._holdTimeout = setTimeout(L.bind(function() {
        if (this._isTapValid()) {
          this._fireClick = false;
          this._onUp();
          this._simulateEvent('contextmenu', first);
        }
      }, this), 1000);
      L.DomEvent.on(document, 'touchmove', this._onMove, this).on(document, 'touchend', this._onUp, this);
    },
    _onUp: function(e) {
      clearTimeout(this._holdTimeout);
      L.DomEvent.off(document, 'touchmove', this._onMove, this).off(document, 'touchend', this._onUp, this);
      if (this._fireClick && e && e.changedTouches) {
        var first = e.changedTouches[0],
            el = first.target;
        if (el && el.tagName && el.tagName.toLowerCase() === 'a') {
          L.DomUtil.removeClass(el, 'leaflet-active');
        }
        if (this._isTapValid()) {
          this._simulateEvent('click', first);
        }
      }
    },
    _isTapValid: function() {
      return this._newPos.distanceTo(this._startPos) <= this._map.options.tapTolerance;
    },
    _onMove: function(e) {
      var first = e.touches[0];
      this._newPos = new L.Point(first.clientX, first.clientY);
    },
    _simulateEvent: function(type, e) {
      var simulatedEvent = document.createEvent('MouseEvents');
      simulatedEvent._simulated = true;
      e.target._simulatedClick = true;
      simulatedEvent.initMouseEvent(type, true, true, window, 1, e.screenX, e.screenY, e.clientX, e.clientY, false, false, false, false, 0, null);
      e.target.dispatchEvent(simulatedEvent);
    }
  });
  if (L.Browser.touch && !L.Browser.pointer) {
    L.Map.addInitHook('addHandler', 'tap', L.Map.Tap);
  }
  L.Map.mergeOptions({boxZoom: true});
  L.Map.BoxZoom = L.Handler.extend({
    initialize: function(map) {
      this._map = map;
      this._container = map._container;
      this._pane = map._panes.overlayPane;
      this._moved = false;
    },
    addHooks: function() {
      L.DomEvent.on(this._container, 'mousedown', this._onMouseDown, this);
    },
    removeHooks: function() {
      L.DomEvent.off(this._container, 'mousedown', this._onMouseDown);
      this._moved = false;
    },
    moved: function() {
      return this._moved;
    },
    _onMouseDown: function(e) {
      this._moved = false;
      if (!e.shiftKey || ((e.which !== 1) && (e.button !== 1))) {
        return false;
      }
      L.DomUtil.disableTextSelection();
      L.DomUtil.disableImageDrag();
      this._startLayerPoint = this._map.mouseEventToLayerPoint(e);
      L.DomEvent.on(document, 'mousemove', this._onMouseMove, this).on(document, 'mouseup', this._onMouseUp, this).on(document, 'keydown', this._onKeyDown, this);
    },
    _onMouseMove: function(e) {
      if (!this._moved) {
        this._box = L.DomUtil.create('div', 'leaflet-zoom-box', this._pane);
        L.DomUtil.setPosition(this._box, this._startLayerPoint);
        this._container.style.cursor = 'crosshair';
        this._map.fire('boxzoomstart');
      }
      var startPoint = this._startLayerPoint,
          box = this._box,
          layerPoint = this._map.mouseEventToLayerPoint(e),
          offset = layerPoint.subtract(startPoint),
          newPos = new L.Point(Math.min(layerPoint.x, startPoint.x), Math.min(layerPoint.y, startPoint.y));
      L.DomUtil.setPosition(box, newPos);
      this._moved = true;
      box.style.width = (Math.max(0, Math.abs(offset.x) - 4)) + 'px';
      box.style.height = (Math.max(0, Math.abs(offset.y) - 4)) + 'px';
    },
    _finish: function() {
      if (this._moved) {
        this._pane.removeChild(this._box);
        this._container.style.cursor = '';
      }
      L.DomUtil.enableTextSelection();
      L.DomUtil.enableImageDrag();
      L.DomEvent.off(document, 'mousemove', this._onMouseMove).off(document, 'mouseup', this._onMouseUp).off(document, 'keydown', this._onKeyDown);
    },
    _onMouseUp: function(e) {
      this._finish();
      var map = this._map,
          layerPoint = map.mouseEventToLayerPoint(e);
      if (this._startLayerPoint.equals(layerPoint)) {
        return;
      }
      var bounds = new L.LatLngBounds(map.layerPointToLatLng(this._startLayerPoint), map.layerPointToLatLng(layerPoint));
      map.fitBounds(bounds);
      map.fire('boxzoomend', {boxZoomBounds: bounds});
    },
    _onKeyDown: function(e) {
      if (e.keyCode === 27) {
        this._finish();
      }
    }
  });
  L.Map.addInitHook('addHandler', 'boxZoom', L.Map.BoxZoom);
  L.Map.mergeOptions({
    keyboard: true,
    keyboardPanOffset: 80,
    keyboardZoomOffset: 1
  });
  L.Map.Keyboard = L.Handler.extend({
    keyCodes: {
      left: [37],
      right: [39],
      down: [40],
      up: [38],
      zoomIn: [187, 107, 61, 171],
      zoomOut: [189, 109, 173]
    },
    initialize: function(map) {
      this._map = map;
      this._setPanOffset(map.options.keyboardPanOffset);
      this._setZoomOffset(map.options.keyboardZoomOffset);
    },
    addHooks: function() {
      var container = this._map._container;
      if (container.tabIndex === -1) {
        container.tabIndex = '0';
      }
      L.DomEvent.on(container, 'focus', this._onFocus, this).on(container, 'blur', this._onBlur, this).on(container, 'mousedown', this._onMouseDown, this);
      this._map.on('focus', this._addHooks, this).on('blur', this._removeHooks, this);
    },
    removeHooks: function() {
      this._removeHooks();
      var container = this._map._container;
      L.DomEvent.off(container, 'focus', this._onFocus, this).off(container, 'blur', this._onBlur, this).off(container, 'mousedown', this._onMouseDown, this);
      this._map.off('focus', this._addHooks, this).off('blur', this._removeHooks, this);
    },
    _onMouseDown: function() {
      if (this._focused) {
        return;
      }
      var body = document.body,
          docEl = document.documentElement,
          top = body.scrollTop || docEl.scrollTop,
          left = body.scrollLeft || docEl.scrollLeft;
      this._map._container.focus();
      window.scrollTo(left, top);
    },
    _onFocus: function() {
      this._focused = true;
      this._map.fire('focus');
    },
    _onBlur: function() {
      this._focused = false;
      this._map.fire('blur');
    },
    _setPanOffset: function(pan) {
      var keys = this._panKeys = {},
          codes = this.keyCodes,
          i,
          len;
      for (i = 0, len = codes.left.length; i < len; i++) {
        keys[codes.left[i]] = [-1 * pan, 0];
      }
      for (i = 0, len = codes.right.length; i < len; i++) {
        keys[codes.right[i]] = [pan, 0];
      }
      for (i = 0, len = codes.down.length; i < len; i++) {
        keys[codes.down[i]] = [0, pan];
      }
      for (i = 0, len = codes.up.length; i < len; i++) {
        keys[codes.up[i]] = [0, -1 * pan];
      }
    },
    _setZoomOffset: function(zoom) {
      var keys = this._zoomKeys = {},
          codes = this.keyCodes,
          i,
          len;
      for (i = 0, len = codes.zoomIn.length; i < len; i++) {
        keys[codes.zoomIn[i]] = zoom;
      }
      for (i = 0, len = codes.zoomOut.length; i < len; i++) {
        keys[codes.zoomOut[i]] = -zoom;
      }
    },
    _addHooks: function() {
      L.DomEvent.on(document, 'keydown', this._onKeyDown, this);
    },
    _removeHooks: function() {
      L.DomEvent.off(document, 'keydown', this._onKeyDown, this);
    },
    _onKeyDown: function(e) {
      var key = e.keyCode,
          map = this._map;
      if (key in this._panKeys) {
        if (map._panAnim && map._panAnim._inProgress) {
          return;
        }
        map.panBy(this._panKeys[key]);
        if (map.options.maxBounds) {
          map.panInsideBounds(map.options.maxBounds);
        }
      } else if (key in this._zoomKeys) {
        map.setZoom(map.getZoom() + this._zoomKeys[key]);
      } else {
        return;
      }
      L.DomEvent.stop(e);
    }
  });
  L.Map.addInitHook('addHandler', 'keyboard', L.Map.Keyboard);
  L.Handler.MarkerDrag = L.Handler.extend({
    initialize: function(marker) {
      this._marker = marker;
    },
    addHooks: function() {
      var icon = this._marker._icon;
      if (!this._draggable) {
        this._draggable = new L.Draggable(icon, icon);
      }
      this._draggable.on('dragstart', this._onDragStart, this).on('drag', this._onDrag, this).on('dragend', this._onDragEnd, this);
      this._draggable.enable();
      L.DomUtil.addClass(this._marker._icon, 'leaflet-marker-draggable');
    },
    removeHooks: function() {
      this._draggable.off('dragstart', this._onDragStart, this).off('drag', this._onDrag, this).off('dragend', this._onDragEnd, this);
      this._draggable.disable();
      L.DomUtil.removeClass(this._marker._icon, 'leaflet-marker-draggable');
    },
    moved: function() {
      return this._draggable && this._draggable._moved;
    },
    _onDragStart: function() {
      this._marker.closePopup().fire('movestart').fire('dragstart');
    },
    _onDrag: function() {
      var marker = this._marker,
          shadow = marker._shadow,
          iconPos = L.DomUtil.getPosition(marker._icon),
          latlng = marker._map.layerPointToLatLng(iconPos);
      if (shadow) {
        L.DomUtil.setPosition(shadow, iconPos);
      }
      marker._latlng = latlng;
      marker.fire('move', {latlng: latlng}).fire('drag');
    },
    _onDragEnd: function(e) {
      this._marker.fire('moveend').fire('dragend', e);
    }
  });
  L.Control = L.Class.extend({
    options: {position: 'topright'},
    initialize: function(options) {
      L.setOptions(this, options);
    },
    getPosition: function() {
      return this.options.position;
    },
    setPosition: function(position) {
      var map = this._map;
      if (map) {
        map.removeControl(this);
      }
      this.options.position = position;
      if (map) {
        map.addControl(this);
      }
      return this;
    },
    getContainer: function() {
      return this._container;
    },
    addTo: function(map) {
      this._map = map;
      var container = this._container = this.onAdd(map),
          pos = this.getPosition(),
          corner = map._controlCorners[pos];
      L.DomUtil.addClass(container, 'leaflet-control');
      if (pos.indexOf('bottom') !== -1) {
        corner.insertBefore(container, corner.firstChild);
      } else {
        corner.appendChild(container);
      }
      return this;
    },
    removeFrom: function(map) {
      var pos = this.getPosition(),
          corner = map._controlCorners[pos];
      corner.removeChild(this._container);
      this._map = null;
      if (this.onRemove) {
        this.onRemove(map);
      }
      return this;
    },
    _refocusOnMap: function() {
      if (this._map) {
        this._map.getContainer().focus();
      }
    }
  });
  L.control = function(options) {
    return new L.Control(options);
  };
  L.Map.include({
    addControl: function(control) {
      control.addTo(this);
      return this;
    },
    removeControl: function(control) {
      control.removeFrom(this);
      return this;
    },
    _initControlPos: function() {
      var corners = this._controlCorners = {},
          l = 'leaflet-',
          container = this._controlContainer = L.DomUtil.create('div', l + 'control-container', this._container);
      function createCorner(vSide, hSide) {
        var className = l + vSide + ' ' + l + hSide;
        corners[vSide + hSide] = L.DomUtil.create('div', className, container);
      }
      createCorner('top', 'left');
      createCorner('top', 'right');
      createCorner('bottom', 'left');
      createCorner('bottom', 'right');
    },
    _clearControlPos: function() {
      this._container.removeChild(this._controlContainer);
    }
  });
  L.Control.Zoom = L.Control.extend({
    options: {
      position: 'topleft',
      zoomInText: '+',
      zoomInTitle: 'Zoom in',
      zoomOutText: '-',
      zoomOutTitle: 'Zoom out'
    },
    onAdd: function(map) {
      var zoomName = 'leaflet-control-zoom',
          container = L.DomUtil.create('div', zoomName + ' leaflet-bar');
      this._map = map;
      this._zoomInButton = this._createButton(this.options.zoomInText, this.options.zoomInTitle, zoomName + '-in', container, this._zoomIn, this);
      this._zoomOutButton = this._createButton(this.options.zoomOutText, this.options.zoomOutTitle, zoomName + '-out', container, this._zoomOut, this);
      this._updateDisabled();
      map.on('zoomend zoomlevelschange', this._updateDisabled, this);
      return container;
    },
    onRemove: function(map) {
      map.off('zoomend zoomlevelschange', this._updateDisabled, this);
    },
    _zoomIn: function(e) {
      this._map.zoomIn(e.shiftKey ? 3 : 1);
    },
    _zoomOut: function(e) {
      this._map.zoomOut(e.shiftKey ? 3 : 1);
    },
    _createButton: function(html, title, className, container, fn, context) {
      var link = L.DomUtil.create('a', className, container);
      link.innerHTML = html;
      link.href = '#';
      link.title = title;
      var stop = L.DomEvent.stopPropagation;
      L.DomEvent.on(link, 'click', stop).on(link, 'mousedown', stop).on(link, 'dblclick', stop).on(link, 'click', L.DomEvent.preventDefault).on(link, 'click', fn, context).on(link, 'click', this._refocusOnMap, context);
      return link;
    },
    _updateDisabled: function() {
      var map = this._map,
          className = 'leaflet-disabled';
      L.DomUtil.removeClass(this._zoomInButton, className);
      L.DomUtil.removeClass(this._zoomOutButton, className);
      if (map._zoom === map.getMinZoom()) {
        L.DomUtil.addClass(this._zoomOutButton, className);
      }
      if (map._zoom === map.getMaxZoom()) {
        L.DomUtil.addClass(this._zoomInButton, className);
      }
    }
  });
  L.Map.mergeOptions({zoomControl: true});
  L.Map.addInitHook(function() {
    if (this.options.zoomControl) {
      this.zoomControl = new L.Control.Zoom();
      this.addControl(this.zoomControl);
    }
  });
  L.control.zoom = function(options) {
    return new L.Control.Zoom(options);
  };
  L.Control.Attribution = L.Control.extend({
    options: {
      position: 'bottomright',
      prefix: '<a href="http://leafletjs.com" title="A JS library for interactive maps">Leaflet</a>'
    },
    initialize: function(options) {
      L.setOptions(this, options);
      this._attributions = {};
    },
    onAdd: function(map) {
      this._container = L.DomUtil.create('div', 'leaflet-control-attribution');
      L.DomEvent.disableClickPropagation(this._container);
      for (var i in map._layers) {
        if (map._layers[i].getAttribution) {
          this.addAttribution(map._layers[i].getAttribution());
        }
      }
      map.on('layeradd', this._onLayerAdd, this).on('layerremove', this._onLayerRemove, this);
      this._update();
      return this._container;
    },
    onRemove: function(map) {
      map.off('layeradd', this._onLayerAdd).off('layerremove', this._onLayerRemove);
    },
    setPrefix: function(prefix) {
      this.options.prefix = prefix;
      this._update();
      return this;
    },
    addAttribution: function(text) {
      if (!text) {
        return;
      }
      if (!this._attributions[text]) {
        this._attributions[text] = 0;
      }
      this._attributions[text]++;
      this._update();
      return this;
    },
    removeAttribution: function(text) {
      if (!text) {
        return;
      }
      if (this._attributions[text]) {
        this._attributions[text]--;
        this._update();
      }
      return this;
    },
    _update: function() {
      if (!this._map) {
        return;
      }
      var attribs = [];
      for (var i in this._attributions) {
        if (this._attributions[i]) {
          attribs.push(i);
        }
      }
      var prefixAndAttribs = [];
      if (this.options.prefix) {
        prefixAndAttribs.push(this.options.prefix);
      }
      if (attribs.length) {
        prefixAndAttribs.push(attribs.join(', '));
      }
      this._container.innerHTML = prefixAndAttribs.join(' | ');
    },
    _onLayerAdd: function(e) {
      if (e.layer.getAttribution) {
        this.addAttribution(e.layer.getAttribution());
      }
    },
    _onLayerRemove: function(e) {
      if (e.layer.getAttribution) {
        this.removeAttribution(e.layer.getAttribution());
      }
    }
  });
  L.Map.mergeOptions({attributionControl: true});
  L.Map.addInitHook(function() {
    if (this.options.attributionControl) {
      this.attributionControl = (new L.Control.Attribution()).addTo(this);
    }
  });
  L.control.attribution = function(options) {
    return new L.Control.Attribution(options);
  };
  L.Control.Scale = L.Control.extend({
    options: {
      position: 'bottomleft',
      maxWidth: 100,
      metric: true,
      imperial: true,
      updateWhenIdle: false
    },
    onAdd: function(map) {
      this._map = map;
      var className = 'leaflet-control-scale',
          container = L.DomUtil.create('div', className),
          options = this.options;
      this._addScales(options, className, container);
      map.on(options.updateWhenIdle ? 'moveend' : 'move', this._update, this);
      map.whenReady(this._update, this);
      return container;
    },
    onRemove: function(map) {
      map.off(this.options.updateWhenIdle ? 'moveend' : 'move', this._update, this);
    },
    _addScales: function(options, className, container) {
      if (options.metric) {
        this._mScale = L.DomUtil.create('div', className + '-line', container);
      }
      if (options.imperial) {
        this._iScale = L.DomUtil.create('div', className + '-line', container);
      }
    },
    _update: function() {
      var bounds = this._map.getBounds(),
          centerLat = bounds.getCenter().lat,
          halfWorldMeters = 6378137 * Math.PI * Math.cos(centerLat * Math.PI / 180),
          dist = halfWorldMeters * (bounds.getNorthEast().lng - bounds.getSouthWest().lng) / 180,
          size = this._map.getSize(),
          options = this.options,
          maxMeters = 0;
      if (size.x > 0) {
        maxMeters = dist * (options.maxWidth / size.x);
      }
      this._updateScales(options, maxMeters);
    },
    _updateScales: function(options, maxMeters) {
      if (options.metric && maxMeters) {
        this._updateMetric(maxMeters);
      }
      if (options.imperial && maxMeters) {
        this._updateImperial(maxMeters);
      }
    },
    _updateMetric: function(maxMeters) {
      var meters = this._getRoundNum(maxMeters);
      this._mScale.style.width = this._getScaleWidth(meters / maxMeters) + 'px';
      this._mScale.innerHTML = meters < 1000 ? meters + ' m' : (meters / 1000) + ' km';
    },
    _updateImperial: function(maxMeters) {
      var maxFeet = maxMeters * 3.2808399,
          scale = this._iScale,
          maxMiles,
          miles,
          feet;
      if (maxFeet > 5280) {
        maxMiles = maxFeet / 5280;
        miles = this._getRoundNum(maxMiles);
        scale.style.width = this._getScaleWidth(miles / maxMiles) + 'px';
        scale.innerHTML = miles + ' mi';
      } else {
        feet = this._getRoundNum(maxFeet);
        scale.style.width = this._getScaleWidth(feet / maxFeet) + 'px';
        scale.innerHTML = feet + ' ft';
      }
    },
    _getScaleWidth: function(ratio) {
      return Math.round(this.options.maxWidth * ratio) - 10;
    },
    _getRoundNum: function(num) {
      var pow10 = Math.pow(10, (Math.floor(num) + '').length - 1),
          d = num / pow10;
      d = d >= 10 ? 10 : d >= 5 ? 5 : d >= 3 ? 3 : d >= 2 ? 2 : 1;
      return pow10 * d;
    }
  });
  L.control.scale = function(options) {
    return new L.Control.Scale(options);
  };
  L.Control.Layers = L.Control.extend({
    options: {
      collapsed: true,
      position: 'topright',
      autoZIndex: true
    },
    initialize: function(baseLayers, overlays, options) {
      L.setOptions(this, options);
      this._layers = {};
      this._lastZIndex = 0;
      this._handlingClick = false;
      for (var i in baseLayers) {
        this._addLayer(baseLayers[i], i);
      }
      for (i in overlays) {
        this._addLayer(overlays[i], i, true);
      }
    },
    onAdd: function(map) {
      this._initLayout();
      this._update();
      map.on('layeradd', this._onLayerChange, this).on('layerremove', this._onLayerChange, this);
      return this._container;
    },
    onRemove: function(map) {
      map.off('layeradd', this._onLayerChange, this).off('layerremove', this._onLayerChange, this);
    },
    addBaseLayer: function(layer, name) {
      this._addLayer(layer, name);
      this._update();
      return this;
    },
    addOverlay: function(layer, name) {
      this._addLayer(layer, name, true);
      this._update();
      return this;
    },
    removeLayer: function(layer) {
      var id = L.stamp(layer);
      delete this._layers[id];
      this._update();
      return this;
    },
    _initLayout: function() {
      var className = 'leaflet-control-layers',
          container = this._container = L.DomUtil.create('div', className);
      container.setAttribute('aria-haspopup', true);
      if (!L.Browser.touch) {
        L.DomEvent.disableClickPropagation(container).disableScrollPropagation(container);
      } else {
        L.DomEvent.on(container, 'click', L.DomEvent.stopPropagation);
      }
      var form = this._form = L.DomUtil.create('form', className + '-list');
      if (this.options.collapsed) {
        if (!L.Browser.android) {
          L.DomEvent.on(container, 'mouseover', this._expand, this).on(container, 'mouseout', this._collapse, this);
        }
        var link = this._layersLink = L.DomUtil.create('a', className + '-toggle', container);
        link.href = '#';
        link.title = 'Layers';
        if (L.Browser.touch) {
          L.DomEvent.on(link, 'click', L.DomEvent.stop).on(link, 'click', this._expand, this);
        } else {
          L.DomEvent.on(link, 'focus', this._expand, this);
        }
        L.DomEvent.on(form, 'click', function() {
          setTimeout(L.bind(this._onInputClick, this), 0);
        }, this);
        this._map.on('click', this._collapse, this);
      } else {
        this._expand();
      }
      this._baseLayersList = L.DomUtil.create('div', className + '-base', form);
      this._separator = L.DomUtil.create('div', className + '-separator', form);
      this._overlaysList = L.DomUtil.create('div', className + '-overlays', form);
      container.appendChild(form);
    },
    _addLayer: function(layer, name, overlay) {
      var id = L.stamp(layer);
      this._layers[id] = {
        layer: layer,
        name: name,
        overlay: overlay
      };
      if (this.options.autoZIndex && layer.setZIndex) {
        this._lastZIndex++;
        layer.setZIndex(this._lastZIndex);
      }
    },
    _update: function() {
      if (!this._container) {
        return;
      }
      this._baseLayersList.innerHTML = '';
      this._overlaysList.innerHTML = '';
      var baseLayersPresent = false,
          overlaysPresent = false,
          i,
          obj;
      for (i in this._layers) {
        obj = this._layers[i];
        this._addItem(obj);
        overlaysPresent = overlaysPresent || obj.overlay;
        baseLayersPresent = baseLayersPresent || !obj.overlay;
      }
      this._separator.style.display = overlaysPresent && baseLayersPresent ? '' : 'none';
    },
    _onLayerChange: function(e) {
      var obj = this._layers[L.stamp(e.layer)];
      if (!obj) {
        return;
      }
      if (!this._handlingClick) {
        this._update();
      }
      var type = obj.overlay ? (e.type === 'layeradd' ? 'overlayadd' : 'overlayremove') : (e.type === 'layeradd' ? 'baselayerchange' : null);
      if (type) {
        this._map.fire(type, obj);
      }
    },
    _createRadioElement: function(name, checked) {
      var radioHtml = '<input type="radio" class="leaflet-control-layers-selector" name="' + name + '"';
      if (checked) {
        radioHtml += ' checked="checked"';
      }
      radioHtml += '/>';
      var radioFragment = document.createElement('div');
      radioFragment.innerHTML = radioHtml;
      return radioFragment.firstChild;
    },
    _addItem: function(obj) {
      var label = document.createElement('label'),
          input,
          checked = this._map.hasLayer(obj.layer);
      if (obj.overlay) {
        input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'leaflet-control-layers-selector';
        input.defaultChecked = checked;
      } else {
        input = this._createRadioElement('leaflet-base-layers', checked);
      }
      input.layerId = L.stamp(obj.layer);
      L.DomEvent.on(input, 'click', this._onInputClick, this);
      var name = document.createElement('span');
      name.innerHTML = ' ' + obj.name;
      label.appendChild(input);
      label.appendChild(name);
      var container = obj.overlay ? this._overlaysList : this._baseLayersList;
      container.appendChild(label);
      return label;
    },
    _onInputClick: function() {
      var i,
          input,
          obj,
          inputs = this._form.getElementsByTagName('input'),
          inputsLen = inputs.length;
      this._handlingClick = true;
      for (i = 0; i < inputsLen; i++) {
        input = inputs[i];
        obj = this._layers[input.layerId];
        if (input.checked && !this._map.hasLayer(obj.layer)) {
          this._map.addLayer(obj.layer);
        } else if (!input.checked && this._map.hasLayer(obj.layer)) {
          this._map.removeLayer(obj.layer);
        }
      }
      this._handlingClick = false;
      this._refocusOnMap();
    },
    _expand: function() {
      L.DomUtil.addClass(this._container, 'leaflet-control-layers-expanded');
    },
    _collapse: function() {
      this._container.className = this._container.className.replace(' leaflet-control-layers-expanded', '');
    }
  });
  L.control.layers = function(baseLayers, overlays, options) {
    return new L.Control.Layers(baseLayers, overlays, options);
  };
  L.PosAnimation = L.Class.extend({
    includes: L.Mixin.Events,
    run: function(el, newPos, duration, easeLinearity) {
      this.stop();
      this._el = el;
      this._inProgress = true;
      this._newPos = newPos;
      this.fire('start');
      el.style[L.DomUtil.TRANSITION] = 'all ' + (duration || 0.25) + 's cubic-bezier(0,0,' + (easeLinearity || 0.5) + ',1)';
      L.DomEvent.on(el, L.DomUtil.TRANSITION_END, this._onTransitionEnd, this);
      L.DomUtil.setPosition(el, newPos);
      L.Util.falseFn(el.offsetWidth);
      this._stepTimer = setInterval(L.bind(this._onStep, this), 50);
    },
    stop: function() {
      if (!this._inProgress) {
        return;
      }
      L.DomUtil.setPosition(this._el, this._getPos());
      this._onTransitionEnd();
      L.Util.falseFn(this._el.offsetWidth);
    },
    _onStep: function() {
      var stepPos = this._getPos();
      if (!stepPos) {
        this._onTransitionEnd();
        return;
      }
      this._el._leaflet_pos = stepPos;
      this.fire('step');
    },
    _transformRe: /([-+]?(?:\d*\.)?\d+)\D*, ([-+]?(?:\d*\.)?\d+)\D*\)/,
    _getPos: function() {
      var left,
          top,
          matches,
          el = this._el,
          style = window.getComputedStyle(el);
      if (L.Browser.any3d) {
        matches = style[L.DomUtil.TRANSFORM].match(this._transformRe);
        if (!matches) {
          return;
        }
        left = parseFloat(matches[1]);
        top = parseFloat(matches[2]);
      } else {
        left = parseFloat(style.left);
        top = parseFloat(style.top);
      }
      return new L.Point(left, top, true);
    },
    _onTransitionEnd: function() {
      L.DomEvent.off(this._el, L.DomUtil.TRANSITION_END, this._onTransitionEnd, this);
      if (!this._inProgress) {
        return;
      }
      this._inProgress = false;
      this._el.style[L.DomUtil.TRANSITION] = '';
      this._el._leaflet_pos = this._newPos;
      clearInterval(this._stepTimer);
      this.fire('step').fire('end');
    }
  });
  L.Map.include({
    setView: function(center, zoom, options) {
      zoom = zoom === undefined ? this._zoom : this._limitZoom(zoom);
      center = this._limitCenter(L.latLng(center), zoom, this.options.maxBounds);
      options = options || {};
      if (this._panAnim) {
        this._panAnim.stop();
      }
      if (this._loaded && !options.reset && options !== true) {
        if (options.animate !== undefined) {
          options.zoom = L.extend({animate: options.animate}, options.zoom);
          options.pan = L.extend({animate: options.animate}, options.pan);
        }
        var animated = (this._zoom !== zoom) ? this._tryAnimatedZoom && this._tryAnimatedZoom(center, zoom, options.zoom) : this._tryAnimatedPan(center, options.pan);
        if (animated) {
          clearTimeout(this._sizeTimer);
          return this;
        }
      }
      this._resetView(center, zoom);
      return this;
    },
    panBy: function(offset, options) {
      offset = L.point(offset).round();
      options = options || {};
      if (!offset.x && !offset.y) {
        return this;
      }
      if (!this._panAnim) {
        this._panAnim = new L.PosAnimation();
        this._panAnim.on({
          'step': this._onPanTransitionStep,
          'end': this._onPanTransitionEnd
        }, this);
      }
      if (!options.noMoveStart) {
        this.fire('movestart');
      }
      if (options.animate !== false) {
        L.DomUtil.addClass(this._mapPane, 'leaflet-pan-anim');
        var newPos = this._getMapPanePos().subtract(offset);
        this._panAnim.run(this._mapPane, newPos, options.duration || 0.25, options.easeLinearity);
      } else {
        this._rawPanBy(offset);
        this.fire('move').fire('moveend');
      }
      return this;
    },
    _onPanTransitionStep: function() {
      this.fire('move');
    },
    _onPanTransitionEnd: function() {
      L.DomUtil.removeClass(this._mapPane, 'leaflet-pan-anim');
      this.fire('moveend');
    },
    _tryAnimatedPan: function(center, options) {
      var offset = this._getCenterOffset(center)._floor();
      if ((options && options.animate) !== true && !this.getSize().contains(offset)) {
        return false;
      }
      this.panBy(offset, options);
      return true;
    }
  });
  L.PosAnimation = L.DomUtil.TRANSITION ? L.PosAnimation : L.PosAnimation.extend({
    run: function(el, newPos, duration, easeLinearity) {
      this.stop();
      this._el = el;
      this._inProgress = true;
      this._duration = duration || 0.25;
      this._easeOutPower = 1 / Math.max(easeLinearity || 0.5, 0.2);
      this._startPos = L.DomUtil.getPosition(el);
      this._offset = newPos.subtract(this._startPos);
      this._startTime = +new Date();
      this.fire('start');
      this._animate();
    },
    stop: function() {
      if (!this._inProgress) {
        return;
      }
      this._step();
      this._complete();
    },
    _animate: function() {
      this._animId = L.Util.requestAnimFrame(this._animate, this);
      this._step();
    },
    _step: function() {
      var elapsed = (+new Date()) - this._startTime,
          duration = this._duration * 1000;
      if (elapsed < duration) {
        this._runFrame(this._easeOut(elapsed / duration));
      } else {
        this._runFrame(1);
        this._complete();
      }
    },
    _runFrame: function(progress) {
      var pos = this._startPos.add(this._offset.multiplyBy(progress));
      L.DomUtil.setPosition(this._el, pos);
      this.fire('step');
    },
    _complete: function() {
      L.Util.cancelAnimFrame(this._animId);
      this._inProgress = false;
      this.fire('end');
    },
    _easeOut: function(t) {
      return 1 - Math.pow(1 - t, this._easeOutPower);
    }
  });
  L.Map.mergeOptions({
    zoomAnimation: true,
    zoomAnimationThreshold: 4
  });
  if (L.DomUtil.TRANSITION) {
    L.Map.addInitHook(function() {
      this._zoomAnimated = this.options.zoomAnimation && L.DomUtil.TRANSITION && L.Browser.any3d && !L.Browser.android23 && !L.Browser.mobileOpera;
      if (this._zoomAnimated) {
        L.DomEvent.on(this._mapPane, L.DomUtil.TRANSITION_END, this._catchTransitionEnd, this);
      }
    });
  }
  L.Map.include(!L.DomUtil.TRANSITION ? {} : {
    _catchTransitionEnd: function(e) {
      if (this._animatingZoom && e.propertyName.indexOf('transform') >= 0) {
        this._onZoomTransitionEnd();
      }
    },
    _nothingToAnimate: function() {
      return !this._container.getElementsByClassName('leaflet-zoom-animated').length;
    },
    _tryAnimatedZoom: function(center, zoom, options) {
      if (this._animatingZoom) {
        return true;
      }
      options = options || {};
      if (!this._zoomAnimated || options.animate === false || this._nothingToAnimate() || Math.abs(zoom - this._zoom) > this.options.zoomAnimationThreshold) {
        return false;
      }
      var scale = this.getZoomScale(zoom),
          offset = this._getCenterOffset(center)._divideBy(1 - 1 / scale),
          origin = this._getCenterLayerPoint()._add(offset);
      if (options.animate !== true && !this.getSize().contains(offset)) {
        return false;
      }
      this.fire('movestart').fire('zoomstart');
      this._animateZoom(center, zoom, origin, scale, null, true);
      return true;
    },
    _animateZoom: function(center, zoom, origin, scale, delta, backwards, forTouchZoom) {
      if (!forTouchZoom) {
        this._animatingZoom = true;
      }
      L.DomUtil.addClass(this._mapPane, 'leaflet-zoom-anim');
      this._animateToCenter = center;
      this._animateToZoom = zoom;
      if (L.Draggable) {
        L.Draggable._disabled = true;
      }
      L.Util.requestAnimFrame(function() {
        this.fire('zoomanim', {
          center: center,
          zoom: zoom,
          origin: origin,
          scale: scale,
          delta: delta,
          backwards: backwards
        });
        setTimeout(L.bind(this._onZoomTransitionEnd, this), 250);
      }, this);
    },
    _onZoomTransitionEnd: function() {
      if (!this._animatingZoom) {
        return;
      }
      this._animatingZoom = false;
      L.DomUtil.removeClass(this._mapPane, 'leaflet-zoom-anim');
      L.Util.requestAnimFrame(function() {
        this._resetView(this._animateToCenter, this._animateToZoom, true, true);
        if (L.Draggable) {
          L.Draggable._disabled = false;
        }
      }, this);
    }
  });
  L.TileLayer.include({
    _animateZoom: function(e) {
      if (!this._animating) {
        this._animating = true;
        this._prepareBgBuffer();
      }
      var bg = this._bgBuffer,
          transform = L.DomUtil.TRANSFORM,
          initialTransform = e.delta ? L.DomUtil.getTranslateString(e.delta) : bg.style[transform],
          scaleStr = L.DomUtil.getScaleString(e.scale, e.origin);
      bg.style[transform] = e.backwards ? scaleStr + ' ' + initialTransform : initialTransform + ' ' + scaleStr;
    },
    _endZoomAnim: function() {
      var front = this._tileContainer,
          bg = this._bgBuffer;
      front.style.visibility = '';
      front.parentNode.appendChild(front);
      L.Util.falseFn(bg.offsetWidth);
      var zoom = this._map.getZoom();
      if (zoom > this.options.maxZoom || zoom < this.options.minZoom) {
        this._clearBgBuffer();
      }
      this._animating = false;
    },
    _clearBgBuffer: function() {
      var map = this._map;
      if (map && !map._animatingZoom && !map.touchZoom._zooming) {
        this._bgBuffer.innerHTML = '';
        this._bgBuffer.style[L.DomUtil.TRANSFORM] = '';
      }
    },
    _prepareBgBuffer: function() {
      var front = this._tileContainer,
          bg = this._bgBuffer;
      var bgLoaded = this._getLoadedTilesPercentage(bg),
          frontLoaded = this._getLoadedTilesPercentage(front);
      if (bg && bgLoaded > 0.5 && frontLoaded < 0.5) {
        front.style.visibility = 'hidden';
        this._stopLoadingImages(front);
        return;
      }
      bg.style.visibility = 'hidden';
      bg.style[L.DomUtil.TRANSFORM] = '';
      this._tileContainer = bg;
      bg = this._bgBuffer = front;
      this._stopLoadingImages(bg);
      clearTimeout(this._clearBgBufferTimer);
    },
    _getLoadedTilesPercentage: function(container) {
      var tiles = container.getElementsByTagName('img'),
          i,
          len,
          count = 0;
      for (i = 0, len = tiles.length; i < len; i++) {
        if (tiles[i].complete) {
          count++;
        }
      }
      return count / len;
    },
    _stopLoadingImages: function(container) {
      var tiles = Array.prototype.slice.call(container.getElementsByTagName('img')),
          i,
          len,
          tile;
      for (i = 0, len = tiles.length; i < len; i++) {
        tile = tiles[i];
        if (!tile.complete) {
          tile.onload = L.Util.falseFn;
          tile.onerror = L.Util.falseFn;
          tile.src = L.Util.emptyImageUrl;
          tile.parentNode.removeChild(tile);
        }
      }
    }
  });
  L.Map.include({
    _defaultLocateOptions: {
      watch: false,
      setView: false,
      maxZoom: Infinity,
      timeout: 10000,
      maximumAge: 0,
      enableHighAccuracy: false
    },
    locate: function(options) {
      options = this._locateOptions = L.extend(this._defaultLocateOptions, options);
      if (!navigator.geolocation) {
        this._handleGeolocationError({
          code: 0,
          message: 'Geolocation not supported.'
        });
        return this;
      }
      var onResponse = L.bind(this._handleGeolocationResponse, this),
          onError = L.bind(this._handleGeolocationError, this);
      if (options.watch) {
        this._locationWatchId = navigator.geolocation.watchPosition(onResponse, onError, options);
      } else {
        navigator.geolocation.getCurrentPosition(onResponse, onError, options);
      }
      return this;
    },
    stopLocate: function() {
      if (navigator.geolocation) {
        navigator.geolocation.clearWatch(this._locationWatchId);
      }
      if (this._locateOptions) {
        this._locateOptions.setView = false;
      }
      return this;
    },
    _handleGeolocationError: function(error) {
      var c = error.code,
          message = error.message || (c === 1 ? 'permission denied' : (c === 2 ? 'position unavailable' : 'timeout'));
      if (this._locateOptions.setView && !this._loaded) {
        this.fitWorld();
      }
      this.fire('locationerror', {
        code: c,
        message: 'Geolocation error: ' + message + '.'
      });
    },
    _handleGeolocationResponse: function(pos) {
      var lat = pos.coords.latitude,
          lng = pos.coords.longitude,
          latlng = new L.LatLng(lat, lng),
          latAccuracy = 180 * pos.coords.accuracy / 40075017,
          lngAccuracy = latAccuracy / Math.cos(L.LatLng.DEG_TO_RAD * lat),
          bounds = L.latLngBounds([lat - latAccuracy, lng - lngAccuracy], [lat + latAccuracy, lng + lngAccuracy]),
          options = this._locateOptions;
      if (options.setView) {
        var zoom = Math.min(this.getBoundsZoom(bounds), options.maxZoom);
        this.setView(latlng, zoom);
      }
      var data = {
        latlng: latlng,
        bounds: bounds,
        timestamp: pos.timestamp
      };
      for (var i in pos.coords) {
        if (typeof pos.coords[i] === 'number') {
          data[i] = pos.coords[i];
        }
      }
      this.fire('locationfound', data);
    }
  });
}(window, document));

_removeDefine();
})();
(function() {
var _removeDefine = $__System.get("@@amd-helpers").createDefine();
define("4", ["3"], function(main) {
  return main;
});

_removeDefine();
})();
$__System.register("5", [], function() { return { setters: [], execute: function() {} } });

(function() {
var _removeDefine = $__System.get("@@amd-helpers").createDefine();
(function() {
  var console = window.console || {
    error: function() {},
    warn: function() {}
  };
  function defineLeafletLoading(L) {
    L.Control.Loading = L.Control.extend({
      options: {
        position: 'topleft',
        separate: false,
        zoomControl: null,
        spinjs: false,
        spin: {
          lines: 7,
          length: 3,
          width: 3,
          radius: 5,
          rotate: 13,
          top: "83%"
        }
      },
      initialize: function(options) {
        L.setOptions(this, options);
        this._dataLoaders = {};
        if (this.options.zoomControl !== null) {
          this.zoomControl = this.options.zoomControl;
        }
      },
      onAdd: function(map) {
        if (this.options.spinjs && (typeof Spinner !== 'function')) {
          return console.error("Leaflet.loading cannot load because you didn't load spin.js (http://fgnass.github.io/spin.js/), even though you set it in options.");
        }
        this._addLayerListeners(map);
        this._addMapListeners(map);
        if (!this.options.separate && !this.zoomControl) {
          if (map.zoomControl) {
            this.zoomControl = map.zoomControl;
          } else if (map.zoomsliderControl) {
            this.zoomControl = map.zoomsliderControl;
          }
        }
        var classes = 'leaflet-control-loading';
        var container;
        if (this.zoomControl && !this.options.separate) {
          container = this.zoomControl._container;
          classes += ' leaflet-bar-part-bottom leaflet-bar-part last';
          L.DomUtil.addClass(this._getLastControlButton(), 'leaflet-bar-part-bottom');
        } else {
          container = L.DomUtil.create('div', 'leaflet-control-zoom leaflet-bar');
        }
        this._indicator = L.DomUtil.create('a', classes, container);
        if (this.options.spinjs) {
          this._spinner = new Spinner(this.options.spin).spin();
          this._indicator.appendChild(this._spinner.el);
        }
        return container;
      },
      onRemove: function(map) {
        this._removeLayerListeners(map);
        this._removeMapListeners(map);
      },
      removeFrom: function(map) {
        if (this.zoomControl && !this.options.separate) {
          this._container.removeChild(this._indicator);
          this._map = null;
          this.onRemove(map);
          return this;
        } else {
          return L.Control.prototype.removeFrom.call(this, map);
        }
      },
      addLoader: function(id) {
        this._dataLoaders[id] = true;
        this.updateIndicator();
      },
      removeLoader: function(id) {
        delete this._dataLoaders[id];
        this.updateIndicator();
      },
      updateIndicator: function() {
        if (this.isLoading()) {
          this._showIndicator();
        } else {
          this._hideIndicator();
        }
      },
      isLoading: function() {
        return this._countLoaders() > 0;
      },
      _countLoaders: function() {
        var size = 0,
            key;
        for (key in this._dataLoaders) {
          if (this._dataLoaders.hasOwnProperty(key))
            size++;
        }
        return size;
      },
      _showIndicator: function() {
        L.DomUtil.addClass(this._indicator, 'is-loading');
        if (!this.options.separate) {
          if (this.zoomControl instanceof L.Control.Zoom) {
            L.DomUtil.removeClass(this._getLastControlButton(), 'leaflet-bar-part-bottom');
          } else if (typeof L.Control.Zoomslider === 'function' && this.zoomControl instanceof L.Control.Zoomslider) {
            L.DomUtil.removeClass(this.zoomControl._ui.zoomOut, 'leaflet-bar-part-bottom');
          }
        }
      },
      _hideIndicator: function() {
        L.DomUtil.removeClass(this._indicator, 'is-loading');
        if (!this.options.separate) {
          if (this.zoomControl instanceof L.Control.Zoom) {
            L.DomUtil.addClass(this._getLastControlButton(), 'leaflet-bar-part-bottom');
          } else if (typeof L.Control.Zoomslider === 'function' && this.zoomControl instanceof L.Control.Zoomslider) {
            L.DomUtil.addClass(this.zoomControl._ui.zoomOut, 'leaflet-bar-part-bottom');
          }
        }
      },
      _getLastControlButton: function() {
        var container = this.zoomControl._container,
            index = container.children.length - 1;
        while (index > 0) {
          var button = container.children[index];
          if (!(this._indicator === button || button.offsetWidth === 0 || button.offsetHeight === 0)) {
            break;
          }
          index--;
        }
        return container.children[index];
      },
      _handleLoading: function(e) {
        this.addLoader(this.getEventId(e));
      },
      _handleLoad: function(e) {
        this.removeLoader(this.getEventId(e));
      },
      getEventId: function(e) {
        if (e.id) {
          return e.id;
        } else if (e.layer) {
          return e.layer._leaflet_id;
        }
        return e.target._leaflet_id;
      },
      _layerAdd: function(e) {
        if (!e.layer || !e.layer.on)
          return;
        try {
          e.layer.on({
            loading: this._handleLoading,
            load: this._handleLoad
          }, this);
        } catch (exception) {
          console.warn('L.Control.Loading: Tried and failed to add ' + ' event handlers to layer', e.layer);
          console.warn('L.Control.Loading: Full details', exception);
        }
      },
      _addLayerListeners: function(map) {
        map.eachLayer(function(layer) {
          if (!layer.on)
            return;
          layer.on({
            loading: this._handleLoading,
            load: this._handleLoad
          }, this);
        }, this);
        map.on('layeradd', this._layerAdd, this);
      },
      _removeLayerListeners: function(map) {
        map.eachLayer(function(layer) {
          if (!layer.off)
            return;
          layer.off({
            loading: this._handleLoading,
            load: this._handleLoad
          }, this);
        }, this);
        map.off('layeradd', this._layerAdd, this);
      },
      _addMapListeners: function(map) {
        map.on({
          dataloading: this._handleLoading,
          dataload: this._handleLoad,
          layerremove: this._handleLoad
        }, this);
      },
      _removeMapListeners: function(map) {
        map.off({
          dataloading: this._handleLoading,
          dataload: this._handleLoad,
          layerremove: this._handleLoad
        }, this);
      }
    });
    L.Map.addInitHook(function() {
      if (this.options.loadingControl) {
        this.loadingControl = new L.Control.Loading();
        this.addControl(this.loadingControl);
      }
    });
    L.Control.loading = function(options) {
      return new L.Control.Loading(options);
    };
  }
  if (typeof define === 'function' && define.amd) {
    define("6", ["4"], function(L) {
      defineLeafletLoading(L);
    });
  } else {
    defineLeafletLoading(L);
  }
})();

_removeDefine();
})();
(function() {
var _removeDefine = $__System.get("@@amd-helpers").createDefine();
define("7", ["6"], function(main) {
  return main;
});

_removeDefine();
})();
$__System.register("8", [], function() { return { setters: [], execute: function() {} } });

$__System.registerDynamic("9", ["4"], false, function(__require, __exports, __module) {
  var _retrieveGlobal = $__System.get("@@global-helpers").prepareGlobal(__module.id, null, null);
  (function() {
    "format global";
    "deps leaflet";
    L.Control.StyledLayerControl = L.Control.Layers.extend({
      options: {
        collapsed: true,
        position: 'topright',
        autoZIndex: true
      },
      initialize: function(baseLayers, groupedOverlays, options) {
        var i,
            j;
        L.Util.setOptions(this, options);
        this._layers = {};
        this._lastZIndex = 0;
        this._handlingClick = false;
        this._groupList = [];
        this._domGroups = [];
        for (i in baseLayers) {
          for (var j in baseLayers[i].layers) {
            this._addLayer(baseLayers[i].layers[j], j, baseLayers[i], false);
          }
        }
        for (i in groupedOverlays) {
          for (var j in groupedOverlays[i].layers) {
            this._addLayer(groupedOverlays[i].layers[j], j, groupedOverlays[i], true);
          }
        }
      },
      onAdd: function(map) {
        this._initLayout();
        this._update();
        map.on('layeradd', this._onLayerChange, this).on('layerremove', this._onLayerChange, this);
        return this._container;
      },
      onRemove: function(map) {
        map.off('layeradd', this._onLayerChange).off('layerremove', this._onLayerChange);
      },
      addBaseLayer: function(layer, name, group) {
        this._addLayer(layer, name, group, false);
        this._update();
        return this;
      },
      addOverlay: function(layer, name, group) {
        this._addLayer(layer, name, group, true);
        this._update();
        return this;
      },
      removeLayer: function(layer) {
        var id = L.Util.stamp(layer);
        delete this._layers[id];
        this._update();
        return this;
      },
      removeGroup: function(group_Name) {
        for (group in this._groupList) {
          if (this._groupList[group].groupName == group_Name) {
            for (layer in this._layers) {
              if (this._layers[layer].group && this._layers[layer].group.name == group_Name) {
                delete this._layers[layer];
              }
            }
            delete this._groupList[group];
            this._update();
            break;
          }
        }
      },
      _initLayout: function() {
        var className = 'leaflet-control-layers',
            container = this._container = L.DomUtil.create('div', className);
        container.setAttribute('aria-haspopup', true);
        if (!L.Browser.touch) {
          L.DomEvent.disableClickPropagation(container);
          L.DomEvent.on(container, 'wheel', L.DomEvent.stopPropagation);
        } else {
          L.DomEvent.on(container, 'click', L.DomEvent.stopPropagation);
        }
        var section = document.createElement('section');
        section.className = 'ac-container ' + className + '-list';
        var form = this._form = L.DomUtil.create('form');
        section.appendChild(form);
        if (this.options.collapsed) {
          if (!L.Browser.android) {
            L.DomEvent.on(container, 'mouseover', this._expand, this).on(container, 'mouseout', this._collapse, this);
          }
          var link = this._layersLink = L.DomUtil.create('a', className + '-toggle', container);
          link.href = '#';
          link.title = 'Layers';
          if (L.Browser.touch) {
            L.DomEvent.on(link, 'click', L.DomEvent.stop).on(link, 'click', this._expand, this);
          } else {
            L.DomEvent.on(link, 'focus', this._expand, this);
          }
          this._map.on('click', this._collapse, this);
        } else {
          this._expand();
        }
        this._baseLayersList = L.DomUtil.create('div', className + '-base', form);
        this._overlaysList = L.DomUtil.create('div', className + '-overlays', form);
        container.appendChild(section);
        for (var c = 0; c < (containers = container.getElementsByClassName('ac-container')).length; c++) {
          if (this.options.container_width) {
            containers[c].style.width = this.options.container_width;
          }
          this._default_maxHeight = this.options.container_maxHeight ? this.options.container_maxHeight : (this._map._size.y - 70);
          containers[c].style.maxHeight = this._default_maxHeight + "px";
        }
        window.onresize = this._on_resize_window.bind(this);
      },
      _on_resize_window: function() {
        for (var c = 0; c < containers.length; c++) {
          containers[c].style.maxHeight = (window.innerHeight - 90) < this._removePxToInt(this._default_maxHeight) ? (window.innerHeight - 90) + "px" : this._removePxToInt(this._default_maxHeight) + "px";
        }
      },
      _removePxToInt: function(value) {
        return parseInt(value.replace("px", ""));
      },
      _addLayer: function(layer, name, group, overlay) {
        var id = L.Util.stamp(layer);
        this._layers[id] = {
          layer: layer,
          name: name,
          overlay: overlay
        };
        if (group) {
          var groupId = this._groupList.indexOf(group);
          if (groupId === -1) {
            for (g in this._groupList) {
              if (this._groupList[g].groupName == group.groupName) {
                groupId = g;
                break;
              }
            }
          }
          if (groupId === -1) {
            groupId = this._groupList.push(group) - 1;
          }
          this._layers[id].group = {
            name: group.groupName,
            id: groupId,
            expanded: group.expanded
          };
        }
        if (this.options.autoZIndex && layer.setZIndex) {
          this._lastZIndex++;
          layer.setZIndex(this._lastZIndex);
        }
      },
      _update: function() {
        if (!this._container) {
          return;
        }
        this._baseLayersList.innerHTML = '';
        this._overlaysList.innerHTML = '';
        this._domGroups.length = 0;
        var baseLayersPresent = false,
            overlaysPresent = false,
            i,
            obj;
        for (i in this._layers) {
          obj = this._layers[i];
          this._addItem(obj);
          overlaysPresent = overlaysPresent || obj.overlay;
          baseLayersPresent = baseLayersPresent || !obj.overlay;
        }
      },
      _onLayerChange: function(e) {
        var obj = this._layers[L.Util.stamp(e.layer)];
        if (!obj) {
          return;
        }
        if (!this._handlingClick) {
          this._update();
        }
        var type = obj.overlay ? (e.type === 'layeradd' ? 'overlayadd' : 'overlayremove') : (e.type === 'layeradd' ? 'baselayerchange' : null);
        if (type) {
          this._map.fire(type, obj);
        }
      },
      _createRadioElement: function(name, checked) {
        var radioHtml = '<input type="radio" class="leaflet-control-layers-selector" name="' + name + '"';
        if (checked) {
          radioHtml += ' checked="checked"';
        }
        radioHtml += '/>';
        var radioFragment = document.createElement('div');
        radioFragment.innerHTML = radioHtml;
        return radioFragment.firstChild;
      },
      _addItem: function(obj) {
        var label = document.createElement('div'),
            input,
            checked = this._map.hasLayer(obj.layer),
            container;
        if (obj.overlay) {
          input = document.createElement('input');
          input.type = 'checkbox';
          input.className = 'leaflet-control-layers-selector';
          input.defaultChecked = checked;
          label.className = "menu-item-checkbox";
        } else {
          input = this._createRadioElement('leaflet-base-layers', checked);
          label.className = "menu-item-radio";
        }
        input.layerId = L.Util.stamp(obj.layer);
        L.DomEvent.on(input, 'click', this._onInputClick, this);
        var name = document.createElement('span');
        name.innerHTML = ' ' + obj.name;
        label.appendChild(input);
        label.appendChild(name);
        if (obj.layer.StyledLayerControl && obj.layer.StyledLayerControl.removable) {
          var bt_delete = document.createElement("input");
          bt_delete.type = "button";
          bt_delete.className = "bt_delete";
          L.DomEvent.on(bt_delete, 'click', this._onDeleteClick, this);
          label.appendChild(bt_delete);
        }
        if (obj.overlay) {
          container = this._overlaysList;
        } else {
          container = this._baseLayersList;
        }
        var groupContainer = this._domGroups[obj.group.id];
        if (!groupContainer) {
          groupContainer = document.createElement('div');
          groupContainer.id = 'leaflet-control-accordion-layers-' + obj.group.id;
          var s_expanded = obj.group.expanded ? ' checked = "true" ' : '';
          var s_type_exclusive = this.options.exclusive ? ' type="radio" ' : ' type="checkbox" ';
          inputElement = '<input id="ac' + obj.group.id + '" name="accordion-1" class="menu" ' + s_expanded + s_type_exclusive + '/>';
          inputLabel = '<label for="ac' + obj.group.id + '">' + obj.group.name + '</label>';
          article = document.createElement('article');
          article.className = 'ac-large';
          article.appendChild(label);
          if (this.options.group_maxHeight) {
            article.style.maxHeight = this.options.group_maxHeight;
          }
          groupContainer.innerHTML = inputElement + inputLabel;
          groupContainer.appendChild(article);
          container.appendChild(groupContainer);
          this._domGroups[obj.group.id] = groupContainer;
        } else {
          groupContainer.lastElementChild.appendChild(label);
        }
        return label;
      },
      _onInputClick: function() {
        var i,
            input,
            obj,
            inputs = this._form.getElementsByTagName('input'),
            inputsLen = inputs.length;
        this._handlingClick = true;
        for (i = 0; i < inputsLen; i++) {
          input = inputs[i];
          obj = this._layers[input.layerId];
          if (!obj) {
            continue;
          }
          if (input.checked && !this._map.hasLayer(obj.layer)) {
            this._map.addLayer(obj.layer);
          } else if (!input.checked && this._map.hasLayer(obj.layer)) {
            this._map.removeLayer(obj.layer);
          }
        }
        this._handlingClick = false;
      },
      _onDeleteClick: function(obj) {
        var node = obj.target.parentElement.childNodes[0];
        n_obj = this._layers[node.layerId];
        if (!n_obj.overlay && node.checked) {
          return false;
        }
        if (this._map.hasLayer(n_obj.layer)) {
          this._map.removeLayer(n_obj.layer);
        }
        this.removeLayer(n_obj.layer);
        obj.target.parentNode.remove();
        return false;
      },
      _expand: function() {
        L.DomUtil.addClass(this._container, 'leaflet-control-layers-expanded');
      },
      _collapse: function() {
        this._container.className = this._container.className.replace(' leaflet-control-layers-expanded', '');
      }
    });
    L.Control.styledLayerControl = function(baseLayers, overlays, options) {
      return new L.Control.StyledLayerControl(baseLayers, overlays, options);
    };
  })();
  return _retrieveGlobal();
});

$__System.registerDynamic("a", ["9"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = req('9');
  global.define = __define;
  return module.exports;
});

(function() {
var _removeDefine = $__System.get("@@amd-helpers").createDefine();
(function() {
  var _nodejs = (typeof process !== 'undefined' && process.versions && process.versions.node);
  var _browser = !_nodejs && (typeof window !== 'undefined' || typeof self !== 'undefined');
  if (_browser) {
    if (typeof global === 'undefined') {
      if (typeof window !== 'undefined') {
        global = window;
      } else if (typeof self !== 'undefined') {
        global = self;
      } else if (typeof $ !== 'undefined') {
        global = $;
      }
    }
  }
  var wrapper = function(jsonld) {
    jsonld.compact = function(input, ctx, options, callback) {
      if (arguments.length < 2) {
        return jsonld.nextTick(function() {
          callback(new TypeError('Could not compact, too few arguments.'));
        });
      }
      if (typeof options === 'function') {
        callback = options;
        options = {};
      }
      options = options || {};
      if (ctx === null) {
        return jsonld.nextTick(function() {
          callback(new JsonLdError('The compaction context must not be null.', 'jsonld.CompactError', {code: 'invalid local context'}));
        });
      }
      if (input === null) {
        return jsonld.nextTick(function() {
          callback(null, null);
        });
      }
      if (!('base' in options)) {
        options.base = (typeof input === 'string') ? input : '';
      }
      if (!('compactArrays' in options)) {
        options.compactArrays = true;
      }
      if (!('graph' in options)) {
        options.graph = false;
      }
      if (!('skipExpansion' in options)) {
        options.skipExpansion = false;
      }
      if (!('documentLoader' in options)) {
        options.documentLoader = jsonld.loadDocument;
      }
      if (!('link' in options)) {
        options.link = false;
      }
      if (options.link) {
        options.skipExpansion = true;
      }
      var expand = function(input, options, callback) {
        jsonld.nextTick(function() {
          if (options.skipExpansion) {
            return callback(null, input);
          }
          jsonld.expand(input, options, callback);
        });
      };
      expand(input, options, function(err, expanded) {
        if (err) {
          return callback(new JsonLdError('Could not expand input before compaction.', 'jsonld.CompactError', {cause: err}));
        }
        var activeCtx = _getInitialContext(options);
        jsonld.processContext(activeCtx, ctx, options, function(err, activeCtx) {
          if (err) {
            return callback(new JsonLdError('Could not process context before compaction.', 'jsonld.CompactError', {cause: err}));
          }
          var compacted;
          try {
            compacted = new Processor().compact(activeCtx, null, expanded, options);
          } catch (ex) {
            return callback(ex);
          }
          cleanup(null, compacted, activeCtx, options);
        });
      });
      function cleanup(err, compacted, activeCtx, options) {
        if (err) {
          return callback(err);
        }
        if (options.compactArrays && !options.graph && _isArray(compacted)) {
          if (compacted.length === 1) {
            compacted = compacted[0];
          } else if (compacted.length === 0) {
            compacted = {};
          }
        } else if (options.graph && _isObject(compacted)) {
          compacted = [compacted];
        }
        if (_isObject(ctx) && '@context' in ctx) {
          ctx = ctx['@context'];
        }
        ctx = _clone(ctx);
        if (!_isArray(ctx)) {
          ctx = [ctx];
        }
        var tmp = ctx;
        ctx = [];
        for (var i = 0; i < tmp.length; ++i) {
          if (!_isObject(tmp[i]) || Object.keys(tmp[i]).length > 0) {
            ctx.push(tmp[i]);
          }
        }
        var hasContext = (ctx.length > 0);
        if (ctx.length === 1) {
          ctx = ctx[0];
        }
        if (_isArray(compacted)) {
          var kwgraph = _compactIri(activeCtx, '@graph');
          var graph = compacted;
          compacted = {};
          if (hasContext) {
            compacted['@context'] = ctx;
          }
          compacted[kwgraph] = graph;
        } else if (_isObject(compacted) && hasContext) {
          var graph = compacted;
          compacted = {'@context': ctx};
          for (var key in graph) {
            compacted[key] = graph[key];
          }
        }
        callback(null, compacted, activeCtx);
      }
    };
    jsonld.expand = function(input, options, callback) {
      if (arguments.length < 1) {
        return jsonld.nextTick(function() {
          callback(new TypeError('Could not expand, too few arguments.'));
        });
      }
      if (typeof options === 'function') {
        callback = options;
        options = {};
      }
      options = options || {};
      if (!('documentLoader' in options)) {
        options.documentLoader = jsonld.loadDocument;
      }
      if (!('keepFreeFloatingNodes' in options)) {
        options.keepFreeFloatingNodes = false;
      }
      jsonld.nextTick(function() {
        if (typeof input === 'string') {
          var done = function(err, remoteDoc) {
            if (err) {
              return callback(err);
            }
            try {
              if (!remoteDoc.document) {
                throw new JsonLdError('No remote document found at the given URL.', 'jsonld.NullRemoteDocument');
              }
              if (typeof remoteDoc.document === 'string') {
                remoteDoc.document = JSON.parse(remoteDoc.document);
              }
            } catch (ex) {
              return callback(new JsonLdError('Could not retrieve a JSON-LD document from the URL. URL ' + 'dereferencing not implemented.', 'jsonld.LoadDocumentError', {
                code: 'loading document failed',
                cause: ex,
                remoteDoc: remoteDoc
              }));
            }
            expand(remoteDoc);
          };
          var promise = options.documentLoader(input, done);
          if (promise && 'then' in promise) {
            promise.then(done.bind(null, null), done);
          }
          return;
        }
        expand({
          contextUrl: null,
          documentUrl: null,
          document: input
        });
      });
      function expand(remoteDoc) {
        if (!('base' in options)) {
          options.base = remoteDoc.documentUrl || '';
        }
        var input = {
          document: _clone(remoteDoc.document),
          remoteContext: {'@context': remoteDoc.contextUrl}
        };
        if ('expandContext' in options) {
          var expandContext = _clone(options.expandContext);
          if (typeof expandContext === 'object' && '@context' in expandContext) {
            input.expandContext = expandContext;
          } else {
            input.expandContext = {'@context': expandContext};
          }
        }
        _retrieveContextUrls(input, options, function(err, input) {
          if (err) {
            return callback(err);
          }
          var expanded;
          try {
            var processor = new Processor();
            var activeCtx = _getInitialContext(options);
            var document = input.document;
            var remoteContext = input.remoteContext['@context'];
            if (input.expandContext) {
              activeCtx = processor.processContext(activeCtx, input.expandContext['@context'], options);
            }
            if (remoteContext) {
              activeCtx = processor.processContext(activeCtx, remoteContext, options);
            }
            expanded = processor.expand(activeCtx, null, document, options, false);
            if (_isObject(expanded) && ('@graph' in expanded) && Object.keys(expanded).length === 1) {
              expanded = expanded['@graph'];
            } else if (expanded === null) {
              expanded = [];
            }
            if (!_isArray(expanded)) {
              expanded = [expanded];
            }
          } catch (ex) {
            return callback(ex);
          }
          callback(null, expanded);
        });
      }
    };
    jsonld.flatten = function(input, ctx, options, callback) {
      if (arguments.length < 1) {
        return jsonld.nextTick(function() {
          callback(new TypeError('Could not flatten, too few arguments.'));
        });
      }
      if (typeof options === 'function') {
        callback = options;
        options = {};
      } else if (typeof ctx === 'function') {
        callback = ctx;
        ctx = null;
        options = {};
      }
      options = options || {};
      if (!('base' in options)) {
        options.base = (typeof input === 'string') ? input : '';
      }
      if (!('documentLoader' in options)) {
        options.documentLoader = jsonld.loadDocument;
      }
      jsonld.expand(input, options, function(err, _input) {
        if (err) {
          return callback(new JsonLdError('Could not expand input before flattening.', 'jsonld.FlattenError', {cause: err}));
        }
        var flattened;
        try {
          flattened = new Processor().flatten(_input);
        } catch (ex) {
          return callback(ex);
        }
        if (ctx === null) {
          return callback(null, flattened);
        }
        options.graph = true;
        options.skipExpansion = true;
        jsonld.compact(flattened, ctx, options, function(err, compacted) {
          if (err) {
            return callback(new JsonLdError('Could not compact flattened output.', 'jsonld.FlattenError', {cause: err}));
          }
          callback(null, compacted);
        });
      });
    };
    jsonld.frame = function(input, frame, options, callback) {
      if (arguments.length < 2) {
        return jsonld.nextTick(function() {
          callback(new TypeError('Could not frame, too few arguments.'));
        });
      }
      if (typeof options === 'function') {
        callback = options;
        options = {};
      }
      options = options || {};
      if (!('base' in options)) {
        options.base = (typeof input === 'string') ? input : '';
      }
      if (!('documentLoader' in options)) {
        options.documentLoader = jsonld.loadDocument;
      }
      if (!('embed' in options)) {
        options.embed = '@last';
      }
      options.explicit = options.explicit || false;
      if (!('requireAll' in options)) {
        options.requireAll = true;
      }
      options.omitDefault = options.omitDefault || false;
      jsonld.nextTick(function() {
        if (typeof frame === 'string') {
          var done = function(err, remoteDoc) {
            if (err) {
              return callback(err);
            }
            try {
              if (!remoteDoc.document) {
                throw new JsonLdError('No remote document found at the given URL.', 'jsonld.NullRemoteDocument');
              }
              if (typeof remoteDoc.document === 'string') {
                remoteDoc.document = JSON.parse(remoteDoc.document);
              }
            } catch (ex) {
              return callback(new JsonLdError('Could not retrieve a JSON-LD document from the URL. URL ' + 'dereferencing not implemented.', 'jsonld.LoadDocumentError', {
                code: 'loading document failed',
                cause: ex,
                remoteDoc: remoteDoc
              }));
            }
            doFrame(remoteDoc);
          };
          var promise = options.documentLoader(frame, done);
          if (promise && 'then' in promise) {
            promise.then(done.bind(null, null), done);
          }
          return;
        }
        doFrame({
          contextUrl: null,
          documentUrl: null,
          document: frame
        });
      });
      function doFrame(remoteFrame) {
        var frame = remoteFrame.document;
        var ctx;
        if (frame) {
          ctx = frame['@context'];
          if (remoteFrame.contextUrl) {
            if (!ctx) {
              ctx = remoteFrame.contextUrl;
            } else if (_isArray(ctx)) {
              ctx.push(remoteFrame.contextUrl);
            } else {
              ctx = [ctx, remoteFrame.contextUrl];
            }
            frame['@context'] = ctx;
          } else {
            ctx = ctx || {};
          }
        } else {
          ctx = {};
        }
        jsonld.expand(input, options, function(err, expanded) {
          if (err) {
            return callback(new JsonLdError('Could not expand input before framing.', 'jsonld.FrameError', {cause: err}));
          }
          var opts = _clone(options);
          opts.isFrame = true;
          opts.keepFreeFloatingNodes = true;
          jsonld.expand(frame, opts, function(err, expandedFrame) {
            if (err) {
              return callback(new JsonLdError('Could not expand frame before framing.', 'jsonld.FrameError', {cause: err}));
            }
            var framed;
            try {
              framed = new Processor().frame(expanded, expandedFrame, opts);
            } catch (ex) {
              return callback(ex);
            }
            opts.graph = true;
            opts.skipExpansion = true;
            opts.link = {};
            jsonld.compact(framed, ctx, opts, function(err, compacted, ctx) {
              if (err) {
                return callback(new JsonLdError('Could not compact framed output.', 'jsonld.FrameError', {cause: err}));
              }
              var graph = _compactIri(ctx, '@graph');
              opts.link = {};
              compacted[graph] = _removePreserve(ctx, compacted[graph], opts);
              callback(null, compacted);
            });
          });
        });
      }
    };
    jsonld.link = function(input, ctx, options, callback) {
      var frame = {};
      if (ctx) {
        frame['@context'] = ctx;
      }
      frame['@embed'] = '@link';
      jsonld.frame(input, frame, options, callback);
    };
    jsonld.objectify = function(input, ctx, options, callback) {
      if (typeof options === 'function') {
        callback = options;
        options = {};
      }
      options = options || {};
      if (!('base' in options)) {
        options.base = (typeof input === 'string') ? input : '';
      }
      if (!('documentLoader' in options)) {
        options.documentLoader = jsonld.loadDocument;
      }
      jsonld.expand(input, options, function(err, _input) {
        if (err) {
          return callback(new JsonLdError('Could not expand input before linking.', 'jsonld.LinkError', {cause: err}));
        }
        var flattened;
        try {
          flattened = new Processor().flatten(_input);
        } catch (ex) {
          return callback(ex);
        }
        options.graph = true;
        options.skipExpansion = true;
        jsonld.compact(flattened, ctx, options, function(err, compacted, ctx) {
          if (err) {
            return callback(new JsonLdError('Could not compact flattened output before linking.', 'jsonld.LinkError', {cause: err}));
          }
          var graph = _compactIri(ctx, '@graph');
          var top = compacted[graph][0];
          var recurse = function(subject) {
            if (!_isObject(subject) && !_isArray(subject)) {
              return;
            }
            if (_isObject(subject)) {
              if (recurse.visited[subject['@id']]) {
                return;
              }
              recurse.visited[subject['@id']] = true;
            }
            for (var k in subject) {
              var obj = subject[k];
              var isid = (jsonld.getContextValue(ctx, k, '@type') === '@id');
              if (!_isArray(obj) && !_isObject(obj) && !isid) {
                continue;
              }
              if (_isString(obj) && isid) {
                subject[k] = obj = top[obj];
                recurse(obj);
              } else if (_isArray(obj)) {
                for (var i = 0; i < obj.length; ++i) {
                  if (_isString(obj[i]) && isid) {
                    obj[i] = top[obj[i]];
                  } else if (_isObject(obj[i]) && '@id' in obj[i]) {
                    obj[i] = top[obj[i]['@id']];
                  }
                  recurse(obj[i]);
                }
              } else if (_isObject(obj)) {
                var sid = obj['@id'];
                subject[k] = obj = top[sid];
                recurse(obj);
              }
            }
          };
          recurse.visited = {};
          recurse(top);
          compacted.of_type = {};
          for (var s in top) {
            if (!('@type' in top[s])) {
              continue;
            }
            var types = top[s]['@type'];
            if (!_isArray(types)) {
              types = [types];
            }
            for (var t = 0; t < types.length; ++t) {
              if (!(types[t] in compacted.of_type)) {
                compacted.of_type[types[t]] = [];
              }
              compacted.of_type[types[t]].push(top[s]);
            }
          }
          callback(null, compacted);
        });
      });
    };
    jsonld.normalize = function(input, options, callback) {
      if (arguments.length < 1) {
        return jsonld.nextTick(function() {
          callback(new TypeError('Could not normalize, too few arguments.'));
        });
      }
      if (typeof options === 'function') {
        callback = options;
        options = {};
      }
      options = options || {};
      if (!('algorithm' in options)) {
        options.algorithm = 'URGNA2012';
      }
      if (!('base' in options)) {
        options.base = (typeof input === 'string') ? input : '';
      }
      if (!('documentLoader' in options)) {
        options.documentLoader = jsonld.loadDocument;
      }
      if ('inputFormat' in options) {
        if (options.inputFormat !== 'application/nquads') {
          return callback(new JsonLdError('Unknown normalization input format.', 'jsonld.NormalizeError'));
        }
        var parsedInput = _parseNQuads(input);
        new Processor().normalize(parsedInput, options, callback);
      } else {
        var opts = _clone(options);
        delete opts.format;
        opts.produceGeneralizedRdf = false;
        jsonld.toRDF(input, opts, function(err, dataset) {
          if (err) {
            return callback(new JsonLdError('Could not convert input to RDF dataset before normalization.', 'jsonld.NormalizeError', {cause: err}));
          }
          new Processor().normalize(dataset, options, callback);
        });
      }
    };
    jsonld.fromRDF = function(dataset, options, callback) {
      if (arguments.length < 1) {
        return jsonld.nextTick(function() {
          callback(new TypeError('Could not convert from RDF, too few arguments.'));
        });
      }
      if (typeof options === 'function') {
        callback = options;
        options = {};
      }
      options = options || {};
      if (!('useRdfType' in options)) {
        options.useRdfType = false;
      }
      if (!('useNativeTypes' in options)) {
        options.useNativeTypes = false;
      }
      if (!('format' in options) && _isString(dataset)) {
        if (!('format' in options)) {
          options.format = 'application/nquads';
        }
      }
      jsonld.nextTick(function() {
        var rdfParser;
        if (options.format) {
          rdfParser = options.rdfParser || _rdfParsers[options.format];
          if (!rdfParser) {
            return callback(new JsonLdError('Unknown input format.', 'jsonld.UnknownFormat', {format: options.format}));
          }
        } else {
          rdfParser = function() {
            return dataset;
          };
        }
        var callbackCalled = false;
        try {
          dataset = rdfParser(dataset, function(err, dataset) {
            callbackCalled = true;
            if (err) {
              return callback(err);
            }
            fromRDF(dataset, options, callback);
          });
        } catch (e) {
          if (!callbackCalled) {
            return callback(e);
          }
          throw e;
        }
        if (dataset) {
          if ('then' in dataset) {
            return dataset.then(function(dataset) {
              fromRDF(dataset, options, callback);
            }, callback);
          }
          fromRDF(dataset, options, callback);
        }
        function fromRDF(dataset, options, callback) {
          new Processor().fromRDF(dataset, options, callback);
        }
      });
    };
    jsonld.toRDF = function(input, options, callback) {
      if (arguments.length < 1) {
        return jsonld.nextTick(function() {
          callback(new TypeError('Could not convert to RDF, too few arguments.'));
        });
      }
      if (typeof options === 'function') {
        callback = options;
        options = {};
      }
      options = options || {};
      if (!('base' in options)) {
        options.base = (typeof input === 'string') ? input : '';
      }
      if (!('documentLoader' in options)) {
        options.documentLoader = jsonld.loadDocument;
      }
      jsonld.expand(input, options, function(err, expanded) {
        if (err) {
          return callback(new JsonLdError('Could not expand input before serialization to RDF.', 'jsonld.RdfError', {cause: err}));
        }
        var dataset;
        try {
          dataset = Processor.prototype.toRDF(expanded, options);
          if (options.format) {
            if (options.format === 'application/nquads') {
              return callback(null, _toNQuads(dataset));
            }
            throw new JsonLdError('Unknown output format.', 'jsonld.UnknownFormat', {format: options.format});
          }
        } catch (ex) {
          return callback(ex);
        }
        callback(null, dataset);
      });
    };
    jsonld.createNodeMap = function(input, options, callback) {
      if (arguments.length < 1) {
        return jsonld.nextTick(function() {
          callback(new TypeError('Could not create node map, too few arguments.'));
        });
      }
      if (typeof options === 'function') {
        callback = options;
        options = {};
      }
      options = options || {};
      if (!('base' in options)) {
        options.base = (typeof input === 'string') ? input : '';
      }
      if (!('documentLoader' in options)) {
        options.documentLoader = jsonld.loadDocument;
      }
      jsonld.expand(input, options, function(err, _input) {
        if (err) {
          return callback(new JsonLdError('Could not expand input before creating node map.', 'jsonld.CreateNodeMapError', {cause: err}));
        }
        var nodeMap;
        try {
          nodeMap = new Processor().createNodeMap(_input, options);
        } catch (ex) {
          return callback(ex);
        }
        callback(null, nodeMap);
      });
    };
    jsonld.merge = function(docs, ctx, options, callback) {
      if (arguments.length < 1) {
        return jsonld.nextTick(function() {
          callback(new TypeError('Could not merge, too few arguments.'));
        });
      }
      if (!_isArray(docs)) {
        return jsonld.nextTick(function() {
          callback(new TypeError('Could not merge, "docs" must be an array.'));
        });
      }
      if (typeof options === 'function') {
        callback = options;
        options = {};
      } else if (typeof ctx === 'function') {
        callback = ctx;
        ctx = null;
        options = {};
      }
      options = options || {};
      var expanded = [];
      var error = null;
      var count = docs.length;
      for (var i = 0; i < docs.length; ++i) {
        var opts = {};
        for (var key in options) {
          opts[key] = options[key];
        }
        jsonld.expand(docs[i], opts, expandComplete);
      }
      function expandComplete(err, _input) {
        if (error) {
          return;
        }
        if (err) {
          error = err;
          return callback(new JsonLdError('Could not expand input before flattening.', 'jsonld.FlattenError', {cause: err}));
        }
        expanded.push(_input);
        if (--count === 0) {
          merge(expanded);
        }
      }
      function merge(expanded) {
        var mergeNodes = true;
        if ('mergeNodes' in options) {
          mergeNodes = options.mergeNodes;
        }
        var issuer = options.namer || options.issuer || new IdentifierIssuer('_:b');
        var graphs = {'@default': {}};
        var defaultGraph;
        try {
          for (var i = 0; i < expanded.length; ++i) {
            var doc = expanded[i];
            doc = jsonld.relabelBlankNodes(doc, {issuer: new IdentifierIssuer('_:b' + i + '-')});
            var _graphs = (mergeNodes || i === 0) ? graphs : {'@default': {}};
            _createNodeMap(doc, _graphs, '@default', issuer);
            if (_graphs !== graphs) {
              for (var graphName in _graphs) {
                var _nodeMap = _graphs[graphName];
                if (!(graphName in graphs)) {
                  graphs[graphName] = _nodeMap;
                  continue;
                }
                var nodeMap = graphs[graphName];
                for (var key in _nodeMap) {
                  if (!(key in nodeMap)) {
                    nodeMap[key] = _nodeMap[key];
                  }
                }
              }
            }
          }
          defaultGraph = _mergeNodeMaps(graphs);
        } catch (ex) {
          return callback(ex);
        }
        var flattened = [];
        var keys = Object.keys(defaultGraph).sort();
        for (var ki = 0; ki < keys.length; ++ki) {
          var node = defaultGraph[keys[ki]];
          if (!_isSubjectReference(node)) {
            flattened.push(node);
          }
        }
        if (ctx === null) {
          return callback(null, flattened);
        }
        options.graph = true;
        options.skipExpansion = true;
        jsonld.compact(flattened, ctx, options, function(err, compacted) {
          if (err) {
            return callback(new JsonLdError('Could not compact merged output.', 'jsonld.MergeError', {cause: err}));
          }
          callback(null, compacted);
        });
      }
    };
    jsonld.relabelBlankNodes = function(input, options) {
      options = options || {};
      var issuer = options.namer || options.issuer || new IdentifierIssuer('_:b');
      return _labelBlankNodes(issuer, input);
    };
    jsonld.prependBase = function(base, iri) {
      return _prependBase(base, iri);
    };
    jsonld.documentLoader = function(url, callback) {
      var err = new JsonLdError('Could not retrieve a JSON-LD document from the URL. URL ' + 'dereferencing not implemented.', 'jsonld.LoadDocumentError', {code: 'loading document failed'});
      if (_nodejs) {
        return callback(err, {
          contextUrl: null,
          documentUrl: url,
          document: null
        });
      }
      return jsonld.promisify(function(callback) {
        callback(err);
      });
    };
    jsonld.loadDocument = function(url, callback) {
      var promise = jsonld.documentLoader(url, callback);
      if (promise && 'then' in promise) {
        promise.then(callback.bind(null, null), callback);
      }
    };
    jsonld.promises = function(options) {
      options = options || {};
      var slice = Array.prototype.slice;
      var promisify = jsonld.promisify;
      var api = options.api || {};
      var version = options.version || 'jsonld.js';
      if (typeof options.api === 'string') {
        if (!options.version) {
          version = options.api;
        }
        api = {};
      }
      api.expand = function(input) {
        if (arguments.length < 1) {
          throw new TypeError('Could not expand, too few arguments.');
        }
        return promisify.apply(null, [jsonld.expand].concat(slice.call(arguments)));
      };
      api.compact = function(input, ctx) {
        if (arguments.length < 2) {
          throw new TypeError('Could not compact, too few arguments.');
        }
        var compact = function(input, ctx, options, callback) {
          jsonld.compact(input, ctx, options, function(err, compacted) {
            callback(err, compacted);
          });
        };
        return promisify.apply(null, [compact].concat(slice.call(arguments)));
      };
      api.flatten = function(input) {
        if (arguments.length < 1) {
          throw new TypeError('Could not flatten, too few arguments.');
        }
        return promisify.apply(null, [jsonld.flatten].concat(slice.call(arguments)));
      };
      api.frame = function(input, frame) {
        if (arguments.length < 2) {
          throw new TypeError('Could not frame, too few arguments.');
        }
        return promisify.apply(null, [jsonld.frame].concat(slice.call(arguments)));
      };
      api.fromRDF = function(dataset) {
        if (arguments.length < 1) {
          throw new TypeError('Could not convert from RDF, too few arguments.');
        }
        return promisify.apply(null, [jsonld.fromRDF].concat(slice.call(arguments)));
      };
      api.toRDF = function(input) {
        if (arguments.length < 1) {
          throw new TypeError('Could not convert to RDF, too few arguments.');
        }
        return promisify.apply(null, [jsonld.toRDF].concat(slice.call(arguments)));
      };
      api.normalize = function(input) {
        if (arguments.length < 1) {
          throw new TypeError('Could not normalize, too few arguments.');
        }
        return promisify.apply(null, [jsonld.normalize].concat(slice.call(arguments)));
      };
      if (version === 'jsonld.js') {
        api.link = function(input, ctx) {
          if (arguments.length < 2) {
            throw new TypeError('Could not link, too few arguments.');
          }
          return promisify.apply(null, [jsonld.link].concat(slice.call(arguments)));
        };
        api.objectify = function(input) {
          return promisify.apply(null, [jsonld.objectify].concat(slice.call(arguments)));
        };
        api.createNodeMap = function(input) {
          return promisify.apply(null, [jsonld.createNodeMap].concat(slice.call(arguments)));
        };
        api.merge = function(input) {
          return promisify.apply(null, [jsonld.merge].concat(slice.call(arguments)));
        };
      }
      try {
        jsonld.Promise = global.Promise || require('es6-promise').Promise;
      } catch (e) {
        var f = function() {
          throw new Error('Unable to find a Promise implementation.');
        };
        for (var method in api) {
          api[method] = f;
        }
      }
      return api;
    };
    jsonld.promisify = function(op) {
      if (!jsonld.Promise) {
        try {
          jsonld.Promise = global.Promise || require('es6-promise').Promise;
        } catch (e) {
          throw new Error('Unable to find a Promise implementation.');
        }
      }
      var args = Array.prototype.slice.call(arguments, 1);
      return new jsonld.Promise(function(resolve, reject) {
        op.apply(null, args.concat(function(err, value) {
          if (!err) {
            resolve(value);
          } else {
            reject(err);
          }
        }));
      });
    };
    jsonld.promises({api: jsonld.promises});
    function JsonLdProcessor() {}
    JsonLdProcessor.prototype = jsonld.promises({version: 'json-ld-1.0'});
    JsonLdProcessor.prototype.toString = function() {
      if (this instanceof JsonLdProcessor) {
        return '[object JsonLdProcessor]';
      }
      return '[object JsonLdProcessorPrototype]';
    };
    jsonld.JsonLdProcessor = JsonLdProcessor;
    var canDefineProperty = !!Object.defineProperty;
    if (canDefineProperty) {
      try {
        Object.defineProperty({}, 'x', {});
      } catch (e) {
        canDefineProperty = false;
      }
    }
    if (canDefineProperty) {
      Object.defineProperty(JsonLdProcessor, 'prototype', {
        writable: false,
        enumerable: false
      });
      Object.defineProperty(JsonLdProcessor.prototype, 'constructor', {
        writable: true,
        enumerable: false,
        configurable: true,
        value: JsonLdProcessor
      });
    }
    if (_browser && typeof global.JsonLdProcessor === 'undefined') {
      if (canDefineProperty) {
        Object.defineProperty(global, 'JsonLdProcessor', {
          writable: true,
          enumerable: false,
          configurable: true,
          value: JsonLdProcessor
        });
      } else {
        global.JsonLdProcessor = JsonLdProcessor;
      }
    }
    var _setImmediate = typeof setImmediate === 'function' && setImmediate;
    var _delay = _setImmediate ? function(fn) {
      _setImmediate(fn);
    } : function(fn) {
      setTimeout(fn, 0);
    };
    if (typeof process === 'object' && typeof process.nextTick === 'function') {
      jsonld.nextTick = process.nextTick;
    } else {
      jsonld.nextTick = _delay;
    }
    jsonld.setImmediate = _setImmediate ? _delay : jsonld.nextTick;
    jsonld.parseLinkHeader = function(header) {
      var rval = {};
      var entries = header.match(/(?:<[^>]*?>|"[^"]*?"|[^,])+/g);
      var rLinkHeader = /\s*<([^>]*?)>\s*(?:;\s*(.*))?/;
      for (var i = 0; i < entries.length; ++i) {
        var match = entries[i].match(rLinkHeader);
        if (!match) {
          continue;
        }
        var result = {target: match[1]};
        var params = match[2];
        var rParams = /(.*?)=(?:(?:"([^"]*?)")|([^"]*?))\s*(?:(?:;\s*)|$)/g;
        while (match = rParams.exec(params)) {
          result[match[1]] = (match[2] === undefined) ? match[3] : match[2];
        }
        var rel = result['rel'] || '';
        if (_isArray(rval[rel])) {
          rval[rel].push(result);
        } else if (rel in rval) {
          rval[rel] = [rval[rel], result];
        } else {
          rval[rel] = result;
        }
      }
      return rval;
    };
    jsonld.RequestQueue = function() {
      this._requests = {};
    };
    jsonld.RequestQueue.prototype.wrapLoader = function(loader) {
      this._loader = loader;
      this._usePromise = (loader.length === 1);
      return this.add.bind(this);
    };
    jsonld.RequestQueue.prototype.add = function(url, callback) {
      var self = this;
      if (!callback && !self._usePromise) {
        throw new Error('callback must be specified.');
      }
      if (self._usePromise) {
        return new jsonld.Promise(function(resolve, reject) {
          var load = self._requests[url];
          if (!load) {
            load = self._requests[url] = self._loader(url).then(function(remoteDoc) {
              delete self._requests[url];
              return remoteDoc;
            }).catch(function(err) {
              delete self._requests[url];
              throw err;
            });
          }
          load.then(function(remoteDoc) {
            resolve(remoteDoc);
          }).catch(function(err) {
            reject(err);
          });
        });
      }
      if (url in self._requests) {
        self._requests[url].push(callback);
      } else {
        self._requests[url] = [callback];
        self._loader(url, function(err, remoteDoc) {
          var callbacks = self._requests[url];
          delete self._requests[url];
          for (var i = 0; i < callbacks.length; ++i) {
            callbacks[i](err, remoteDoc);
          }
        });
      }
    };
    jsonld.DocumentCache = function(size) {
      this.order = [];
      this.cache = {};
      this.size = size || 50;
      this.expires = 30 * 1000;
    };
    jsonld.DocumentCache.prototype.get = function(url) {
      if (url in this.cache) {
        var entry = this.cache[url];
        if (entry.expires >= +new Date()) {
          return entry.ctx;
        }
        delete this.cache[url];
        this.order.splice(this.order.indexOf(url), 1);
      }
      return null;
    };
    jsonld.DocumentCache.prototype.set = function(url, ctx) {
      if (this.order.length === this.size) {
        delete this.cache[this.order.shift()];
      }
      this.order.push(url);
      this.cache[url] = {
        ctx: ctx,
        expires: (+new Date() + this.expires)
      };
    };
    jsonld.ActiveContextCache = function(size) {
      this.order = [];
      this.cache = {};
      this.size = size || 100;
    };
    jsonld.ActiveContextCache.prototype.get = function(activeCtx, localCtx) {
      var key1 = JSON.stringify(activeCtx);
      var key2 = JSON.stringify(localCtx);
      var level1 = this.cache[key1];
      if (level1 && key2 in level1) {
        return level1[key2];
      }
      return null;
    };
    jsonld.ActiveContextCache.prototype.set = function(activeCtx, localCtx, result) {
      if (this.order.length === this.size) {
        var entry = this.order.shift();
        delete this.cache[entry.activeCtx][entry.localCtx];
      }
      var key1 = JSON.stringify(activeCtx);
      var key2 = JSON.stringify(localCtx);
      this.order.push({
        activeCtx: key1,
        localCtx: key2
      });
      if (!(key1 in this.cache)) {
        this.cache[key1] = {};
      }
      this.cache[key1][key2] = _clone(result);
    };
    jsonld.cache = {activeCtx: new jsonld.ActiveContextCache()};
    jsonld.documentLoaders = {};
    jsonld.documentLoaders.jquery = function($, options) {
      options = options || {};
      var queue = new jsonld.RequestQueue();
      var usePromise = ('usePromise' in options ? options.usePromise : (typeof Promise !== 'undefined'));
      if (usePromise) {
        return queue.wrapLoader(function(url) {
          return jsonld.promisify(loader, url);
        });
      }
      return queue.wrapLoader(loader);
      function loader(url, callback) {
        if (url.indexOf('http:') !== 0 && url.indexOf('https:') !== 0) {
          return callback(new JsonLdError('URL could not be dereferenced; only "http" and "https" URLs are ' + 'supported.', 'jsonld.InvalidUrl', {
            code: 'loading document failed',
            url: url
          }), {
            contextUrl: null,
            documentUrl: url,
            document: null
          });
        }
        if (options.secure && url.indexOf('https') !== 0) {
          return callback(new JsonLdError('URL could not be dereferenced; secure mode is enabled and ' + 'the URL\'s scheme is not "https".', 'jsonld.InvalidUrl', {
            code: 'loading document failed',
            url: url
          }), {
            contextUrl: null,
            documentUrl: url,
            document: null
          });
        }
        $.ajax({
          url: url,
          accepts: {json: 'application/ld+json, application/json'},
          headers: {'Accept': 'application/ld+json, application/json'},
          dataType: 'json',
          crossDomain: true,
          success: function(data, textStatus, jqXHR) {
            var doc = {
              contextUrl: null,
              documentUrl: url,
              document: data
            };
            var contentType = jqXHR.getResponseHeader('Content-Type');
            var linkHeader = jqXHR.getResponseHeader('Link');
            if (linkHeader && contentType !== 'application/ld+json') {
              linkHeader = jsonld.parseLinkHeader(linkHeader)[LINK_HEADER_REL];
              if (_isArray(linkHeader)) {
                return callback(new JsonLdError('URL could not be dereferenced, it has more than one ' + 'associated HTTP Link Header.', 'jsonld.InvalidUrl', {
                  code: 'multiple context link headers',
                  url: url
                }), doc);
              }
              if (linkHeader) {
                doc.contextUrl = linkHeader.target;
              }
            }
            callback(null, doc);
          },
          error: function(jqXHR, textStatus, err) {
            callback(new JsonLdError('URL could not be dereferenced, an error occurred.', 'jsonld.LoadDocumentError', {
              code: 'loading document failed',
              url: url,
              cause: err
            }), {
              contextUrl: null,
              documentUrl: url,
              document: null
            });
          }
        });
      }
    };
    jsonld.documentLoaders.node = function(options) {
      options = options || {};
      var strictSSL = ('strictSSL' in options) ? options.strictSSL : true;
      var maxRedirects = ('maxRedirects' in options) ? options.maxRedirects : -1;
      var request = require('request');
      var http = require('http');
      var cache = new jsonld.DocumentCache();
      var queue = new jsonld.RequestQueue();
      if (options.usePromise) {
        return queue.wrapLoader(function(url) {
          return jsonld.promisify(loadDocument, url, []);
        });
      }
      return queue.wrapLoader(function(url, callback) {
        loadDocument(url, [], callback);
      });
      function loadDocument(url, redirects, callback) {
        if (url.indexOf('http:') !== 0 && url.indexOf('https:') !== 0) {
          return callback(new JsonLdError('URL could not be dereferenced; only "http" and "https" URLs are ' + 'supported.', 'jsonld.InvalidUrl', {
            code: 'loading document failed',
            url: url
          }), {
            contextUrl: null,
            documentUrl: url,
            document: null
          });
        }
        if (options.secure && url.indexOf('https') !== 0) {
          return callback(new JsonLdError('URL could not be dereferenced; secure mode is enabled and ' + 'the URL\'s scheme is not "https".', 'jsonld.InvalidUrl', {
            code: 'loading document failed',
            url: url
          }), {
            contextUrl: null,
            documentUrl: url,
            document: null
          });
        }
        var doc = cache.get(url);
        if (doc !== null) {
          return callback(null, doc);
        }
        request({
          url: url,
          headers: {'Accept': 'application/ld+json, application/json'},
          strictSSL: strictSSL,
          followRedirect: false
        }, handleResponse);
        function handleResponse(err, res, body) {
          doc = {
            contextUrl: null,
            documentUrl: url,
            document: body || null
          };
          if (err) {
            return callback(new JsonLdError('URL could not be dereferenced, an error occurred.', 'jsonld.LoadDocumentError', {
              code: 'loading document failed',
              url: url,
              cause: err
            }), doc);
          }
          var statusText = http.STATUS_CODES[res.statusCode];
          if (res.statusCode >= 400) {
            return callback(new JsonLdError('URL could not be dereferenced: ' + statusText, 'jsonld.InvalidUrl', {
              code: 'loading document failed',
              url: url,
              httpStatusCode: res.statusCode
            }), doc);
          }
          if (res.headers.link && res.headers['content-type'] !== 'application/ld+json') {
            var linkHeader = jsonld.parseLinkHeader(res.headers.link)[LINK_HEADER_REL];
            if (_isArray(linkHeader)) {
              return callback(new JsonLdError('URL could not be dereferenced, it has more than one associated ' + 'HTTP Link Header.', 'jsonld.InvalidUrl', {
                code: 'multiple context link headers',
                url: url
              }), doc);
            }
            if (linkHeader) {
              doc.contextUrl = linkHeader.target;
            }
          }
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (redirects.length === maxRedirects) {
              return callback(new JsonLdError('URL could not be dereferenced; there were too many redirects.', 'jsonld.TooManyRedirects', {
                code: 'loading document failed',
                url: url,
                httpStatusCode: res.statusCode,
                redirects: redirects
              }), doc);
            }
            if (redirects.indexOf(url) !== -1) {
              return callback(new JsonLdError('URL could not be dereferenced; infinite redirection was detected.', 'jsonld.InfiniteRedirectDetected', {
                code: 'recursive context inclusion',
                url: url,
                httpStatusCode: res.statusCode,
                redirects: redirects
              }), doc);
            }
            redirects.push(url);
            return loadDocument(res.headers.location, redirects, callback);
          }
          redirects.push(url);
          for (var i = 0; i < redirects.length; ++i) {
            cache.set(redirects[i], {
              contextUrl: null,
              documentUrl: redirects[i],
              document: body
            });
          }
          callback(err, doc);
        }
      }
    };
    jsonld.documentLoaders.xhr = function(options) {
      options = options || {};
      var rlink = /(^|(\r\n))link:/i;
      var queue = new jsonld.RequestQueue();
      var usePromise = ('usePromise' in options ? options.usePromise : (typeof Promise !== 'undefined'));
      if (usePromise) {
        return queue.wrapLoader(function(url) {
          return jsonld.promisify(loader, url);
        });
      }
      return queue.wrapLoader(loader);
      function loader(url, callback) {
        if (url.indexOf('http:') !== 0 && url.indexOf('https:') !== 0) {
          return callback(new JsonLdError('URL could not be dereferenced; only "http" and "https" URLs are ' + 'supported.', 'jsonld.InvalidUrl', {
            code: 'loading document failed',
            url: url
          }), {
            contextUrl: null,
            documentUrl: url,
            document: null
          });
        }
        if (options.secure && url.indexOf('https') !== 0) {
          return callback(new JsonLdError('URL could not be dereferenced; secure mode is enabled and ' + 'the URL\'s scheme is not "https".', 'jsonld.InvalidUrl', {
            code: 'loading document failed',
            url: url
          }), {
            contextUrl: null,
            documentUrl: url,
            document: null
          });
        }
        var xhr = options.xhr || XMLHttpRequest;
        var req = new xhr();
        req.onload = function() {
          if (req.status >= 400) {
            return callback(new JsonLdError('URL could not be dereferenced: ' + req.statusText, 'jsonld.LoadDocumentError', {
              code: 'loading document failed',
              url: url,
              httpStatusCode: req.status
            }), {
              contextUrl: null,
              documentUrl: url,
              document: null
            });
          }
          var doc = {
            contextUrl: null,
            documentUrl: url,
            document: req.response
          };
          var contentType = req.getResponseHeader('Content-Type');
          var linkHeader;
          if (rlink.test(req.getAllResponseHeaders())) {
            linkHeader = req.getResponseHeader('Link');
          }
          if (linkHeader && contentType !== 'application/ld+json') {
            linkHeader = jsonld.parseLinkHeader(linkHeader)[LINK_HEADER_REL];
            if (_isArray(linkHeader)) {
              return callback(new JsonLdError('URL could not be dereferenced, it has more than one ' + 'associated HTTP Link Header.', 'jsonld.InvalidUrl', {
                code: 'multiple context link headers',
                url: url
              }), doc);
            }
            if (linkHeader) {
              doc.contextUrl = linkHeader.target;
            }
          }
          callback(null, doc);
        };
        req.onerror = function() {
          callback(new JsonLdError('URL could not be dereferenced, an error occurred.', 'jsonld.LoadDocumentError', {
            code: 'loading document failed',
            url: url
          }), {
            contextUrl: null,
            documentUrl: url,
            document: null
          });
        };
        req.open('GET', url, true);
        req.setRequestHeader('Accept', 'application/ld+json, application/json');
        req.send();
      }
    };
    jsonld.useDocumentLoader = function(type) {
      if (!(type in jsonld.documentLoaders)) {
        throw new JsonLdError('Unknown document loader type: "' + type + '"', 'jsonld.UnknownDocumentLoader', {type: type});
      }
      jsonld.documentLoader = jsonld.documentLoaders[type].apply(jsonld, Array.prototype.slice.call(arguments, 1));
    };
    jsonld.processContext = function(activeCtx, localCtx) {
      var options = {};
      var callbackArg = 2;
      if (arguments.length > 3) {
        options = arguments[2] || {};
        callbackArg += 1;
      }
      var callback = arguments[callbackArg];
      if (!('base' in options)) {
        options.base = '';
      }
      if (!('documentLoader' in options)) {
        options.documentLoader = jsonld.loadDocument;
      }
      if (localCtx === null) {
        return callback(null, _getInitialContext(options));
      }
      localCtx = _clone(localCtx);
      if (!(_isObject(localCtx) && '@context' in localCtx)) {
        localCtx = {'@context': localCtx};
      }
      _retrieveContextUrls(localCtx, options, function(err, ctx) {
        if (err) {
          return callback(err);
        }
        try {
          ctx = new Processor().processContext(activeCtx, ctx, options);
        } catch (ex) {
          return callback(ex);
        }
        callback(null, ctx);
      });
    };
    jsonld.hasProperty = function(subject, property) {
      var rval = false;
      if (property in subject) {
        var value = subject[property];
        rval = (!_isArray(value) || value.length > 0);
      }
      return rval;
    };
    jsonld.hasValue = function(subject, property, value) {
      var rval = false;
      if (jsonld.hasProperty(subject, property)) {
        var val = subject[property];
        var isList = _isList(val);
        if (_isArray(val) || isList) {
          if (isList) {
            val = val['@list'];
          }
          for (var i = 0; i < val.length; ++i) {
            if (jsonld.compareValues(value, val[i])) {
              rval = true;
              break;
            }
          }
        } else if (!_isArray(value)) {
          rval = jsonld.compareValues(value, val);
        }
      }
      return rval;
    };
    jsonld.addValue = function(subject, property, value, options) {
      options = options || {};
      if (!('propertyIsArray' in options)) {
        options.propertyIsArray = false;
      }
      if (!('allowDuplicate' in options)) {
        options.allowDuplicate = true;
      }
      if (_isArray(value)) {
        if (value.length === 0 && options.propertyIsArray && !(property in subject)) {
          subject[property] = [];
        }
        for (var i = 0; i < value.length; ++i) {
          jsonld.addValue(subject, property, value[i], options);
        }
      } else if (property in subject) {
        var hasValue = (!options.allowDuplicate && jsonld.hasValue(subject, property, value));
        if (!_isArray(subject[property]) && (!hasValue || options.propertyIsArray)) {
          subject[property] = [subject[property]];
        }
        if (!hasValue) {
          subject[property].push(value);
        }
      } else {
        subject[property] = options.propertyIsArray ? [value] : value;
      }
    };
    jsonld.getValues = function(subject, property) {
      var rval = subject[property] || [];
      if (!_isArray(rval)) {
        rval = [rval];
      }
      return rval;
    };
    jsonld.removeProperty = function(subject, property) {
      delete subject[property];
    };
    jsonld.removeValue = function(subject, property, value, options) {
      options = options || {};
      if (!('propertyIsArray' in options)) {
        options.propertyIsArray = false;
      }
      var values = jsonld.getValues(subject, property).filter(function(e) {
        return !jsonld.compareValues(e, value);
      });
      if (values.length === 0) {
        jsonld.removeProperty(subject, property);
      } else if (values.length === 1 && !options.propertyIsArray) {
        subject[property] = values[0];
      } else {
        subject[property] = values;
      }
    };
    jsonld.compareValues = function(v1, v2) {
      if (v1 === v2) {
        return true;
      }
      if (_isValue(v1) && _isValue(v2) && v1['@value'] === v2['@value'] && v1['@type'] === v2['@type'] && v1['@language'] === v2['@language'] && v1['@index'] === v2['@index']) {
        return true;
      }
      if (_isObject(v1) && ('@id' in v1) && _isObject(v2) && ('@id' in v2)) {
        return v1['@id'] === v2['@id'];
      }
      return false;
    };
    jsonld.getContextValue = function(ctx, key, type) {
      var rval = null;
      if (key === null) {
        return rval;
      }
      if (type === '@language' && (type in ctx)) {
        rval = ctx[type];
      }
      if (ctx.mappings[key]) {
        var entry = ctx.mappings[key];
        if (_isUndefined(type)) {
          rval = entry;
        } else if (type in entry) {
          rval = entry[type];
        }
      }
      return rval;
    };
    var _rdfParsers = {};
    jsonld.registerRDFParser = function(contentType, parser) {
      _rdfParsers[contentType] = parser;
    };
    jsonld.unregisterRDFParser = function(contentType) {
      delete _rdfParsers[contentType];
    };
    if (_nodejs) {
      if (typeof XMLSerializer === 'undefined') {
        var XMLSerializer = null;
      }
      if (typeof Node === 'undefined') {
        var Node = {
          ELEMENT_NODE: 1,
          ATTRIBUTE_NODE: 2,
          TEXT_NODE: 3,
          CDATA_SECTION_NODE: 4,
          ENTITY_REFERENCE_NODE: 5,
          ENTITY_NODE: 6,
          PROCESSING_INSTRUCTION_NODE: 7,
          COMMENT_NODE: 8,
          DOCUMENT_NODE: 9,
          DOCUMENT_TYPE_NODE: 10,
          DOCUMENT_FRAGMENT_NODE: 11,
          NOTATION_NODE: 12
        };
      }
    }
    var XSD_BOOLEAN = 'http://www.w3.org/2001/XMLSchema#boolean';
    var XSD_DOUBLE = 'http://www.w3.org/2001/XMLSchema#double';
    var XSD_INTEGER = 'http://www.w3.org/2001/XMLSchema#integer';
    var XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';
    var RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
    var RDF_LIST = RDF + 'List';
    var RDF_FIRST = RDF + 'first';
    var RDF_REST = RDF + 'rest';
    var RDF_NIL = RDF + 'nil';
    var RDF_TYPE = RDF + 'type';
    var RDF_PLAIN_LITERAL = RDF + 'PlainLiteral';
    var RDF_XML_LITERAL = RDF + 'XMLLiteral';
    var RDF_OBJECT = RDF + 'object';
    var RDF_LANGSTRING = RDF + 'langString';
    var LINK_HEADER_REL = 'http://www.w3.org/ns/json-ld#context';
    var MAX_CONTEXT_URLS = 10;
    var JsonLdError = function(msg, type, details) {
      if (_nodejs) {
        Error.call(this);
        Error.captureStackTrace(this, this.constructor);
      } else if (typeof Error !== 'undefined') {
        this.stack = (new Error()).stack;
      }
      this.name = type || 'jsonld.Error';
      this.message = msg || 'An unspecified JSON-LD error occurred.';
      this.details = details || {};
    };
    if (_nodejs) {
      require('util').inherits(JsonLdError, Error);
    } else if (typeof Error !== 'undefined') {
      JsonLdError.prototype = new Error();
    }
    var Processor = function() {};
    Processor.prototype.compact = function(activeCtx, activeProperty, element, options) {
      if (_isArray(element)) {
        var rval = [];
        for (var i = 0; i < element.length; ++i) {
          var compacted = this.compact(activeCtx, activeProperty, element[i], options);
          if (compacted !== null) {
            rval.push(compacted);
          }
        }
        if (options.compactArrays && rval.length === 1) {
          var container = jsonld.getContextValue(activeCtx, activeProperty, '@container');
          if (container === null) {
            rval = rval[0];
          }
        }
        return rval;
      }
      if (_isObject(element)) {
        if (options.link && '@id' in element && element['@id'] in options.link) {
          var linked = options.link[element['@id']];
          for (var i = 0; i < linked.length; ++i) {
            if (linked[i].expanded === element) {
              return linked[i].compacted;
            }
          }
        }
        if (_isValue(element) || _isSubjectReference(element)) {
          var rval = _compactValue(activeCtx, activeProperty, element);
          if (options.link && _isSubjectReference(element)) {
            if (!(element['@id'] in options.link)) {
              options.link[element['@id']] = [];
            }
            options.link[element['@id']].push({
              expanded: element,
              compacted: rval
            });
          }
          return rval;
        }
        var insideReverse = (activeProperty === '@reverse');
        var rval = {};
        if (options.link && '@id' in element) {
          if (!(element['@id'] in options.link)) {
            options.link[element['@id']] = [];
          }
          options.link[element['@id']].push({
            expanded: element,
            compacted: rval
          });
        }
        var keys = Object.keys(element).sort();
        for (var ki = 0; ki < keys.length; ++ki) {
          var expandedProperty = keys[ki];
          var expandedValue = element[expandedProperty];
          if (expandedProperty === '@id' || expandedProperty === '@type') {
            var compactedValue;
            if (_isString(expandedValue)) {
              compactedValue = _compactIri(activeCtx, expandedValue, null, {vocab: (expandedProperty === '@type')});
            } else {
              compactedValue = [];
              for (var vi = 0; vi < expandedValue.length; ++vi) {
                compactedValue.push(_compactIri(activeCtx, expandedValue[vi], null, {vocab: true}));
              }
            }
            var alias = _compactIri(activeCtx, expandedProperty);
            var isArray = (_isArray(compactedValue) && expandedValue.length === 0);
            jsonld.addValue(rval, alias, compactedValue, {propertyIsArray: isArray});
            continue;
          }
          if (expandedProperty === '@reverse') {
            var compactedValue = this.compact(activeCtx, '@reverse', expandedValue, options);
            for (var compactedProperty in compactedValue) {
              if (activeCtx.mappings[compactedProperty] && activeCtx.mappings[compactedProperty].reverse) {
                var value = compactedValue[compactedProperty];
                var container = jsonld.getContextValue(activeCtx, compactedProperty, '@container');
                var useArray = (container === '@set' || !options.compactArrays);
                jsonld.addValue(rval, compactedProperty, value, {propertyIsArray: useArray});
                delete compactedValue[compactedProperty];
              }
            }
            if (Object.keys(compactedValue).length > 0) {
              var alias = _compactIri(activeCtx, expandedProperty);
              jsonld.addValue(rval, alias, compactedValue);
            }
            continue;
          }
          if (expandedProperty === '@index') {
            var container = jsonld.getContextValue(activeCtx, activeProperty, '@container');
            if (container === '@index') {
              continue;
            }
            var alias = _compactIri(activeCtx, expandedProperty);
            jsonld.addValue(rval, alias, expandedValue);
            continue;
          }
          if (expandedProperty !== '@graph' && expandedProperty !== '@list' && _isKeyword(expandedProperty)) {
            var alias = _compactIri(activeCtx, expandedProperty);
            jsonld.addValue(rval, alias, expandedValue);
            continue;
          }
          if (expandedValue.length === 0) {
            var itemActiveProperty = _compactIri(activeCtx, expandedProperty, expandedValue, {vocab: true}, insideReverse);
            jsonld.addValue(rval, itemActiveProperty, expandedValue, {propertyIsArray: true});
          }
          for (var vi = 0; vi < expandedValue.length; ++vi) {
            var expandedItem = expandedValue[vi];
            var itemActiveProperty = _compactIri(activeCtx, expandedProperty, expandedItem, {vocab: true}, insideReverse);
            var container = jsonld.getContextValue(activeCtx, itemActiveProperty, '@container');
            var isList = _isList(expandedItem);
            var list = null;
            if (isList) {
              list = expandedItem['@list'];
            }
            var compactedItem = this.compact(activeCtx, itemActiveProperty, isList ? list : expandedItem, options);
            if (isList) {
              if (!_isArray(compactedItem)) {
                compactedItem = [compactedItem];
              }
              if (container !== '@list') {
                var wrapper = {};
                wrapper[_compactIri(activeCtx, '@list')] = compactedItem;
                compactedItem = wrapper;
                if ('@index' in expandedItem) {
                  compactedItem[_compactIri(activeCtx, '@index')] = expandedItem['@index'];
                }
              } else if (itemActiveProperty in rval) {
                throw new JsonLdError('JSON-LD compact error; property has a "@list" @container ' + 'rule but there is more than a single @list that matches ' + 'the compacted term in the document. Compaction might mix ' + 'unwanted items into the list.', 'jsonld.SyntaxError', {code: 'compaction to list of lists'});
              }
            }
            if (container === '@language' || container === '@index') {
              var mapObject;
              if (itemActiveProperty in rval) {
                mapObject = rval[itemActiveProperty];
              } else {
                rval[itemActiveProperty] = mapObject = {};
              }
              if (container === '@language' && _isValue(compactedItem)) {
                compactedItem = compactedItem['@value'];
              }
              jsonld.addValue(mapObject, expandedItem[container], compactedItem);
            } else {
              var isArray = (!options.compactArrays || container === '@set' || container === '@list' || (_isArray(compactedItem) && compactedItem.length === 0) || expandedProperty === '@list' || expandedProperty === '@graph');
              jsonld.addValue(rval, itemActiveProperty, compactedItem, {propertyIsArray: isArray});
            }
          }
        }
        return rval;
      }
      return element;
    };
    Processor.prototype.expand = function(activeCtx, activeProperty, element, options, insideList) {
      var self = this;
      if (element === null || element === undefined) {
        return null;
      }
      if (!_isArray(element) && !_isObject(element)) {
        if (!insideList && (activeProperty === null || _expandIri(activeCtx, activeProperty, {vocab: true}) === '@graph')) {
          return null;
        }
        return _expandValue(activeCtx, activeProperty, element);
      }
      if (_isArray(element)) {
        var rval = [];
        var container = jsonld.getContextValue(activeCtx, activeProperty, '@container');
        insideList = insideList || container === '@list';
        for (var i = 0; i < element.length; ++i) {
          var e = self.expand(activeCtx, activeProperty, element[i], options);
          if (insideList && (_isArray(e) || _isList(e))) {
            throw new JsonLdError('Invalid JSON-LD syntax; lists of lists are not permitted.', 'jsonld.SyntaxError', {code: 'list of lists'});
          }
          if (e !== null) {
            if (_isArray(e)) {
              rval = rval.concat(e);
            } else {
              rval.push(e);
            }
          }
        }
        return rval;
      }
      if ('@context' in element) {
        activeCtx = self.processContext(activeCtx, element['@context'], options);
      }
      var expandedActiveProperty = _expandIri(activeCtx, activeProperty, {vocab: true});
      var rval = {};
      var keys = Object.keys(element).sort();
      for (var ki = 0; ki < keys.length; ++ki) {
        var key = keys[ki];
        var value = element[key];
        var expandedValue;
        if (key === '@context') {
          continue;
        }
        var expandedProperty = _expandIri(activeCtx, key, {vocab: true});
        if (expandedProperty === null || !(_isAbsoluteIri(expandedProperty) || _isKeyword(expandedProperty))) {
          continue;
        }
        if (_isKeyword(expandedProperty)) {
          if (expandedActiveProperty === '@reverse') {
            throw new JsonLdError('Invalid JSON-LD syntax; a keyword cannot be used as a @reverse ' + 'property.', 'jsonld.SyntaxError', {
              code: 'invalid reverse property map',
              value: value
            });
          }
          if (expandedProperty in rval) {
            throw new JsonLdError('Invalid JSON-LD syntax; colliding keywords detected.', 'jsonld.SyntaxError', {
              code: 'colliding keywords',
              keyword: expandedProperty
            });
          }
        }
        if (expandedProperty === '@id' && !_isString(value)) {
          if (!options.isFrame) {
            throw new JsonLdError('Invalid JSON-LD syntax; "@id" value must a string.', 'jsonld.SyntaxError', {
              code: 'invalid @id value',
              value: value
            });
          }
          if (!_isObject(value)) {
            throw new JsonLdError('Invalid JSON-LD syntax; "@id" value must be a string or an ' + 'object.', 'jsonld.SyntaxError', {
              code: 'invalid @id value',
              value: value
            });
          }
        }
        if (expandedProperty === '@type') {
          _validateTypeValue(value);
        }
        if (expandedProperty === '@graph' && !(_isObject(value) || _isArray(value))) {
          throw new JsonLdError('Invalid JSON-LD syntax; "@graph" value must not be an ' + 'object or an array.', 'jsonld.SyntaxError', {
            code: 'invalid @graph value',
            value: value
          });
        }
        if (expandedProperty === '@value' && (_isObject(value) || _isArray(value))) {
          throw new JsonLdError('Invalid JSON-LD syntax; "@value" value must not be an ' + 'object or an array.', 'jsonld.SyntaxError', {
            code: 'invalid value object value',
            value: value
          });
        }
        if (expandedProperty === '@language') {
          if (value === null) {
            continue;
          }
          if (!_isString(value)) {
            throw new JsonLdError('Invalid JSON-LD syntax; "@language" value must be a string.', 'jsonld.SyntaxError', {
              code: 'invalid language-tagged string',
              value: value
            });
          }
          value = value.toLowerCase();
        }
        if (expandedProperty === '@index') {
          if (!_isString(value)) {
            throw new JsonLdError('Invalid JSON-LD syntax; "@index" value must be a string.', 'jsonld.SyntaxError', {
              code: 'invalid @index value',
              value: value
            });
          }
        }
        if (expandedProperty === '@reverse') {
          if (!_isObject(value)) {
            throw new JsonLdError('Invalid JSON-LD syntax; "@reverse" value must be an object.', 'jsonld.SyntaxError', {
              code: 'invalid @reverse value',
              value: value
            });
          }
          expandedValue = self.expand(activeCtx, '@reverse', value, options);
          if ('@reverse' in expandedValue) {
            for (var property in expandedValue['@reverse']) {
              jsonld.addValue(rval, property, expandedValue['@reverse'][property], {propertyIsArray: true});
            }
          }
          var reverseMap = rval['@reverse'] || null;
          for (var property in expandedValue) {
            if (property === '@reverse') {
              continue;
            }
            if (reverseMap === null) {
              reverseMap = rval['@reverse'] = {};
            }
            jsonld.addValue(reverseMap, property, [], {propertyIsArray: true});
            var items = expandedValue[property];
            for (var ii = 0; ii < items.length; ++ii) {
              var item = items[ii];
              if (_isValue(item) || _isList(item)) {
                throw new JsonLdError('Invalid JSON-LD syntax; "@reverse" value must not be a ' + '@value or an @list.', 'jsonld.SyntaxError', {
                  code: 'invalid reverse property value',
                  value: expandedValue
                });
              }
              jsonld.addValue(reverseMap, property, item, {propertyIsArray: true});
            }
          }
          continue;
        }
        var container = jsonld.getContextValue(activeCtx, key, '@container');
        if (container === '@language' && _isObject(value)) {
          expandedValue = _expandLanguageMap(value);
        } else if (container === '@index' && _isObject(value)) {
          expandedValue = (function _expandIndexMap(activeProperty) {
            var rval = [];
            var keys = Object.keys(value).sort();
            for (var ki = 0; ki < keys.length; ++ki) {
              var key = keys[ki];
              var val = value[key];
              if (!_isArray(val)) {
                val = [val];
              }
              val = self.expand(activeCtx, activeProperty, val, options, false);
              for (var vi = 0; vi < val.length; ++vi) {
                var item = val[vi];
                if (!('@index' in item)) {
                  item['@index'] = key;
                }
                rval.push(item);
              }
            }
            return rval;
          })(key);
        } else {
          var isList = (expandedProperty === '@list');
          if (isList || expandedProperty === '@set') {
            var nextActiveProperty = activeProperty;
            if (isList && expandedActiveProperty === '@graph') {
              nextActiveProperty = null;
            }
            expandedValue = self.expand(activeCtx, nextActiveProperty, value, options, isList);
            if (isList && _isList(expandedValue)) {
              throw new JsonLdError('Invalid JSON-LD syntax; lists of lists are not permitted.', 'jsonld.SyntaxError', {code: 'list of lists'});
            }
          } else {
            expandedValue = self.expand(activeCtx, key, value, options, false);
          }
        }
        if (expandedValue === null && expandedProperty !== '@value') {
          continue;
        }
        if (expandedProperty !== '@list' && !_isList(expandedValue) && container === '@list') {
          expandedValue = (_isArray(expandedValue) ? expandedValue : [expandedValue]);
          expandedValue = {'@list': expandedValue};
        }
        if (activeCtx.mappings[key] && activeCtx.mappings[key].reverse) {
          var reverseMap = rval['@reverse'] = rval['@reverse'] || {};
          if (!_isArray(expandedValue)) {
            expandedValue = [expandedValue];
          }
          for (var ii = 0; ii < expandedValue.length; ++ii) {
            var item = expandedValue[ii];
            if (_isValue(item) || _isList(item)) {
              throw new JsonLdError('Invalid JSON-LD syntax; "@reverse" value must not be a ' + '@value or an @list.', 'jsonld.SyntaxError', {
                code: 'invalid reverse property value',
                value: expandedValue
              });
            }
            jsonld.addValue(reverseMap, expandedProperty, item, {propertyIsArray: true});
          }
          continue;
        }
        var useArray = ['@index', '@id', '@type', '@value', '@language'].indexOf(expandedProperty) === -1;
        jsonld.addValue(rval, expandedProperty, expandedValue, {propertyIsArray: useArray});
      }
      keys = Object.keys(rval);
      var count = keys.length;
      if ('@value' in rval) {
        if ('@type' in rval && '@language' in rval) {
          throw new JsonLdError('Invalid JSON-LD syntax; an element containing "@value" may not ' + 'contain both "@type" and "@language".', 'jsonld.SyntaxError', {
            code: 'invalid value object',
            element: rval
          });
        }
        var validCount = count - 1;
        if ('@type' in rval) {
          validCount -= 1;
        }
        if ('@index' in rval) {
          validCount -= 1;
        }
        if ('@language' in rval) {
          validCount -= 1;
        }
        if (validCount !== 0) {
          throw new JsonLdError('Invalid JSON-LD syntax; an element containing "@value" may only ' + 'have an "@index" property and at most one other property ' + 'which can be "@type" or "@language".', 'jsonld.SyntaxError', {
            code: 'invalid value object',
            element: rval
          });
        }
        if (rval['@value'] === null) {
          rval = null;
        } else if ('@language' in rval && !_isString(rval['@value'])) {
          throw new JsonLdError('Invalid JSON-LD syntax; only strings may be language-tagged.', 'jsonld.SyntaxError', {
            code: 'invalid language-tagged value',
            element: rval
          });
        } else if ('@type' in rval && (!_isAbsoluteIri(rval['@type']) || rval['@type'].indexOf('_:') === 0)) {
          throw new JsonLdError('Invalid JSON-LD syntax; an element containing "@value" and "@type" ' + 'must have an absolute IRI for the value of "@type".', 'jsonld.SyntaxError', {
            code: 'invalid typed value',
            element: rval
          });
        }
      } else if ('@type' in rval && !_isArray(rval['@type'])) {
        rval['@type'] = [rval['@type']];
      } else if ('@set' in rval || '@list' in rval) {
        if (count > 1 && !(count === 2 && '@index' in rval)) {
          throw new JsonLdError('Invalid JSON-LD syntax; if an element has the property "@set" ' + 'or "@list", then it can have at most one other property that is ' + '"@index".', 'jsonld.SyntaxError', {
            code: 'invalid set or list object',
            element: rval
          });
        }
        if ('@set' in rval) {
          rval = rval['@set'];
          keys = Object.keys(rval);
          count = keys.length;
        }
      } else if (count === 1 && '@language' in rval) {
        rval = null;
      }
      if (_isObject(rval) && !options.keepFreeFloatingNodes && !insideList && (activeProperty === null || expandedActiveProperty === '@graph')) {
        if (count === 0 || '@value' in rval || '@list' in rval || (count === 1 && '@id' in rval)) {
          rval = null;
        }
      }
      return rval;
    };
    Processor.prototype.createNodeMap = function(input, options) {
      options = options || {};
      var issuer = options.namer || options.issuer || new IdentifierIssuer('_:b');
      var graphs = {'@default': {}};
      _createNodeMap(input, graphs, '@default', issuer);
      return _mergeNodeMaps(graphs);
    };
    Processor.prototype.flatten = function(input) {
      var defaultGraph = this.createNodeMap(input);
      var flattened = [];
      var keys = Object.keys(defaultGraph).sort();
      for (var ki = 0; ki < keys.length; ++ki) {
        var node = defaultGraph[keys[ki]];
        if (!_isSubjectReference(node)) {
          flattened.push(node);
        }
      }
      return flattened;
    };
    Processor.prototype.frame = function(input, frame, options) {
      var state = {
        options: options,
        graphs: {
          '@default': {},
          '@merged': {}
        },
        subjectStack: [],
        link: {}
      };
      var issuer = new IdentifierIssuer('_:b');
      _createNodeMap(input, state.graphs, '@merged', issuer);
      state.subjects = state.graphs['@merged'];
      var framed = [];
      _frame(state, Object.keys(state.subjects).sort(), frame, framed, null);
      return framed;
    };
    Processor.prototype.normalize = function(dataset, options, callback) {
      if (options.algorithm === 'URDNA2015') {
        return new URDNA2015(options).main(dataset, callback);
      }
      if (options.algorithm === 'URGNA2012') {
        return new URGNA2012(options).main(dataset, callback);
      }
      callback(new Error('Invalid RDF Dataset Normalization algorithm: ' + options.algorithm));
    };
    Processor.prototype.fromRDF = function(dataset, options, callback) {
      var defaultGraph = {};
      var graphMap = {'@default': defaultGraph};
      var referencedOnce = {};
      for (var name in dataset) {
        var graph = dataset[name];
        if (!(name in graphMap)) {
          graphMap[name] = {};
        }
        if (name !== '@default' && !(name in defaultGraph)) {
          defaultGraph[name] = {'@id': name};
        }
        var nodeMap = graphMap[name];
        for (var ti = 0; ti < graph.length; ++ti) {
          var triple = graph[ti];
          var s = triple.subject.value;
          var p = triple.predicate.value;
          var o = triple.object;
          if (!(s in nodeMap)) {
            nodeMap[s] = {'@id': s};
          }
          var node = nodeMap[s];
          var objectIsId = (o.type === 'IRI' || o.type === 'blank node');
          if (objectIsId && !(o.value in nodeMap)) {
            nodeMap[o.value] = {'@id': o.value};
          }
          if (p === RDF_TYPE && !options.useRdfType && objectIsId) {
            jsonld.addValue(node, '@type', o.value, {propertyIsArray: true});
            continue;
          }
          var value = _RDFToObject(o, options.useNativeTypes);
          jsonld.addValue(node, p, value, {propertyIsArray: true});
          if (objectIsId) {
            if (o.value === RDF_NIL) {
              var object = nodeMap[o.value];
              if (!('usages' in object)) {
                object.usages = [];
              }
              object.usages.push({
                node: node,
                property: p,
                value: value
              });
            } else if (o.value in referencedOnce) {
              referencedOnce[o.value] = false;
            } else {
              referencedOnce[o.value] = {
                node: node,
                property: p,
                value: value
              };
            }
          }
        }
      }
      for (var name in graphMap) {
        var graphObject = graphMap[name];
        if (!(RDF_NIL in graphObject)) {
          continue;
        }
        var nil = graphObject[RDF_NIL];
        for (var i = 0; i < nil.usages.length; ++i) {
          var usage = nil.usages[i];
          var node = usage.node;
          var property = usage.property;
          var head = usage.value;
          var list = [];
          var listNodes = [];
          var nodeKeyCount = Object.keys(node).length;
          while (property === RDF_REST && _isObject(referencedOnce[node['@id']]) && _isArray(node[RDF_FIRST]) && node[RDF_FIRST].length === 1 && _isArray(node[RDF_REST]) && node[RDF_REST].length === 1 && (nodeKeyCount === 3 || (nodeKeyCount === 4 && _isArray(node['@type']) && node['@type'].length === 1 && node['@type'][0] === RDF_LIST))) {
            list.push(node[RDF_FIRST][0]);
            listNodes.push(node['@id']);
            usage = referencedOnce[node['@id']];
            node = usage.node;
            property = usage.property;
            head = usage.value;
            nodeKeyCount = Object.keys(node).length;
            if (node['@id'].indexOf('_:') !== 0) {
              break;
            }
          }
          if (property === RDF_FIRST) {
            if (node['@id'] === RDF_NIL) {
              continue;
            }
            head = graphObject[head['@id']][RDF_REST][0];
            list.pop();
            listNodes.pop();
          }
          delete head['@id'];
          head['@list'] = list.reverse();
          for (var j = 0; j < listNodes.length; ++j) {
            delete graphObject[listNodes[j]];
          }
        }
        delete nil.usages;
      }
      var result = [];
      var subjects = Object.keys(defaultGraph).sort();
      for (var i = 0; i < subjects.length; ++i) {
        var subject = subjects[i];
        var node = defaultGraph[subject];
        if (subject in graphMap) {
          var graph = node['@graph'] = [];
          var graphObject = graphMap[subject];
          var subjects_ = Object.keys(graphObject).sort();
          for (var si = 0; si < subjects_.length; ++si) {
            var node_ = graphObject[subjects_[si]];
            if (!_isSubjectReference(node_)) {
              graph.push(node_);
            }
          }
        }
        if (!_isSubjectReference(node)) {
          result.push(node);
        }
      }
      callback(null, result);
    };
    Processor.prototype.toRDF = function(input, options) {
      var issuer = new IdentifierIssuer('_:b');
      var nodeMap = {'@default': {}};
      _createNodeMap(input, nodeMap, '@default', issuer);
      var dataset = {};
      var graphNames = Object.keys(nodeMap).sort();
      for (var i = 0; i < graphNames.length; ++i) {
        var graphName = graphNames[i];
        if (graphName === '@default' || _isAbsoluteIri(graphName)) {
          dataset[graphName] = _graphToRDF(nodeMap[graphName], issuer, options);
        }
      }
      return dataset;
    };
    Processor.prototype.processContext = function(activeCtx, localCtx, options) {
      if (_isObject(localCtx) && '@context' in localCtx && _isArray(localCtx['@context'])) {
        localCtx = localCtx['@context'];
      }
      var ctxs = _isArray(localCtx) ? localCtx : [localCtx];
      if (ctxs.length === 0) {
        return activeCtx.clone();
      }
      var rval = activeCtx;
      for (var i = 0; i < ctxs.length; ++i) {
        var ctx = ctxs[i];
        if (ctx === null) {
          rval = activeCtx = _getInitialContext(options);
          continue;
        }
        if (_isObject(ctx) && '@context' in ctx) {
          ctx = ctx['@context'];
        }
        if (!_isObject(ctx)) {
          throw new JsonLdError('Invalid JSON-LD syntax; @context must be an object.', 'jsonld.SyntaxError', {
            code: 'invalid local context',
            context: ctx
          });
        }
        if (jsonld.cache.activeCtx) {
          var cached = jsonld.cache.activeCtx.get(activeCtx, ctx);
          if (cached) {
            rval = activeCtx = cached;
            continue;
          }
        }
        activeCtx = rval;
        rval = rval.clone();
        var defined = {};
        if ('@base' in ctx) {
          var base = ctx['@base'];
          if (base === null) {
            base = null;
          } else if (!_isString(base)) {
            throw new JsonLdError('Invalid JSON-LD syntax; the value of "@base" in a ' + '@context must be a string or null.', 'jsonld.SyntaxError', {
              code: 'invalid base IRI',
              context: ctx
            });
          } else if (base !== '' && !_isAbsoluteIri(base)) {
            throw new JsonLdError('Invalid JSON-LD syntax; the value of "@base" in a ' + '@context must be an absolute IRI or the empty string.', 'jsonld.SyntaxError', {
              code: 'invalid base IRI',
              context: ctx
            });
          }
          if (base !== null) {
            base = jsonld.url.parse(base || '');
          }
          rval['@base'] = base;
          defined['@base'] = true;
        }
        if ('@vocab' in ctx) {
          var value = ctx['@vocab'];
          if (value === null) {
            delete rval['@vocab'];
          } else if (!_isString(value)) {
            throw new JsonLdError('Invalid JSON-LD syntax; the value of "@vocab" in a ' + '@context must be a string or null.', 'jsonld.SyntaxError', {
              code: 'invalid vocab mapping',
              context: ctx
            });
          } else if (!_isAbsoluteIri(value)) {
            throw new JsonLdError('Invalid JSON-LD syntax; the value of "@vocab" in a ' + '@context must be an absolute IRI.', 'jsonld.SyntaxError', {
              code: 'invalid vocab mapping',
              context: ctx
            });
          } else {
            rval['@vocab'] = value;
          }
          defined['@vocab'] = true;
        }
        if ('@language' in ctx) {
          var value = ctx['@language'];
          if (value === null) {
            delete rval['@language'];
          } else if (!_isString(value)) {
            throw new JsonLdError('Invalid JSON-LD syntax; the value of "@language" in a ' + '@context must be a string or null.', 'jsonld.SyntaxError', {
              code: 'invalid default language',
              context: ctx
            });
          } else {
            rval['@language'] = value.toLowerCase();
          }
          defined['@language'] = true;
        }
        for (var key in ctx) {
          _createTermDefinition(rval, ctx, key, defined);
        }
        if (jsonld.cache.activeCtx) {
          jsonld.cache.activeCtx.set(activeCtx, ctx, rval);
        }
      }
      return rval;
    };
    function _expandLanguageMap(languageMap) {
      var rval = [];
      var keys = Object.keys(languageMap).sort();
      for (var ki = 0; ki < keys.length; ++ki) {
        var key = keys[ki];
        var val = languageMap[key];
        if (!_isArray(val)) {
          val = [val];
        }
        for (var vi = 0; vi < val.length; ++vi) {
          var item = val[vi];
          if (item === null) {
            continue;
          }
          if (!_isString(item)) {
            throw new JsonLdError('Invalid JSON-LD syntax; language map values must be strings.', 'jsonld.SyntaxError', {
              code: 'invalid language map value',
              languageMap: languageMap
            });
          }
          rval.push({
            '@value': item,
            '@language': key.toLowerCase()
          });
        }
      }
      return rval;
    }
    function _labelBlankNodes(issuer, element) {
      if (_isArray(element)) {
        for (var i = 0; i < element.length; ++i) {
          element[i] = _labelBlankNodes(issuer, element[i]);
        }
      } else if (_isList(element)) {
        element['@list'] = _labelBlankNodes(issuer, element['@list']);
      } else if (_isObject(element)) {
        if (_isBlankNode(element)) {
          element['@id'] = issuer.getId(element['@id']);
        }
        var keys = Object.keys(element).sort();
        for (var ki = 0; ki < keys.length; ++ki) {
          var key = keys[ki];
          if (key !== '@id') {
            element[key] = _labelBlankNodes(issuer, element[key]);
          }
        }
      }
      return element;
    }
    function _expandValue(activeCtx, activeProperty, value) {
      if (value === null || value === undefined) {
        return null;
      }
      var expandedProperty = _expandIri(activeCtx, activeProperty, {vocab: true});
      if (expandedProperty === '@id') {
        return _expandIri(activeCtx, value, {base: true});
      } else if (expandedProperty === '@type') {
        return _expandIri(activeCtx, value, {
          vocab: true,
          base: true
        });
      }
      var type = jsonld.getContextValue(activeCtx, activeProperty, '@type');
      if (type === '@id' || (expandedProperty === '@graph' && _isString(value))) {
        return {'@id': _expandIri(activeCtx, value, {base: true})};
      }
      if (type === '@vocab') {
        return {'@id': _expandIri(activeCtx, value, {
            vocab: true,
            base: true
          })};
      }
      if (_isKeyword(expandedProperty)) {
        return value;
      }
      var rval = {};
      if (type !== null) {
        rval['@type'] = type;
      } else if (_isString(value)) {
        var language = jsonld.getContextValue(activeCtx, activeProperty, '@language');
        if (language !== null) {
          rval['@language'] = language;
        }
      }
      if (['boolean', 'number', 'string'].indexOf(typeof value) === -1) {
        value = value.toString();
      }
      rval['@value'] = value;
      return rval;
    }
    function _graphToRDF(graph, issuer, options) {
      var rval = [];
      var ids = Object.keys(graph).sort();
      for (var i = 0; i < ids.length; ++i) {
        var id = ids[i];
        var node = graph[id];
        var properties = Object.keys(node).sort();
        for (var pi = 0; pi < properties.length; ++pi) {
          var property = properties[pi];
          var items = node[property];
          if (property === '@type') {
            property = RDF_TYPE;
          } else if (_isKeyword(property)) {
            continue;
          }
          for (var ii = 0; ii < items.length; ++ii) {
            var item = items[ii];
            var subject = {};
            subject.type = (id.indexOf('_:') === 0) ? 'blank node' : 'IRI';
            subject.value = id;
            if (!_isAbsoluteIri(id)) {
              continue;
            }
            var predicate = {};
            predicate.type = (property.indexOf('_:') === 0) ? 'blank node' : 'IRI';
            predicate.value = property;
            if (!_isAbsoluteIri(property)) {
              continue;
            }
            if (predicate.type === 'blank node' && !options.produceGeneralizedRdf) {
              continue;
            }
            if (_isList(item)) {
              _listToRDF(item['@list'], issuer, subject, predicate, rval);
            } else {
              var object = _objectToRDF(item);
              if (object) {
                rval.push({
                  subject: subject,
                  predicate: predicate,
                  object: object
                });
              }
            }
          }
        }
      }
      return rval;
    }
    function _listToRDF(list, issuer, subject, predicate, triples) {
      var first = {
        type: 'IRI',
        value: RDF_FIRST
      };
      var rest = {
        type: 'IRI',
        value: RDF_REST
      };
      var nil = {
        type: 'IRI',
        value: RDF_NIL
      };
      for (var i = 0; i < list.length; ++i) {
        var item = list[i];
        var blankNode = {
          type: 'blank node',
          value: issuer.getId()
        };
        triples.push({
          subject: subject,
          predicate: predicate,
          object: blankNode
        });
        subject = blankNode;
        predicate = first;
        var object = _objectToRDF(item);
        if (object) {
          triples.push({
            subject: subject,
            predicate: predicate,
            object: object
          });
        }
        predicate = rest;
      }
      triples.push({
        subject: subject,
        predicate: predicate,
        object: nil
      });
    }
    function _objectToRDF(item) {
      var object = {};
      if (_isValue(item)) {
        object.type = 'literal';
        var value = item['@value'];
        var datatype = item['@type'] || null;
        if (_isBoolean(value)) {
          object.value = value.toString();
          object.datatype = datatype || XSD_BOOLEAN;
        } else if (_isDouble(value) || datatype === XSD_DOUBLE) {
          if (!_isDouble(value)) {
            value = parseFloat(value);
          }
          object.value = value.toExponential(15).replace(/(\d)0*e\+?/, '$1E');
          object.datatype = datatype || XSD_DOUBLE;
        } else if (_isNumber(value)) {
          object.value = value.toFixed(0);
          object.datatype = datatype || XSD_INTEGER;
        } else if ('@language' in item) {
          object.value = value;
          object.datatype = datatype || RDF_LANGSTRING;
          object.language = item['@language'];
        } else {
          object.value = value;
          object.datatype = datatype || XSD_STRING;
        }
      } else {
        var id = _isObject(item) ? item['@id'] : item;
        object.type = (id.indexOf('_:') === 0) ? 'blank node' : 'IRI';
        object.value = id;
      }
      if (object.type === 'IRI' && !_isAbsoluteIri(object.value)) {
        return null;
      }
      return object;
    }
    function _RDFToObject(o, useNativeTypes) {
      if (o.type === 'IRI' || o.type === 'blank node') {
        return {'@id': o.value};
      }
      var rval = {'@value': o.value};
      if (o.language) {
        rval['@language'] = o.language;
      } else {
        var type = o.datatype;
        if (!type) {
          type = XSD_STRING;
        }
        if (useNativeTypes) {
          if (type === XSD_BOOLEAN) {
            if (rval['@value'] === 'true') {
              rval['@value'] = true;
            } else if (rval['@value'] === 'false') {
              rval['@value'] = false;
            }
          } else if (_isNumeric(rval['@value'])) {
            if (type === XSD_INTEGER) {
              var i = parseInt(rval['@value'], 10);
              if (i.toFixed(0) === rval['@value']) {
                rval['@value'] = i;
              }
            } else if (type === XSD_DOUBLE) {
              rval['@value'] = parseFloat(rval['@value']);
            }
          }
          if ([XSD_BOOLEAN, XSD_INTEGER, XSD_DOUBLE, XSD_STRING].indexOf(type) === -1) {
            rval['@type'] = type;
          }
        } else if (type !== XSD_STRING) {
          rval['@type'] = type;
        }
      }
      return rval;
    }
    function _compareRDFTriples(t1, t2) {
      var attrs = ['subject', 'predicate', 'object'];
      for (var i = 0; i < attrs.length; ++i) {
        var attr = attrs[i];
        if (t1[attr].type !== t2[attr].type || t1[attr].value !== t2[attr].value) {
          return false;
        }
      }
      if (t1.object.language !== t2.object.language) {
        return false;
      }
      if (t1.object.datatype !== t2.object.datatype) {
        return false;
      }
      return true;
    }
    var URDNA2015 = (function() {
      var POSITIONS = {
        'subject': 's',
        'object': 'o',
        'name': 'g'
      };
      var Normalize = function(options) {
        options = options || {};
        this.name = 'URDNA2015';
        this.options = options;
        this.blankNodeInfo = {};
        this.hashToBlankNodes = {};
        this.canonicalIssuer = new IdentifierIssuer('_:c14n');
        this.quads = [];
        this.schedule = {};
        if ('maxCallStackDepth' in options) {
          this.schedule.MAX_DEPTH = options.maxCallStackDepth;
        } else {
          this.schedule.MAX_DEPTH = 500;
        }
        if ('maxTotalCallStackDepth' in options) {
          this.schedule.MAX_TOTAL_DEPTH = options.maxCallStackDepth;
        } else {
          this.schedule.MAX_TOTAL_DEPTH = 0xFFFFFFFF;
        }
        this.schedule.depth = 0;
        this.schedule.totalDepth = 0;
        if ('timeSlice' in options) {
          this.schedule.timeSlice = options.timeSlice;
        } else {
          this.schedule.timeSlice = 10;
        }
      };
      Normalize.prototype.doWork = function(fn, callback) {
        var schedule = this.schedule;
        if (schedule.totalDepth >= schedule.MAX_TOTAL_DEPTH) {
          return callback(new Error('Maximum total call stack depth exceeded; normalization aborting.'));
        }
        (function work() {
          if (schedule.depth === schedule.MAX_DEPTH) {
            schedule.depth = 0;
            schedule.running = false;
            return jsonld.nextTick(work);
          }
          var now = new Date().getTime();
          if (!schedule.running) {
            schedule.start = new Date().getTime();
            schedule.deadline = schedule.start + schedule.timeSlice;
          }
          if (now < schedule.deadline) {
            schedule.running = true;
            schedule.depth++;
            schedule.totalDepth++;
            return fn(function(err, result) {
              schedule.depth--;
              schedule.totalDepth--;
              callback(err, result);
            });
          }
          schedule.depth = 0;
          schedule.running = false;
          jsonld.setImmediate(work);
        })();
      };
      Normalize.prototype.forEach = function(iterable, fn, callback) {
        var self = this;
        var iterator;
        var idx = 0;
        var length;
        if (_isArray(iterable)) {
          length = iterable.length;
          iterator = function() {
            if (idx === length) {
              return false;
            }
            iterator.value = iterable[idx++];
            iterator.key = idx;
            return true;
          };
        } else {
          var keys = Object.keys(iterable);
          length = keys.length;
          iterator = function() {
            if (idx === length) {
              return false;
            }
            iterator.key = keys[idx++];
            iterator.value = iterable[iterator.key];
            return true;
          };
        }
        (function iterate(err, result) {
          if (err) {
            return callback(err);
          }
          if (iterator()) {
            return self.doWork(function() {
              fn(iterator.value, iterator.key, iterate);
            });
          }
          callback();
        })();
      };
      Normalize.prototype.waterfall = function(fns, callback) {
        var self = this;
        self.forEach(fns, function(fn, idx, callback) {
          self.doWork(fn, callback);
        }, callback);
      };
      Normalize.prototype.whilst = function(condition, fn, callback) {
        var self = this;
        (function loop(err) {
          if (err) {
            return callback(err);
          }
          if (!condition()) {
            return callback();
          }
          self.doWork(fn, loop);
        })();
      };
      Normalize.prototype.main = function(dataset, callback) {
        var self = this;
        self.schedule.start = new Date().getTime();
        var result;
        if (self.options.format) {
          if (self.options.format !== 'application/nquads') {
            return callback(new JsonLdError('Unknown output format.', 'jsonld.UnknownFormat', {format: self.options.format}));
          }
        }
        var nonNormalized = {};
        self.waterfall([function(callback) {
          self.forEach(dataset, function(triples, graphName, callback) {
            if (graphName === '@default') {
              graphName = null;
            }
            self.forEach(triples, function(quad, idx, callback) {
              if (graphName !== null) {
                if (graphName.indexOf('_:') === 0) {
                  quad.name = {
                    type: 'blank node',
                    value: graphName
                  };
                } else {
                  quad.name = {
                    type: 'IRI',
                    value: graphName
                  };
                }
              }
              self.quads.push(quad);
              self.forEachComponent(quad, function(component) {
                if (component.type !== 'blank node') {
                  return;
                }
                var id = component.value;
                if (id in self.blankNodeInfo) {
                  self.blankNodeInfo[id].quads.push(quad);
                } else {
                  nonNormalized[id] = true;
                  self.blankNodeInfo[id] = {quads: [quad]};
                }
              });
              callback();
            }, callback);
          }, callback);
        }, function(callback) {
          var simple = true;
          self.whilst(function() {
            return simple;
          }, function(callback) {
            simple = false;
            self.hashToBlankNodes = {};
            self.waterfall([function(callback) {
              self.forEach(nonNormalized, function(value, id, callback) {
                self.hashFirstDegreeQuads(id, function(err, hash) {
                  if (err) {
                    return callback(err);
                  }
                  if (hash in self.hashToBlankNodes) {
                    self.hashToBlankNodes[hash].push(id);
                  } else {
                    self.hashToBlankNodes[hash] = [id];
                  }
                  callback();
                });
              }, callback);
            }, function(callback) {
              var hashes = Object.keys(self.hashToBlankNodes).sort();
              self.forEach(hashes, function(hash, i, callback) {
                var idList = self.hashToBlankNodes[hash];
                if (idList.length > 1) {
                  return callback();
                }
                var id = idList[0];
                self.canonicalIssuer.getId(id);
                delete nonNormalized[id];
                delete self.hashToBlankNodes[hash];
                simple = true;
                callback();
              }, callback);
            }], callback);
          }, callback);
        }, function(callback) {
          var hashes = Object.keys(self.hashToBlankNodes).sort();
          self.forEach(hashes, function(hash, idx, callback) {
            var hashPathList = [];
            var idList = self.hashToBlankNodes[hash];
            self.waterfall([function(callback) {
              self.forEach(idList, function(id, idx, callback) {
                if (self.canonicalIssuer.hasId(id)) {
                  return callback();
                }
                var issuer = new IdentifierIssuer('_:b');
                issuer.getId(id);
                self.hashNDegreeQuads(id, issuer, function(err, result) {
                  if (err) {
                    return callback(err);
                  }
                  hashPathList.push(result);
                  callback();
                });
              }, callback);
            }, function(callback) {
              hashPathList.sort(function(a, b) {
                return (a.hash < b.hash) ? -1 : ((a.hash > b.hash) ? 1 : 0);
              });
              self.forEach(hashPathList, function(result, idx, callback) {
                for (var existing in result.issuer.existing) {
                  self.canonicalIssuer.getId(existing);
                }
                callback();
              }, callback);
            }], callback);
          }, callback);
        }, function(callback) {
          var normalized = [];
          self.waterfall([function(callback) {
            self.forEach(self.quads, function(quad, idx, callback) {
              self.forEachComponent(quad, function(component) {
                if (component.type === 'blank node' && component.value.indexOf(self.canonicalIssuer.prefix) !== 0) {
                  component.value = self.canonicalIssuer.getId(component.value);
                }
              });
              normalized.push(_toNQuad(quad));
              callback();
            }, callback);
          }, function(callback) {
            normalized.sort();
            if (self.options.format === 'application/nquads') {
              result = normalized.join('');
              return callback();
            }
            result = _parseNQuads(normalized.join(''));
            callback();
          }], callback);
        }], function(err) {
          callback(err, result);
        });
      };
      Normalize.prototype.hashFirstDegreeQuads = function(id, callback) {
        var self = this;
        var info = self.blankNodeInfo[id];
        if ('hash' in info) {
          return callback(null, info.hash);
        }
        var nquads = [];
        var quads = info.quads;
        self.forEach(quads, function(quad, idx, callback) {
          var copy = {predicate: quad.predicate};
          self.forEachComponent(quad, function(component, key) {
            copy[key] = self.modifyFirstDegreeComponent(id, component, key);
          });
          nquads.push(_toNQuad(copy));
          callback();
        }, function(err) {
          if (err) {
            return callback(err);
          }
          nquads.sort();
          info.hash = NormalizeHash.hashNQuads(self.name, nquads);
          callback(null, info.hash);
        });
      };
      Normalize.prototype.modifyFirstDegreeComponent = function(id, component) {
        if (component.type !== 'blank node') {
          return component;
        }
        component = _clone(component);
        component.value = (component.value === id ? '_:a' : '_:z');
        return component;
      };
      Normalize.prototype.hashRelatedBlankNode = function(related, quad, issuer, position, callback) {
        var self = this;
        var id;
        self.waterfall([function(callback) {
          if (self.canonicalIssuer.hasId(related)) {
            id = self.canonicalIssuer.getId(related);
            return callback();
          }
          if (issuer.hasId(related)) {
            id = issuer.getId(related);
            return callback();
          }
          self.hashFirstDegreeQuads(related, function(err, hash) {
            if (err) {
              return callback(err);
            }
            id = hash;
            callback();
          });
        }], function(err) {
          if (err) {
            return callback(err);
          }
          var md = new NormalizeHash(self.name);
          md.update(position);
          if (position !== 'g') {
            md.update(self.getRelatedPredicate(quad));
          }
          md.update(id);
          return callback(null, md.digest());
        });
      };
      Normalize.prototype.getRelatedPredicate = function(quad) {
        return '<' + quad.predicate.value + '>';
      };
      Normalize.prototype.hashNDegreeQuads = function(id, issuer, callback) {
        var self = this;
        var hashToRelated;
        var md = new NormalizeHash(self.name);
        self.waterfall([function(callback) {
          self.createHashToRelated(id, issuer, function(err, result) {
            if (err) {
              return callback(err);
            }
            hashToRelated = result;
            callback();
          });
        }, function(callback) {
          var hashes = Object.keys(hashToRelated).sort();
          self.forEach(hashes, function(hash, idx, callback) {
            md.update(hash);
            var chosenPath = '';
            var chosenIssuer;
            var permutator = new Permutator(hashToRelated[hash]);
            self.whilst(function() {
              return permutator.hasNext();
            }, function(nextPermutation) {
              var permutation = permutator.next();
              var issuerCopy = issuer.clone();
              var path = '';
              var recursionList = [];
              self.waterfall([function(callback) {
                self.forEach(permutation, function(related, idx, callback) {
                  if (self.canonicalIssuer.hasId(related)) {
                    path += self.canonicalIssuer.getId(related);
                  } else {
                    if (!issuerCopy.hasId(related)) {
                      recursionList.push(related);
                    }
                    path += issuerCopy.getId(related);
                  }
                  if (chosenPath.length !== 0 && path.length >= chosenPath.length && path > chosenPath) {
                    return nextPermutation();
                  }
                  callback();
                }, callback);
              }, function(callback) {
                self.forEach(recursionList, function(related, idx, callback) {
                  self.hashNDegreeQuads(related, issuerCopy, function(err, result) {
                    if (err) {
                      return callback(err);
                    }
                    path += issuerCopy.getId(related);
                    path += '<' + result.hash + '>';
                    issuerCopy = result.issuer;
                    if (chosenPath.length !== 0 && path.length >= chosenPath.length && path > chosenPath) {
                      return nextPermutation();
                    }
                    callback();
                  });
                }, callback);
              }, function(callback) {
                if (chosenPath.length === 0 || path < chosenPath) {
                  chosenPath = path;
                  chosenIssuer = issuerCopy;
                }
                callback();
              }], nextPermutation);
            }, function(err) {
              if (err) {
                return callback(err);
              }
              md.update(chosenPath);
              issuer = chosenIssuer;
              callback();
            });
          }, callback);
        }], function(err) {
          callback(err, {
            hash: md.digest(),
            issuer: issuer
          });
        });
      };
      Normalize.prototype.createHashToRelated = function(id, issuer, callback) {
        var self = this;
        var hashToRelated = {};
        var quads = self.blankNodeInfo[id].quads;
        self.forEach(quads, function(quad, idx, callback) {
          self.forEach(quad, function(component, key, callback) {
            if (key === 'predicate' || !(component.type === 'blank node' && component.value !== id)) {
              return callback();
            }
            var related = component.value;
            var position = POSITIONS[key];
            self.hashRelatedBlankNode(related, quad, issuer, position, function(err, hash) {
              if (err) {
                return callback(err);
              }
              if (hash in hashToRelated) {
                hashToRelated[hash].push(related);
              } else {
                hashToRelated[hash] = [related];
              }
              callback();
            });
          }, callback);
        }, function(err) {
          callback(err, hashToRelated);
        });
      };
      Normalize.prototype.forEachComponent = function(quad, op) {
        for (var key in quad) {
          if (key === 'predicate') {
            continue;
          }
          op(quad[key], key, quad);
        }
      };
      return Normalize;
    })();
    var URGNA2012 = (function() {
      var Normalize = function(options) {
        URDNA2015.call(this, options);
        this.name = 'URGNA2012';
      };
      Normalize.prototype = new URDNA2015();
      Normalize.prototype.modifyFirstDegreeComponent = function(id, component, key) {
        if (component.type !== 'blank node') {
          return component;
        }
        component = _clone(component);
        if (key === 'name') {
          component.value = '_:g';
        } else {
          component.value = (component.value === id ? '_:a' : '_:z');
        }
        return component;
      };
      Normalize.prototype.getRelatedPredicate = function(quad) {
        return quad.predicate.value;
      };
      Normalize.prototype.createHashToRelated = function(id, issuer, callback) {
        var self = this;
        var hashToRelated = {};
        var quads = self.blankNodeInfo[id].quads;
        self.forEach(quads, function(quad, idx, callback) {
          var position;
          var related;
          if (quad.subject.type === 'blank node' && quad.subject.value !== id) {
            related = quad.subject.value;
            position = 'p';
          } else if (quad.object.type === 'blank node' && quad.object.value !== id) {
            related = quad.object.value;
            position = 'r';
          } else {
            return callback();
          }
          self.hashRelatedBlankNode(related, quad, issuer, position, function(err, hash) {
            if (hash in hashToRelated) {
              hashToRelated[hash].push(related);
            } else {
              hashToRelated[hash] = [related];
            }
            callback();
          });
        }, function(err) {
          callback(err, hashToRelated);
        });
      };
      return Normalize;
    })();
    function _createNodeMap(input, graphs, graph, issuer, name, list) {
      if (_isArray(input)) {
        for (var i = 0; i < input.length; ++i) {
          _createNodeMap(input[i], graphs, graph, issuer, undefined, list);
        }
        return;
      }
      if (!_isObject(input)) {
        if (list) {
          list.push(input);
        }
        return;
      }
      if (_isValue(input)) {
        if ('@type' in input) {
          var type = input['@type'];
          if (type.indexOf('_:') === 0) {
            input['@type'] = type = issuer.getId(type);
          }
        }
        if (list) {
          list.push(input);
        }
        return;
      }
      if ('@type' in input) {
        var types = input['@type'];
        for (var i = 0; i < types.length; ++i) {
          var type = types[i];
          if (type.indexOf('_:') === 0) {
            issuer.getId(type);
          }
        }
      }
      if (_isUndefined(name)) {
        name = _isBlankNode(input) ? issuer.getId(input['@id']) : input['@id'];
      }
      if (list) {
        list.push({'@id': name});
      }
      var subjects = graphs[graph];
      var subject = subjects[name] = subjects[name] || {};
      subject['@id'] = name;
      var properties = Object.keys(input).sort();
      for (var pi = 0; pi < properties.length; ++pi) {
        var property = properties[pi];
        if (property === '@id') {
          continue;
        }
        if (property === '@reverse') {
          var referencedNode = {'@id': name};
          var reverseMap = input['@reverse'];
          for (var reverseProperty in reverseMap) {
            var items = reverseMap[reverseProperty];
            for (var ii = 0; ii < items.length; ++ii) {
              var item = items[ii];
              var itemName = item['@id'];
              if (_isBlankNode(item)) {
                itemName = issuer.getId(itemName);
              }
              _createNodeMap(item, graphs, graph, issuer, itemName);
              jsonld.addValue(subjects[itemName], reverseProperty, referencedNode, {
                propertyIsArray: true,
                allowDuplicate: false
              });
            }
          }
          continue;
        }
        if (property === '@graph') {
          if (!(name in graphs)) {
            graphs[name] = {};
          }
          var g = (graph === '@merged') ? graph : name;
          _createNodeMap(input[property], graphs, g, issuer);
          continue;
        }
        if (property !== '@type' && _isKeyword(property)) {
          if (property === '@index' && property in subject && (input[property] !== subject[property] || input[property]['@id'] !== subject[property]['@id'])) {
            throw new JsonLdError('Invalid JSON-LD syntax; conflicting @index property detected.', 'jsonld.SyntaxError', {
              code: 'conflicting indexes',
              subject: subject
            });
          }
          subject[property] = input[property];
          continue;
        }
        var objects = input[property];
        if (property.indexOf('_:') === 0) {
          property = issuer.getId(property);
        }
        if (objects.length === 0) {
          jsonld.addValue(subject, property, [], {propertyIsArray: true});
          continue;
        }
        for (var oi = 0; oi < objects.length; ++oi) {
          var o = objects[oi];
          if (property === '@type') {
            o = (o.indexOf('_:') === 0) ? issuer.getId(o) : o;
          }
          if (_isSubject(o) || _isSubjectReference(o)) {
            var id = _isBlankNode(o) ? issuer.getId(o['@id']) : o['@id'];
            jsonld.addValue(subject, property, {'@id': id}, {
              propertyIsArray: true,
              allowDuplicate: false
            });
            _createNodeMap(o, graphs, graph, issuer, id);
          } else if (_isList(o)) {
            var _list = [];
            _createNodeMap(o['@list'], graphs, graph, issuer, name, _list);
            o = {'@list': _list};
            jsonld.addValue(subject, property, o, {
              propertyIsArray: true,
              allowDuplicate: false
            });
          } else {
            _createNodeMap(o, graphs, graph, issuer, name);
            jsonld.addValue(subject, property, o, {
              propertyIsArray: true,
              allowDuplicate: false
            });
          }
        }
      }
    }
    function _mergeNodeMaps(graphs) {
      var defaultGraph = graphs['@default'];
      var graphNames = Object.keys(graphs).sort();
      for (var i = 0; i < graphNames.length; ++i) {
        var graphName = graphNames[i];
        if (graphName === '@default') {
          continue;
        }
        var nodeMap = graphs[graphName];
        var subject = defaultGraph[graphName];
        if (!subject) {
          defaultGraph[graphName] = subject = {
            '@id': graphName,
            '@graph': []
          };
        } else if (!('@graph' in subject)) {
          subject['@graph'] = [];
        }
        var graph = subject['@graph'];
        var ids = Object.keys(nodeMap).sort();
        for (var ii = 0; ii < ids.length; ++ii) {
          var node = nodeMap[ids[ii]];
          if (!_isSubjectReference(node)) {
            graph.push(node);
          }
        }
      }
      return defaultGraph;
    }
    function _frame(state, subjects, frame, parent, property) {
      _validateFrame(frame);
      frame = frame[0];
      var options = state.options;
      var flags = {
        embed: _getFrameFlag(frame, options, 'embed'),
        explicit: _getFrameFlag(frame, options, 'explicit'),
        requireAll: _getFrameFlag(frame, options, 'requireAll')
      };
      var matches = _filterSubjects(state, subjects, frame, flags);
      var ids = Object.keys(matches).sort();
      for (var idx = 0; idx < ids.length; ++idx) {
        var id = ids[idx];
        var subject = matches[id];
        if (flags.embed === '@link' && id in state.link) {
          _addFrameOutput(parent, property, state.link[id]);
          continue;
        }
        if (property === null) {
          state.uniqueEmbeds = {};
        }
        var output = {};
        output['@id'] = id;
        state.link[id] = output;
        if (flags.embed === '@never' || _createsCircularReference(subject, state.subjectStack)) {
          _addFrameOutput(parent, property, output);
          continue;
        }
        if (flags.embed === '@last') {
          if (id in state.uniqueEmbeds) {
            _removeEmbed(state, id);
          }
          state.uniqueEmbeds[id] = {
            parent: parent,
            property: property
          };
        }
        state.subjectStack.push(subject);
        var props = Object.keys(subject).sort();
        for (var i = 0; i < props.length; i++) {
          var prop = props[i];
          if (_isKeyword(prop)) {
            output[prop] = _clone(subject[prop]);
            continue;
          }
          if (flags.explicit && !(prop in frame)) {
            continue;
          }
          var objects = subject[prop];
          for (var oi = 0; oi < objects.length; ++oi) {
            var o = objects[oi];
            if (_isList(o)) {
              var list = {'@list': []};
              _addFrameOutput(output, prop, list);
              var src = o['@list'];
              for (var n in src) {
                o = src[n];
                if (_isSubjectReference(o)) {
                  var subframe = (prop in frame ? frame[prop][0]['@list'] : _createImplicitFrame(flags));
                  _frame(state, [o['@id']], subframe, list, '@list');
                } else {
                  _addFrameOutput(list, '@list', _clone(o));
                }
              }
              continue;
            }
            if (_isSubjectReference(o)) {
              var subframe = (prop in frame ? frame[prop] : _createImplicitFrame(flags));
              _frame(state, [o['@id']], subframe, output, prop);
            } else {
              _addFrameOutput(output, prop, _clone(o));
            }
          }
        }
        var props = Object.keys(frame).sort();
        for (var i = 0; i < props.length; ++i) {
          var prop = props[i];
          if (_isKeyword(prop)) {
            continue;
          }
          var next = frame[prop][0];
          var omitDefaultOn = _getFrameFlag(next, options, 'omitDefault');
          if (!omitDefaultOn && !(prop in output)) {
            var preserve = '@null';
            if ('@default' in next) {
              preserve = _clone(next['@default']);
            }
            if (!_isArray(preserve)) {
              preserve = [preserve];
            }
            output[prop] = [{'@preserve': preserve}];
          }
        }
        _addFrameOutput(parent, property, output);
        state.subjectStack.pop();
      }
    }
    function _createImplicitFrame(flags) {
      var frame = {};
      for (var key in flags) {
        if (flags[key] !== undefined) {
          frame['@' + key] = [flags[key]];
        }
      }
      return [frame];
    }
    function _createsCircularReference(subjectToEmbed, subjectStack) {
      for (var i = subjectStack.length - 1; i >= 0; --i) {
        if (subjectStack[i]['@id'] === subjectToEmbed['@id']) {
          return true;
        }
      }
      return false;
    }
    function _getFrameFlag(frame, options, name) {
      var flag = '@' + name;
      var rval = (flag in frame ? frame[flag][0] : options[name]);
      if (name === 'embed') {
        if (rval === true) {
          rval = '@last';
        } else if (rval === false) {
          rval = '@never';
        } else if (rval !== '@always' && rval !== '@never' && rval !== '@link') {
          rval = '@last';
        }
      }
      return rval;
    }
    function _validateFrame(frame) {
      if (!_isArray(frame) || frame.length !== 1 || !_isObject(frame[0])) {
        throw new JsonLdError('Invalid JSON-LD syntax; a JSON-LD frame must be a single object.', 'jsonld.SyntaxError', {frame: frame});
      }
    }
    function _filterSubjects(state, subjects, frame, flags) {
      var rval = {};
      for (var i = 0; i < subjects.length; ++i) {
        var id = subjects[i];
        var subject = state.subjects[id];
        if (_filterSubject(subject, frame, flags)) {
          rval[id] = subject;
        }
      }
      return rval;
    }
    function _filterSubject(subject, frame, flags) {
      if ('@type' in frame && !(frame['@type'].length === 1 && _isObject(frame['@type'][0]))) {
        var types = frame['@type'];
        for (var i = 0; i < types.length; ++i) {
          if (jsonld.hasValue(subject, '@type', types[i])) {
            return true;
          }
        }
        return false;
      }
      var wildcard = true;
      var matchesSome = false;
      for (var key in frame) {
        if (_isKeyword(key)) {
          if (key !== '@id' && key !== '@type') {
            continue;
          }
          wildcard = false;
          if (key === '@id' && _isString(frame[key])) {
            if (subject[key] !== frame[key]) {
              return false;
            }
            matchesSome = true;
            continue;
          }
        }
        wildcard = false;
        if (key in subject) {
          if (_isArray(frame[key]) && frame[key].length === 0 && subject[key] !== undefined) {
            return false;
          }
          matchesSome = true;
          continue;
        }
        var hasDefault = (_isArray(frame[key]) && _isObject(frame[key][0]) && '@default' in frame[key][0]);
        if (flags.requireAll && !hasDefault) {
          return false;
        }
      }
      return wildcard || matchesSome;
    }
    function _removeEmbed(state, id) {
      var embeds = state.uniqueEmbeds;
      var embed = embeds[id];
      var parent = embed.parent;
      var property = embed.property;
      var subject = {'@id': id};
      if (_isArray(parent)) {
        for (var i = 0; i < parent.length; ++i) {
          if (jsonld.compareValues(parent[i], subject)) {
            parent[i] = subject;
            break;
          }
        }
      } else {
        var useArray = _isArray(parent[property]);
        jsonld.removeValue(parent, property, subject, {propertyIsArray: useArray});
        jsonld.addValue(parent, property, subject, {propertyIsArray: useArray});
      }
      var removeDependents = function(id) {
        var ids = Object.keys(embeds);
        for (var i = 0; i < ids.length; ++i) {
          var next = ids[i];
          if (next in embeds && _isObject(embeds[next].parent) && embeds[next].parent['@id'] === id) {
            delete embeds[next];
            removeDependents(next);
          }
        }
      };
      removeDependents(id);
    }
    function _addFrameOutput(parent, property, output) {
      if (_isObject(parent)) {
        jsonld.addValue(parent, property, output, {propertyIsArray: true});
      } else {
        parent.push(output);
      }
    }
    function _removePreserve(ctx, input, options) {
      if (_isArray(input)) {
        var output = [];
        for (var i = 0; i < input.length; ++i) {
          var result = _removePreserve(ctx, input[i], options);
          if (result !== null) {
            output.push(result);
          }
        }
        input = output;
      } else if (_isObject(input)) {
        if ('@preserve' in input) {
          if (input['@preserve'] === '@null') {
            return null;
          }
          return input['@preserve'];
        }
        if (_isValue(input)) {
          return input;
        }
        if (_isList(input)) {
          input['@list'] = _removePreserve(ctx, input['@list'], options);
          return input;
        }
        var idAlias = _compactIri(ctx, '@id');
        if (idAlias in input) {
          var id = input[idAlias];
          if (id in options.link) {
            var idx = options.link[id].indexOf(input);
            if (idx === -1) {
              options.link[id].push(input);
            } else {
              return options.link[id][idx];
            }
          } else {
            options.link[id] = [input];
          }
        }
        for (var prop in input) {
          var result = _removePreserve(ctx, input[prop], options);
          var container = jsonld.getContextValue(ctx, prop, '@container');
          if (options.compactArrays && _isArray(result) && result.length === 1 && container === null) {
            result = result[0];
          }
          input[prop] = result;
        }
      }
      return input;
    }
    function _compareShortestLeast(a, b) {
      if (a.length < b.length) {
        return -1;
      }
      if (b.length < a.length) {
        return 1;
      }
      if (a === b) {
        return 0;
      }
      return (a < b) ? -1 : 1;
    }
    function _selectTerm(activeCtx, iri, value, containers, typeOrLanguage, typeOrLanguageValue) {
      if (typeOrLanguageValue === null) {
        typeOrLanguageValue = '@null';
      }
      var prefs = [];
      if ((typeOrLanguageValue === '@id' || typeOrLanguageValue === '@reverse') && _isSubjectReference(value)) {
        if (typeOrLanguageValue === '@reverse') {
          prefs.push('@reverse');
        }
        var term = _compactIri(activeCtx, value['@id'], null, {vocab: true});
        if (term in activeCtx.mappings && activeCtx.mappings[term] && activeCtx.mappings[term]['@id'] === value['@id']) {
          prefs.push.apply(prefs, ['@vocab', '@id']);
        } else {
          prefs.push.apply(prefs, ['@id', '@vocab']);
        }
      } else {
        prefs.push(typeOrLanguageValue);
      }
      prefs.push('@none');
      var containerMap = activeCtx.inverse[iri];
      for (var ci = 0; ci < containers.length; ++ci) {
        var container = containers[ci];
        if (!(container in containerMap)) {
          continue;
        }
        var typeOrLanguageValueMap = containerMap[container][typeOrLanguage];
        for (var pi = 0; pi < prefs.length; ++pi) {
          var pref = prefs[pi];
          if (!(pref in typeOrLanguageValueMap)) {
            continue;
          }
          return typeOrLanguageValueMap[pref];
        }
      }
      return null;
    }
    function _compactIri(activeCtx, iri, value, relativeTo, reverse) {
      if (iri === null) {
        return iri;
      }
      if (_isUndefined(value)) {
        value = null;
      }
      if (_isUndefined(reverse)) {
        reverse = false;
      }
      relativeTo = relativeTo || {};
      if (_isKeyword(iri)) {
        relativeTo.vocab = true;
      }
      if (relativeTo.vocab && iri in activeCtx.getInverse()) {
        var defaultLanguage = activeCtx['@language'] || '@none';
        var containers = [];
        if (_isObject(value) && '@index' in value) {
          containers.push('@index');
        }
        var typeOrLanguage = '@language';
        var typeOrLanguageValue = '@null';
        if (reverse) {
          typeOrLanguage = '@type';
          typeOrLanguageValue = '@reverse';
          containers.push('@set');
        } else if (_isList(value)) {
          if (!('@index' in value)) {
            containers.push('@list');
          }
          var list = value['@list'];
          var commonLanguage = (list.length === 0) ? defaultLanguage : null;
          var commonType = null;
          for (var i = 0; i < list.length; ++i) {
            var item = list[i];
            var itemLanguage = '@none';
            var itemType = '@none';
            if (_isValue(item)) {
              if ('@language' in item) {
                itemLanguage = item['@language'];
              } else if ('@type' in item) {
                itemType = item['@type'];
              } else {
                itemLanguage = '@null';
              }
            } else {
              itemType = '@id';
            }
            if (commonLanguage === null) {
              commonLanguage = itemLanguage;
            } else if (itemLanguage !== commonLanguage && _isValue(item)) {
              commonLanguage = '@none';
            }
            if (commonType === null) {
              commonType = itemType;
            } else if (itemType !== commonType) {
              commonType = '@none';
            }
            if (commonLanguage === '@none' && commonType === '@none') {
              break;
            }
          }
          commonLanguage = commonLanguage || '@none';
          commonType = commonType || '@none';
          if (commonType !== '@none') {
            typeOrLanguage = '@type';
            typeOrLanguageValue = commonType;
          } else {
            typeOrLanguageValue = commonLanguage;
          }
        } else {
          if (_isValue(value)) {
            if ('@language' in value && !('@index' in value)) {
              containers.push('@language');
              typeOrLanguageValue = value['@language'];
            } else if ('@type' in value) {
              typeOrLanguage = '@type';
              typeOrLanguageValue = value['@type'];
            }
          } else {
            typeOrLanguage = '@type';
            typeOrLanguageValue = '@id';
          }
          containers.push('@set');
        }
        containers.push('@none');
        var term = _selectTerm(activeCtx, iri, value, containers, typeOrLanguage, typeOrLanguageValue);
        if (term !== null) {
          return term;
        }
      }
      if (relativeTo.vocab) {
        if ('@vocab' in activeCtx) {
          var vocab = activeCtx['@vocab'];
          if (iri.indexOf(vocab) === 0 && iri !== vocab) {
            var suffix = iri.substr(vocab.length);
            if (!(suffix in activeCtx.mappings)) {
              return suffix;
            }
          }
        }
      }
      var choice = null;
      for (var term in activeCtx.mappings) {
        if (term.indexOf(':') !== -1) {
          continue;
        }
        var definition = activeCtx.mappings[term];
        if (!definition || definition['@id'] === iri || iri.indexOf(definition['@id']) !== 0) {
          continue;
        }
        var curie = term + ':' + iri.substr(definition['@id'].length);
        var isUsableCurie = (!(curie in activeCtx.mappings) || (value === null && activeCtx.mappings[curie] && activeCtx.mappings[curie]['@id'] === iri));
        if (isUsableCurie && (choice === null || _compareShortestLeast(curie, choice) < 0)) {
          choice = curie;
        }
      }
      if (choice !== null) {
        return choice;
      }
      if (!relativeTo.vocab) {
        return _removeBase(activeCtx['@base'], iri);
      }
      return iri;
    }
    function _compactValue(activeCtx, activeProperty, value) {
      if (_isValue(value)) {
        var type = jsonld.getContextValue(activeCtx, activeProperty, '@type');
        var language = jsonld.getContextValue(activeCtx, activeProperty, '@language');
        var container = jsonld.getContextValue(activeCtx, activeProperty, '@container');
        var preserveIndex = (('@index' in value) && container !== '@index');
        if (!preserveIndex) {
          if (value['@type'] === type || value['@language'] === language) {
            return value['@value'];
          }
        }
        var keyCount = Object.keys(value).length;
        var isValueOnlyKey = (keyCount === 1 || (keyCount === 2 && ('@index' in value) && !preserveIndex));
        var hasDefaultLanguage = ('@language' in activeCtx);
        var isValueString = _isString(value['@value']);
        var hasNullMapping = (activeCtx.mappings[activeProperty] && activeCtx.mappings[activeProperty]['@language'] === null);
        if (isValueOnlyKey && (!hasDefaultLanguage || !isValueString || hasNullMapping)) {
          return value['@value'];
        }
        var rval = {};
        if (preserveIndex) {
          rval[_compactIri(activeCtx, '@index')] = value['@index'];
        }
        if ('@type' in value) {
          rval[_compactIri(activeCtx, '@type')] = _compactIri(activeCtx, value['@type'], null, {vocab: true});
        } else if ('@language' in value) {
          rval[_compactIri(activeCtx, '@language')] = value['@language'];
        }
        rval[_compactIri(activeCtx, '@value')] = value['@value'];
        return rval;
      }
      var expandedProperty = _expandIri(activeCtx, activeProperty, {vocab: true});
      var type = jsonld.getContextValue(activeCtx, activeProperty, '@type');
      var compacted = _compactIri(activeCtx, value['@id'], null, {vocab: type === '@vocab'});
      if (type === '@id' || type === '@vocab' || expandedProperty === '@graph') {
        return compacted;
      }
      var rval = {};
      rval[_compactIri(activeCtx, '@id')] = compacted;
      return rval;
    }
    function _createTermDefinition(activeCtx, localCtx, term, defined) {
      if (term in defined) {
        if (defined[term]) {
          return;
        }
        throw new JsonLdError('Cyclical context definition detected.', 'jsonld.CyclicalContext', {
          code: 'cyclic IRI mapping',
          context: localCtx,
          term: term
        });
      }
      defined[term] = false;
      if (_isKeyword(term)) {
        throw new JsonLdError('Invalid JSON-LD syntax; keywords cannot be overridden.', 'jsonld.SyntaxError', {
          code: 'keyword redefinition',
          context: localCtx,
          term: term
        });
      }
      if (term === '') {
        throw new JsonLdError('Invalid JSON-LD syntax; a term cannot be an empty string.', 'jsonld.SyntaxError', {
          code: 'invalid term definition',
          context: localCtx
        });
      }
      if (activeCtx.mappings[term]) {
        delete activeCtx.mappings[term];
      }
      var value = localCtx[term];
      if (value === null || (_isObject(value) && value['@id'] === null)) {
        activeCtx.mappings[term] = null;
        defined[term] = true;
        return;
      }
      if (_isString(value)) {
        value = {'@id': value};
      }
      if (!_isObject(value)) {
        throw new JsonLdError('Invalid JSON-LD syntax; @context property values must be ' + 'strings or objects.', 'jsonld.SyntaxError', {
          code: 'invalid term definition',
          context: localCtx
        });
      }
      var mapping = activeCtx.mappings[term] = {};
      mapping.reverse = false;
      if ('@reverse' in value) {
        if ('@id' in value) {
          throw new JsonLdError('Invalid JSON-LD syntax; a @reverse term definition must not ' + 'contain @id.', 'jsonld.SyntaxError', {
            code: 'invalid reverse property',
            context: localCtx
          });
        }
        var reverse = value['@reverse'];
        if (!_isString(reverse)) {
          throw new JsonLdError('Invalid JSON-LD syntax; a @context @reverse value must be a string.', 'jsonld.SyntaxError', {
            code: 'invalid IRI mapping',
            context: localCtx
          });
        }
        var id = _expandIri(activeCtx, reverse, {
          vocab: true,
          base: false
        }, localCtx, defined);
        if (!_isAbsoluteIri(id)) {
          throw new JsonLdError('Invalid JSON-LD syntax; a @context @reverse value must be an ' + 'absolute IRI or a blank node identifier.', 'jsonld.SyntaxError', {
            code: 'invalid IRI mapping',
            context: localCtx
          });
        }
        mapping['@id'] = id;
        mapping.reverse = true;
      } else if ('@id' in value) {
        var id = value['@id'];
        if (!_isString(id)) {
          throw new JsonLdError('Invalid JSON-LD syntax; a @context @id value must be an array ' + 'of strings or a string.', 'jsonld.SyntaxError', {
            code: 'invalid IRI mapping',
            context: localCtx
          });
        }
        if (id !== term) {
          id = _expandIri(activeCtx, id, {
            vocab: true,
            base: false
          }, localCtx, defined);
          if (!_isAbsoluteIri(id) && !_isKeyword(id)) {
            throw new JsonLdError('Invalid JSON-LD syntax; a @context @id value must be an ' + 'absolute IRI, a blank node identifier, or a keyword.', 'jsonld.SyntaxError', {
              code: 'invalid IRI mapping',
              context: localCtx
            });
          }
          mapping['@id'] = id;
        }
      }
      if (!('@id' in mapping)) {
        var colon = term.indexOf(':');
        if (colon !== -1) {
          var prefix = term.substr(0, colon);
          if (prefix in localCtx) {
            _createTermDefinition(activeCtx, localCtx, prefix, defined);
          }
          if (activeCtx.mappings[prefix]) {
            var suffix = term.substr(colon + 1);
            mapping['@id'] = activeCtx.mappings[prefix]['@id'] + suffix;
          } else {
            mapping['@id'] = term;
          }
        } else {
          if (!('@vocab' in activeCtx)) {
            throw new JsonLdError('Invalid JSON-LD syntax; @context terms must define an @id.', 'jsonld.SyntaxError', {
              code: 'invalid IRI mapping',
              context: localCtx,
              term: term
            });
          }
          mapping['@id'] = activeCtx['@vocab'] + term;
        }
      }
      defined[term] = true;
      if ('@type' in value) {
        var type = value['@type'];
        if (!_isString(type)) {
          throw new JsonLdError('Invalid JSON-LD syntax; an @context @type values must be a string.', 'jsonld.SyntaxError', {
            code: 'invalid type mapping',
            context: localCtx
          });
        }
        if (type !== '@id' && type !== '@vocab') {
          type = _expandIri(activeCtx, type, {
            vocab: true,
            base: false
          }, localCtx, defined);
          if (!_isAbsoluteIri(type)) {
            throw new JsonLdError('Invalid JSON-LD syntax; an @context @type value must be an ' + 'absolute IRI.', 'jsonld.SyntaxError', {
              code: 'invalid type mapping',
              context: localCtx
            });
          }
          if (type.indexOf('_:') === 0) {
            throw new JsonLdError('Invalid JSON-LD syntax; an @context @type values must be an IRI, ' + 'not a blank node identifier.', 'jsonld.SyntaxError', {
              code: 'invalid type mapping',
              context: localCtx
            });
          }
        }
        mapping['@type'] = type;
      }
      if ('@container' in value) {
        var container = value['@container'];
        if (container !== '@list' && container !== '@set' && container !== '@index' && container !== '@language') {
          throw new JsonLdError('Invalid JSON-LD syntax; @context @container value must be ' + 'one of the following: @list, @set, @index, or @language.', 'jsonld.SyntaxError', {
            code: 'invalid container mapping',
            context: localCtx
          });
        }
        if (mapping.reverse && container !== '@index' && container !== '@set' && container !== null) {
          throw new JsonLdError('Invalid JSON-LD syntax; @context @container value for a @reverse ' + 'type definition must be @index or @set.', 'jsonld.SyntaxError', {
            code: 'invalid reverse property',
            context: localCtx
          });
        }
        mapping['@container'] = container;
      }
      if ('@language' in value && !('@type' in value)) {
        var language = value['@language'];
        if (language !== null && !_isString(language)) {
          throw new JsonLdError('Invalid JSON-LD syntax; @context @language value must be ' + 'a string or null.', 'jsonld.SyntaxError', {
            code: 'invalid language mapping',
            context: localCtx
          });
        }
        if (language !== null) {
          language = language.toLowerCase();
        }
        mapping['@language'] = language;
      }
      var id = mapping['@id'];
      if (id === '@context' || id === '@preserve') {
        throw new JsonLdError('Invalid JSON-LD syntax; @context and @preserve cannot be aliased.', 'jsonld.SyntaxError', {
          code: 'invalid keyword alias',
          context: localCtx
        });
      }
    }
    function _expandIri(activeCtx, value, relativeTo, localCtx, defined) {
      if (value === null || _isKeyword(value)) {
        return value;
      }
      value = String(value);
      if (localCtx && value in localCtx && defined[value] !== true) {
        _createTermDefinition(activeCtx, localCtx, value, defined);
      }
      relativeTo = relativeTo || {};
      if (relativeTo.vocab) {
        var mapping = activeCtx.mappings[value];
        if (mapping === null) {
          return null;
        }
        if (mapping) {
          return mapping['@id'];
        }
      }
      var colon = value.indexOf(':');
      if (colon !== -1) {
        var prefix = value.substr(0, colon);
        var suffix = value.substr(colon + 1);
        if (prefix === '_' || suffix.indexOf('//') === 0) {
          return value;
        }
        if (localCtx && prefix in localCtx) {
          _createTermDefinition(activeCtx, localCtx, prefix, defined);
        }
        var mapping = activeCtx.mappings[prefix];
        if (mapping) {
          return mapping['@id'] + suffix;
        }
        return value;
      }
      if (relativeTo.vocab && '@vocab' in activeCtx) {
        return activeCtx['@vocab'] + value;
      }
      var rval = value;
      if (relativeTo.base) {
        rval = jsonld.prependBase(activeCtx['@base'], rval);
      }
      return rval;
    }
    function _prependBase(base, iri) {
      if (base === null) {
        return iri;
      }
      if (iri.indexOf(':') !== -1) {
        return iri;
      }
      if (_isString(base)) {
        base = jsonld.url.parse(base || '');
      }
      var rel = jsonld.url.parse(iri);
      var transform = {protocol: base.protocol || ''};
      if (rel.authority !== null) {
        transform.authority = rel.authority;
        transform.path = rel.path;
        transform.query = rel.query;
      } else {
        transform.authority = base.authority;
        if (rel.path === '') {
          transform.path = base.path;
          if (rel.query !== null) {
            transform.query = rel.query;
          } else {
            transform.query = base.query;
          }
        } else {
          if (rel.path.indexOf('/') === 0) {
            transform.path = rel.path;
          } else {
            var path = base.path;
            if (rel.path !== '') {
              path = path.substr(0, path.lastIndexOf('/') + 1);
              if (path.length > 0 && path.substr(-1) !== '/') {
                path += '/';
              }
              path += rel.path;
            }
            transform.path = path;
          }
          transform.query = rel.query;
        }
      }
      transform.path = _removeDotSegments(transform.path, !!transform.authority);
      var rval = transform.protocol;
      if (transform.authority !== null) {
        rval += '//' + transform.authority;
      }
      rval += transform.path;
      if (transform.query !== null) {
        rval += '?' + transform.query;
      }
      if (rel.fragment !== null) {
        rval += '#' + rel.fragment;
      }
      if (rval === '') {
        rval = './';
      }
      return rval;
    }
    function _removeBase(base, iri) {
      if (base === null) {
        return iri;
      }
      if (_isString(base)) {
        base = jsonld.url.parse(base || '');
      }
      var root = '';
      if (base.href !== '') {
        root += (base.protocol || '') + '//' + (base.authority || '');
      } else if (iri.indexOf('//')) {
        root += '//';
      }
      if (iri.indexOf(root) !== 0) {
        return iri;
      }
      var rel = jsonld.url.parse(iri.substr(root.length));
      var baseSegments = base.normalizedPath.split('/');
      var iriSegments = rel.normalizedPath.split('/');
      var last = (rel.fragment || rel.query) ? 0 : 1;
      while (baseSegments.length > 0 && iriSegments.length > last) {
        if (baseSegments[0] !== iriSegments[0]) {
          break;
        }
        baseSegments.shift();
        iriSegments.shift();
      }
      var rval = '';
      if (baseSegments.length > 0) {
        baseSegments.pop();
        for (var i = 0; i < baseSegments.length; ++i) {
          rval += '../';
        }
      }
      rval += iriSegments.join('/');
      if (rel.query !== null) {
        rval += '?' + rel.query;
      }
      if (rel.fragment !== null) {
        rval += '#' + rel.fragment;
      }
      if (rval === '') {
        rval = './';
      }
      return rval;
    }
    function _getInitialContext(options) {
      var base = jsonld.url.parse(options.base || '');
      return {
        '@base': base,
        mappings: {},
        inverse: null,
        getInverse: _createInverseContext,
        clone: _cloneActiveContext
      };
      function _createInverseContext() {
        var activeCtx = this;
        if (activeCtx.inverse) {
          return activeCtx.inverse;
        }
        var inverse = activeCtx.inverse = {};
        var defaultLanguage = activeCtx['@language'] || '@none';
        var mappings = activeCtx.mappings;
        var terms = Object.keys(mappings).sort(_compareShortestLeast);
        for (var i = 0; i < terms.length; ++i) {
          var term = terms[i];
          var mapping = mappings[term];
          if (mapping === null) {
            continue;
          }
          var container = mapping['@container'] || '@none';
          var ids = mapping['@id'];
          if (!_isArray(ids)) {
            ids = [ids];
          }
          for (var ii = 0; ii < ids.length; ++ii) {
            var iri = ids[ii];
            var entry = inverse[iri];
            if (!entry) {
              inverse[iri] = entry = {};
            }
            if (!entry[container]) {
              entry[container] = {
                '@language': {},
                '@type': {}
              };
            }
            entry = entry[container];
            if (mapping.reverse) {
              _addPreferredTerm(mapping, term, entry['@type'], '@reverse');
            } else if ('@type' in mapping) {
              _addPreferredTerm(mapping, term, entry['@type'], mapping['@type']);
            } else if ('@language' in mapping) {
              var language = mapping['@language'] || '@null';
              _addPreferredTerm(mapping, term, entry['@language'], language);
            } else {
              _addPreferredTerm(mapping, term, entry['@language'], defaultLanguage);
              _addPreferredTerm(mapping, term, entry['@type'], '@none');
              _addPreferredTerm(mapping, term, entry['@language'], '@none');
            }
          }
        }
        return inverse;
      }
      function _addPreferredTerm(mapping, term, entry, typeOrLanguageValue) {
        if (!(typeOrLanguageValue in entry)) {
          entry[typeOrLanguageValue] = term;
        }
      }
      function _cloneActiveContext() {
        var child = {};
        child['@base'] = this['@base'];
        child.mappings = _clone(this.mappings);
        child.clone = this.clone;
        child.inverse = null;
        child.getInverse = this.getInverse;
        if ('@language' in this) {
          child['@language'] = this['@language'];
        }
        if ('@vocab' in this) {
          child['@vocab'] = this['@vocab'];
        }
        return child;
      }
    }
    function _isKeyword(v) {
      if (!_isString(v)) {
        return false;
      }
      switch (v) {
        case '@base':
        case '@context':
        case '@container':
        case '@default':
        case '@embed':
        case '@explicit':
        case '@graph':
        case '@id':
        case '@index':
        case '@language':
        case '@list':
        case '@omitDefault':
        case '@preserve':
        case '@requireAll':
        case '@reverse':
        case '@set':
        case '@type':
        case '@value':
        case '@vocab':
          return true;
      }
      return false;
    }
    function _isObject(v) {
      return (Object.prototype.toString.call(v) === '[object Object]');
    }
    function _isEmptyObject(v) {
      return _isObject(v) && Object.keys(v).length === 0;
    }
    function _isArray(v) {
      return Array.isArray(v);
    }
    function _validateTypeValue(v) {
      if (_isString(v) || _isEmptyObject(v)) {
        return;
      }
      var isValid = false;
      if (_isArray(v)) {
        isValid = true;
        for (var i = 0; i < v.length; ++i) {
          if (!(_isString(v[i]))) {
            isValid = false;
            break;
          }
        }
      }
      if (!isValid) {
        throw new JsonLdError('Invalid JSON-LD syntax; "@type" value must a string, an array of ' + 'strings, or an empty object.', 'jsonld.SyntaxError', {
          code: 'invalid type value',
          value: v
        });
      }
    }
    function _isString(v) {
      return (typeof v === 'string' || Object.prototype.toString.call(v) === '[object String]');
    }
    function _isNumber(v) {
      return (typeof v === 'number' || Object.prototype.toString.call(v) === '[object Number]');
    }
    function _isDouble(v) {
      return _isNumber(v) && String(v).indexOf('.') !== -1;
    }
    function _isNumeric(v) {
      return !isNaN(parseFloat(v)) && isFinite(v);
    }
    function _isBoolean(v) {
      return (typeof v === 'boolean' || Object.prototype.toString.call(v) === '[object Boolean]');
    }
    function _isUndefined(v) {
      return (typeof v === 'undefined');
    }
    function _isSubject(v) {
      var rval = false;
      if (_isObject(v) && !(('@value' in v) || ('@set' in v) || ('@list' in v))) {
        var keyCount = Object.keys(v).length;
        rval = (keyCount > 1 || !('@id' in v));
      }
      return rval;
    }
    function _isSubjectReference(v) {
      return (_isObject(v) && Object.keys(v).length === 1 && ('@id' in v));
    }
    function _isValue(v) {
      return _isObject(v) && ('@value' in v);
    }
    function _isList(v) {
      return _isObject(v) && ('@list' in v);
    }
    function _isBlankNode(v) {
      var rval = false;
      if (_isObject(v)) {
        if ('@id' in v) {
          rval = (v['@id'].indexOf('_:') === 0);
        } else {
          rval = (Object.keys(v).length === 0 || !(('@value' in v) || ('@set' in v) || ('@list' in v)));
        }
      }
      return rval;
    }
    function _isAbsoluteIri(v) {
      return _isString(v) && v.indexOf(':') !== -1;
    }
    function _clone(value) {
      if (value && typeof value === 'object') {
        var rval;
        if (_isArray(value)) {
          rval = [];
          for (var i = 0; i < value.length; ++i) {
            rval[i] = _clone(value[i]);
          }
        } else if (_isObject(value)) {
          rval = {};
          for (var key in value) {
            rval[key] = _clone(value[key]);
          }
        } else {
          rval = value.toString();
        }
        return rval;
      }
      return value;
    }
    function _findContextUrls(input, urls, replace, base) {
      var count = Object.keys(urls).length;
      if (_isArray(input)) {
        for (var i = 0; i < input.length; ++i) {
          _findContextUrls(input[i], urls, replace, base);
        }
        return (count < Object.keys(urls).length);
      } else if (_isObject(input)) {
        for (var key in input) {
          if (key !== '@context') {
            _findContextUrls(input[key], urls, replace, base);
            continue;
          }
          var ctx = input[key];
          if (_isArray(ctx)) {
            var length = ctx.length;
            for (var i = 0; i < length; ++i) {
              var _ctx = ctx[i];
              if (_isString(_ctx)) {
                _ctx = jsonld.prependBase(base, _ctx);
                if (replace) {
                  _ctx = urls[_ctx];
                  if (_isArray(_ctx)) {
                    Array.prototype.splice.apply(ctx, [i, 1].concat(_ctx));
                    i += _ctx.length - 1;
                    length = ctx.length;
                  } else {
                    ctx[i] = _ctx;
                  }
                } else if (!(_ctx in urls)) {
                  urls[_ctx] = false;
                }
              }
            }
          } else if (_isString(ctx)) {
            ctx = jsonld.prependBase(base, ctx);
            if (replace) {
              input[key] = urls[ctx];
            } else if (!(ctx in urls)) {
              urls[ctx] = false;
            }
          }
        }
        return (count < Object.keys(urls).length);
      }
      return false;
    }
    function _retrieveContextUrls(input, options, callback) {
      var error = null;
      var documentLoader = options.documentLoader;
      var retrieve = function(input, cycles, documentLoader, base, callback) {
        if (Object.keys(cycles).length > MAX_CONTEXT_URLS) {
          error = new JsonLdError('Maximum number of @context URLs exceeded.', 'jsonld.ContextUrlError', {
            code: 'loading remote context failed',
            max: MAX_CONTEXT_URLS
          });
          return callback(error);
        }
        var urls = {};
        var finished = function() {
          _findContextUrls(input, urls, true, base);
          callback(null, input);
        };
        if (!_findContextUrls(input, urls, false, base)) {
          finished();
        }
        var queue = [];
        for (var url in urls) {
          if (urls[url] === false) {
            queue.push(url);
          }
        }
        var count = queue.length;
        for (var i = 0; i < queue.length; ++i) {
          (function(url) {
            if (url in cycles) {
              error = new JsonLdError('Cyclical @context URLs detected.', 'jsonld.ContextUrlError', {
                code: 'recursive context inclusion',
                url: url
              });
              return callback(error);
            }
            var _cycles = _clone(cycles);
            _cycles[url] = true;
            var done = function(err, remoteDoc) {
              if (error) {
                return;
              }
              var ctx = remoteDoc ? remoteDoc.document : null;
              if (!err && _isString(ctx)) {
                try {
                  ctx = JSON.parse(ctx);
                } catch (ex) {
                  err = ex;
                }
              }
              if (err) {
                err = new JsonLdError('Dereferencing a URL did not result in a valid JSON-LD object. ' + 'Possible causes are an inaccessible URL perhaps due to ' + 'a same-origin policy (ensure the server uses CORS if you are ' + 'using client-side JavaScript), too many redirects, a ' + 'non-JSON response, or more than one HTTP Link Header was ' + 'provided for a remote context.', 'jsonld.InvalidUrl', {
                  code: 'loading remote context failed',
                  url: url,
                  cause: err
                });
              } else if (!_isObject(ctx)) {
                err = new JsonLdError('Dereferencing a URL did not result in a JSON object. The ' + 'response was valid JSON, but it was not a JSON object.', 'jsonld.InvalidUrl', {
                  code: 'invalid remote context',
                  url: url,
                  cause: err
                });
              }
              if (err) {
                error = err;
                return callback(error);
              }
              if (!('@context' in ctx)) {
                ctx = {'@context': {}};
              } else {
                ctx = {'@context': ctx['@context']};
              }
              if (remoteDoc.contextUrl) {
                if (!_isArray(ctx['@context'])) {
                  ctx['@context'] = [ctx['@context']];
                }
                ctx['@context'].push(remoteDoc.contextUrl);
              }
              retrieve(ctx, _cycles, documentLoader, url, function(err, ctx) {
                if (err) {
                  return callback(err);
                }
                urls[url] = ctx['@context'];
                count -= 1;
                if (count === 0) {
                  finished();
                }
              });
            };
            var promise = documentLoader(url, done);
            if (promise && 'then' in promise) {
              promise.then(done.bind(null, null), done);
            }
          }(queue[i]));
        }
      };
      retrieve(input, {}, documentLoader, options.base, callback);
    }
    if (!Object.keys) {
      Object.keys = function(o) {
        if (o !== Object(o)) {
          throw new TypeError('Object.keys called on non-object');
        }
        var rval = [];
        for (var p in o) {
          if (Object.prototype.hasOwnProperty.call(o, p)) {
            rval.push(p);
          }
        }
        return rval;
      };
    }
    function _parseNQuads(input) {
      var iri = '(?:<([^:]+:[^>]*)>)';
      var bnode = '(_:(?:[A-Za-z0-9]+))';
      var plain = '"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"';
      var datatype = '(?:\\^\\^' + iri + ')';
      var language = '(?:@([a-z]+(?:-[a-z0-9]+)*))';
      var literal = '(?:' + plain + '(?:' + datatype + '|' + language + ')?)';
      var ws = '[ \\t]+';
      var wso = '[ \\t]*';
      var eoln = /(?:\r\n)|(?:\n)|(?:\r)/g;
      var empty = new RegExp('^' + wso + '$');
      var subject = '(?:' + iri + '|' + bnode + ')' + ws;
      var property = iri + ws;
      var object = '(?:' + iri + '|' + bnode + '|' + literal + ')' + wso;
      var graphName = '(?:\\.|(?:(?:' + iri + '|' + bnode + ')' + wso + '\\.))';
      var quad = new RegExp('^' + wso + subject + property + object + graphName + wso + '$');
      var dataset = {};
      var lines = input.split(eoln);
      var lineNumber = 0;
      for (var li = 0; li < lines.length; ++li) {
        var line = lines[li];
        lineNumber++;
        if (empty.test(line)) {
          continue;
        }
        var match = line.match(quad);
        if (match === null) {
          throw new JsonLdError('Error while parsing N-Quads; invalid quad.', 'jsonld.ParseError', {line: lineNumber});
        }
        var triple = {};
        if (!_isUndefined(match[1])) {
          triple.subject = {
            type: 'IRI',
            value: match[1]
          };
        } else {
          triple.subject = {
            type: 'blank node',
            value: match[2]
          };
        }
        triple.predicate = {
          type: 'IRI',
          value: match[3]
        };
        if (!_isUndefined(match[4])) {
          triple.object = {
            type: 'IRI',
            value: match[4]
          };
        } else if (!_isUndefined(match[5])) {
          triple.object = {
            type: 'blank node',
            value: match[5]
          };
        } else {
          triple.object = {type: 'literal'};
          if (!_isUndefined(match[7])) {
            triple.object.datatype = match[7];
          } else if (!_isUndefined(match[8])) {
            triple.object.datatype = RDF_LANGSTRING;
            triple.object.language = match[8];
          } else {
            triple.object.datatype = XSD_STRING;
          }
          var unescaped = match[6].replace(/\\"/g, '"').replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\\\/g, '\\');
          triple.object.value = unescaped;
        }
        var name = '@default';
        if (!_isUndefined(match[9])) {
          name = match[9];
        } else if (!_isUndefined(match[10])) {
          name = match[10];
        }
        if (!(name in dataset)) {
          dataset[name] = [triple];
        } else {
          var unique = true;
          var triples = dataset[name];
          for (var ti = 0; unique && ti < triples.length; ++ti) {
            if (_compareRDFTriples(triples[ti], triple)) {
              unique = false;
            }
          }
          if (unique) {
            triples.push(triple);
          }
        }
      }
      return dataset;
    }
    jsonld.registerRDFParser('application/nquads', _parseNQuads);
    function _toNQuads(dataset) {
      var quads = [];
      for (var graphName in dataset) {
        var triples = dataset[graphName];
        for (var ti = 0; ti < triples.length; ++ti) {
          var triple = triples[ti];
          if (graphName === '@default') {
            graphName = null;
          }
          quads.push(_toNQuad(triple, graphName));
        }
      }
      return quads.sort().join('');
    }
    function _toNQuad(triple, graphName) {
      var s = triple.subject;
      var p = triple.predicate;
      var o = triple.object;
      var g = graphName || null;
      if ('name' in triple && triple.name) {
        g = triple.name.value;
      }
      var quad = '';
      if (s.type === 'IRI') {
        quad += '<' + s.value + '>';
      } else {
        quad += s.value;
      }
      quad += ' ';
      if (p.type === 'IRI') {
        quad += '<' + p.value + '>';
      } else {
        quad += p.value;
      }
      quad += ' ';
      if (o.type === 'IRI') {
        quad += '<' + o.value + '>';
      } else if (o.type === 'blank node') {
        quad += o.value;
      } else {
        var escaped = o.value.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\"/g, '\\"');
        quad += '"' + escaped + '"';
        if (o.datatype === RDF_LANGSTRING) {
          if (o.language) {
            quad += '@' + o.language;
          }
        } else if (o.datatype !== XSD_STRING) {
          quad += '^^<' + o.datatype + '>';
        }
      }
      if (g !== null && g !== undefined) {
        if (g.indexOf('_:') !== 0) {
          quad += ' <' + g + '>';
        } else {
          quad += ' ' + g;
        }
      }
      quad += ' .\n';
      return quad;
    }
    function _parseRdfaApiData(data) {
      var dataset = {};
      dataset['@default'] = [];
      var subjects = data.getSubjects();
      for (var si = 0; si < subjects.length; ++si) {
        var subject = subjects[si];
        if (subject === null) {
          continue;
        }
        var triples = data.getSubjectTriples(subject);
        if (triples === null) {
          continue;
        }
        var predicates = triples.predicates;
        for (var predicate in predicates) {
          var objects = predicates[predicate].objects;
          for (var oi = 0; oi < objects.length; ++oi) {
            var object = objects[oi];
            var triple = {};
            if (subject.indexOf('_:') === 0) {
              triple.subject = {
                type: 'blank node',
                value: subject
              };
            } else {
              triple.subject = {
                type: 'IRI',
                value: subject
              };
            }
            if (predicate.indexOf('_:') === 0) {
              triple.predicate = {
                type: 'blank node',
                value: predicate
              };
            } else {
              triple.predicate = {
                type: 'IRI',
                value: predicate
              };
            }
            var value = object.value;
            if (object.type === RDF_XML_LITERAL) {
              if (!XMLSerializer) {
                _defineXMLSerializer();
              }
              var serializer = new XMLSerializer();
              value = '';
              for (var x = 0; x < object.value.length; x++) {
                if (object.value[x].nodeType === Node.ELEMENT_NODE) {
                  value += serializer.serializeToString(object.value[x]);
                } else if (object.value[x].nodeType === Node.TEXT_NODE) {
                  value += object.value[x].nodeValue;
                }
              }
            }
            triple.object = {};
            if (object.type === RDF_OBJECT) {
              if (object.value.indexOf('_:') === 0) {
                triple.object.type = 'blank node';
              } else {
                triple.object.type = 'IRI';
              }
            } else {
              triple.object.type = 'literal';
              if (object.type === RDF_PLAIN_LITERAL) {
                if (object.language) {
                  triple.object.datatype = RDF_LANGSTRING;
                  triple.object.language = object.language;
                } else {
                  triple.object.datatype = XSD_STRING;
                }
              } else {
                triple.object.datatype = object.type;
              }
            }
            triple.object.value = value;
            dataset['@default'].push(triple);
          }
        }
      }
      return dataset;
    }
    jsonld.registerRDFParser('rdfa-api', _parseRdfaApiData);
    function IdentifierIssuer(prefix) {
      this.prefix = prefix;
      this.counter = 0;
      this.existing = {};
    }
    jsonld.IdentifierIssuer = IdentifierIssuer;
    jsonld.UniqueNamer = IdentifierIssuer;
    IdentifierIssuer.prototype.clone = function() {
      var copy = new IdentifierIssuer(this.prefix);
      copy.counter = this.counter;
      copy.existing = _clone(this.existing);
      return copy;
    };
    IdentifierIssuer.prototype.getId = function(old) {
      if (old && old in this.existing) {
        return this.existing[old];
      }
      var identifier = this.prefix + this.counter;
      this.counter += 1;
      if (old) {
        this.existing[old] = identifier;
      }
      return identifier;
    };
    IdentifierIssuer.prototype.getName = IdentifierIssuer.prototype.getName;
    IdentifierIssuer.prototype.hasId = function(old) {
      return (old in this.existing);
    };
    IdentifierIssuer.prototype.isNamed = IdentifierIssuer.prototype.hasId;
    var Permutator = function(list) {
      this.list = list.sort();
      this.done = false;
      this.left = {};
      for (var i = 0; i < list.length; ++i) {
        this.left[list[i]] = true;
      }
    };
    Permutator.prototype.hasNext = function() {
      return !this.done;
    };
    Permutator.prototype.next = function() {
      var rval = this.list.slice();
      var k = null;
      var pos = 0;
      var length = this.list.length;
      for (var i = 0; i < length; ++i) {
        var element = this.list[i];
        var left = this.left[element];
        if ((k === null || element > k) && ((left && i > 0 && element > this.list[i - 1]) || (!left && i < (length - 1) && element > this.list[i + 1]))) {
          k = element;
          pos = i;
        }
      }
      if (k === null) {
        this.done = true;
      } else {
        var swap = this.left[k] ? pos - 1 : pos + 1;
        this.list[pos] = this.list[swap];
        this.list[swap] = k;
        for (var i = 0; i < length; ++i) {
          if (this.list[i] > k) {
            this.left[this.list[i]] = !this.left[this.list[i]];
          }
        }
      }
      return rval;
    };
    var NormalizeHash = function(algorithm) {
      if (!(this instanceof NormalizeHash)) {
        return new NormalizeHash(algorithm);
      }
      if (['URDNA2015', 'URGNA2012'].indexOf(algorithm) === -1) {
        throw new Error('Invalid RDF Dataset Normalization algorithm: ' + algorithm);
      }
      NormalizeHash._init.call(this, algorithm);
    };
    NormalizeHash.hashNQuads = function(algorithm, nquads) {
      var md = new NormalizeHash(algorithm);
      for (var i = 0; i < nquads.length; ++i) {
        md.update(nquads[i]);
      }
      return md.digest();
    };
    (function(_nodejs) {
      if (_nodejs) {
        var crypto = require('crypto');
        NormalizeHash._init = function(algorithm) {
          if (algorithm === 'URDNA2015') {
            algorithm = 'sha256';
          } else {
            algorithm = 'sha1';
          }
          this.md = crypto.createHash(algorithm);
        };
        NormalizeHash.prototype.update = function(msg) {
          return this.md.update(msg, 'utf8');
        };
        NormalizeHash.prototype.digest = function() {
          return this.md.digest('hex');
        };
        return;
      }
      NormalizeHash._init = function(algorithm) {
        if (algorithm === 'URDNA2015') {
          algorithm = new sha256.Algorithm();
        } else {
          algorithm = new sha1.Algorithm();
        }
        this.md = new MessageDigest(algorithm);
      };
      NormalizeHash.prototype.update = function(msg) {
        return this.md.update(msg);
      };
      NormalizeHash.prototype.digest = function() {
        return this.md.digest().toHex();
      };
      var MessageDigest = function(algorithm) {
        if (!(this instanceof MessageDigest)) {
          return new MessageDigest(algorithm);
        }
        this._algorithm = algorithm;
        if (!MessageDigest._padding || MessageDigest._padding.length < this._algorithm.blockSize) {
          MessageDigest._padding = String.fromCharCode(128);
          var c = String.fromCharCode(0x00);
          var n = 64;
          while (n > 0) {
            if (n & 1) {
              MessageDigest._padding += c;
            }
            n >>>= 1;
            if (n > 0) {
              c += c;
            }
          }
        }
        this.start();
      };
      MessageDigest.prototype.start = function() {
        this.messageLength = 0;
        this.fullMessageLength = [];
        var int32s = this._algorithm.messageLengthSize / 4;
        for (var i = 0; i < int32s; ++i) {
          this.fullMessageLength.push(0);
        }
        this._input = new MessageDigest.ByteBuffer();
        this.state = this._algorithm.start();
        return this;
      };
      MessageDigest.prototype.update = function(msg) {
        msg = new MessageDigest.ByteBuffer(unescape(encodeURIComponent(msg)));
        this.messageLength += msg.length();
        var len = msg.length();
        len = [(len / 0x100000000) >>> 0, len >>> 0];
        for (var i = this.fullMessageLength.length - 1; i >= 0; --i) {
          this.fullMessageLength[i] += len[1];
          len[1] = len[0] + ((this.fullMessageLength[i] / 0x100000000) >>> 0);
          this.fullMessageLength[i] = this.fullMessageLength[i] >>> 0;
          len[0] = ((len[1] / 0x100000000) >>> 0);
        }
        this._input.putBytes(msg.bytes());
        while (this._input.length() >= this._algorithm.blockSize) {
          this.state = this._algorithm.digest(this.state, this._input);
        }
        if (this._input.read > 2048 || this._input.length() === 0) {
          this._input.compact();
        }
        return this;
      };
      MessageDigest.prototype.digest = function() {
        var finalBlock = new MessageDigest.ByteBuffer();
        finalBlock.putBytes(this._input.bytes());
        var remaining = (this.fullMessageLength[this.fullMessageLength.length - 1] + this._algorithm.messageLengthSize);
        var overflow = remaining & (this._algorithm.blockSize - 1);
        finalBlock.putBytes(MessageDigest._padding.substr(0, this._algorithm.blockSize - overflow));
        var messageLength = new MessageDigest.ByteBuffer();
        for (var i = 0; i < this.fullMessageLength.length; ++i) {
          messageLength.putInt32((this.fullMessageLength[i] << 3) | (this.fullMessageLength[i + 1] >>> 28));
        }
        this._algorithm.writeMessageLength(finalBlock, messageLength);
        var state = this._algorithm.digest(this.state.copy(), finalBlock);
        var rval = new MessageDigest.ByteBuffer();
        state.write(rval);
        return rval;
      };
      MessageDigest.ByteBuffer = function(data) {
        if (typeof data === 'string') {
          this.data = data;
        } else {
          this.data = '';
        }
        this.read = 0;
      };
      MessageDigest.ByteBuffer.prototype.putInt32 = function(i) {
        this.data += (String.fromCharCode(i >> 24 & 0xFF) + String.fromCharCode(i >> 16 & 0xFF) + String.fromCharCode(i >> 8 & 0xFF) + String.fromCharCode(i & 0xFF));
      };
      MessageDigest.ByteBuffer.prototype.getInt32 = function() {
        var rval = (this.data.charCodeAt(this.read) << 24 ^ this.data.charCodeAt(this.read + 1) << 16 ^ this.data.charCodeAt(this.read + 2) << 8 ^ this.data.charCodeAt(this.read + 3));
        this.read += 4;
        return rval;
      };
      MessageDigest.ByteBuffer.prototype.putBytes = function(bytes) {
        this.data += bytes;
      };
      MessageDigest.ByteBuffer.prototype.bytes = function() {
        return this.data.slice(this.read);
      };
      MessageDigest.ByteBuffer.prototype.length = function() {
        return this.data.length - this.read;
      };
      MessageDigest.ByteBuffer.prototype.compact = function() {
        this.data = this.data.slice(this.read);
        this.read = 0;
      };
      MessageDigest.ByteBuffer.prototype.toHex = function() {
        var rval = '';
        for (var i = this.read; i < this.data.length; ++i) {
          var b = this.data.charCodeAt(i);
          if (b < 16) {
            rval += '0';
          }
          rval += b.toString(16);
        }
        return rval;
      };
      var sha1 = {_w: null};
      sha1.Algorithm = function() {
        this.name = 'sha1', this.blockSize = 64;
        this.digestLength = 20;
        this.messageLengthSize = 8;
      };
      sha1.Algorithm.prototype.start = function() {
        if (!sha1._w) {
          sha1._w = new Array(80);
        }
        return sha1._createState();
      };
      sha1.Algorithm.prototype.writeMessageLength = function(finalBlock, messageLength) {
        finalBlock.putBytes(messageLength.bytes());
      };
      sha1.Algorithm.prototype.digest = function(s, input) {
        var t,
            a,
            b,
            c,
            d,
            e,
            f,
            i;
        var len = input.length();
        var _w = sha1._w;
        while (len >= 64) {
          a = s.h0;
          b = s.h1;
          c = s.h2;
          d = s.h3;
          e = s.h4;
          for (i = 0; i < 16; ++i) {
            t = input.getInt32();
            _w[i] = t;
            f = d ^ (b & (c ^ d));
            t = ((a << 5) | (a >>> 27)) + f + e + 0x5A827999 + t;
            e = d;
            d = c;
            c = (b << 30) | (b >>> 2);
            b = a;
            a = t;
          }
          for (; i < 20; ++i) {
            t = (_w[i - 3] ^ _w[i - 8] ^ _w[i - 14] ^ _w[i - 16]);
            t = (t << 1) | (t >>> 31);
            _w[i] = t;
            f = d ^ (b & (c ^ d));
            t = ((a << 5) | (a >>> 27)) + f + e + 0x5A827999 + t;
            e = d;
            d = c;
            c = (b << 30) | (b >>> 2);
            b = a;
            a = t;
          }
          for (; i < 32; ++i) {
            t = (_w[i - 3] ^ _w[i - 8] ^ _w[i - 14] ^ _w[i - 16]);
            t = (t << 1) | (t >>> 31);
            _w[i] = t;
            f = b ^ c ^ d;
            t = ((a << 5) | (a >>> 27)) + f + e + 0x6ED9EBA1 + t;
            e = d;
            d = c;
            c = (b << 30) | (b >>> 2);
            b = a;
            a = t;
          }
          for (; i < 40; ++i) {
            t = (_w[i - 6] ^ _w[i - 16] ^ _w[i - 28] ^ _w[i - 32]);
            t = (t << 2) | (t >>> 30);
            _w[i] = t;
            f = b ^ c ^ d;
            t = ((a << 5) | (a >>> 27)) + f + e + 0x6ED9EBA1 + t;
            e = d;
            d = c;
            c = (b << 30) | (b >>> 2);
            b = a;
            a = t;
          }
          for (; i < 60; ++i) {
            t = (_w[i - 6] ^ _w[i - 16] ^ _w[i - 28] ^ _w[i - 32]);
            t = (t << 2) | (t >>> 30);
            _w[i] = t;
            f = (b & c) | (d & (b ^ c));
            t = ((a << 5) | (a >>> 27)) + f + e + 0x8F1BBCDC + t;
            e = d;
            d = c;
            c = (b << 30) | (b >>> 2);
            b = a;
            a = t;
          }
          for (; i < 80; ++i) {
            t = (_w[i - 6] ^ _w[i - 16] ^ _w[i - 28] ^ _w[i - 32]);
            t = (t << 2) | (t >>> 30);
            _w[i] = t;
            f = b ^ c ^ d;
            t = ((a << 5) | (a >>> 27)) + f + e + 0xCA62C1D6 + t;
            e = d;
            d = c;
            c = (b << 30) | (b >>> 2);
            b = a;
            a = t;
          }
          s.h0 = (s.h0 + a) | 0;
          s.h1 = (s.h1 + b) | 0;
          s.h2 = (s.h2 + c) | 0;
          s.h3 = (s.h3 + d) | 0;
          s.h4 = (s.h4 + e) | 0;
          len -= 64;
        }
        return s;
      };
      sha1._createState = function() {
        var state = {
          h0: 0x67452301,
          h1: 0xEFCDAB89,
          h2: 0x98BADCFE,
          h3: 0x10325476,
          h4: 0xC3D2E1F0
        };
        state.copy = function() {
          var rval = sha1._createState();
          rval.h0 = state.h0;
          rval.h1 = state.h1;
          rval.h2 = state.h2;
          rval.h3 = state.h3;
          rval.h4 = state.h4;
          return rval;
        };
        state.write = function(buffer) {
          buffer.putInt32(state.h0);
          buffer.putInt32(state.h1);
          buffer.putInt32(state.h2);
          buffer.putInt32(state.h3);
          buffer.putInt32(state.h4);
        };
        return state;
      };
      var sha256 = {
        _k: null,
        _w: null
      };
      sha256.Algorithm = function() {
        this.name = 'sha256', this.blockSize = 64;
        this.digestLength = 32;
        this.messageLengthSize = 8;
      };
      sha256.Algorithm.prototype.start = function() {
        if (!sha256._k) {
          sha256._init();
        }
        return sha256._createState();
      };
      sha256.Algorithm.prototype.writeMessageLength = function(finalBlock, messageLength) {
        finalBlock.putBytes(messageLength.bytes());
      };
      sha256.Algorithm.prototype.digest = function(s, input) {
        var t1,
            t2,
            s0,
            s1,
            ch,
            maj,
            i,
            a,
            b,
            c,
            d,
            e,
            f,
            g,
            h;
        var len = input.length();
        var _k = sha256._k;
        var _w = sha256._w;
        while (len >= 64) {
          for (i = 0; i < 16; ++i) {
            _w[i] = input.getInt32();
          }
          for (; i < 64; ++i) {
            t1 = _w[i - 2];
            t1 = ((t1 >>> 17) | (t1 << 15)) ^ ((t1 >>> 19) | (t1 << 13)) ^ (t1 >>> 10);
            t2 = _w[i - 15];
            t2 = ((t2 >>> 7) | (t2 << 25)) ^ ((t2 >>> 18) | (t2 << 14)) ^ (t2 >>> 3);
            _w[i] = (t1 + _w[i - 7] + t2 + _w[i - 16]) | 0;
          }
          a = s.h0;
          b = s.h1;
          c = s.h2;
          d = s.h3;
          e = s.h4;
          f = s.h5;
          g = s.h6;
          h = s.h7;
          for (i = 0; i < 64; ++i) {
            s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
            ch = g ^ (e & (f ^ g));
            s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
            maj = (a & b) | (c & (a ^ b));
            t1 = h + s1 + ch + _k[i] + _w[i];
            t2 = s0 + maj;
            h = g;
            g = f;
            f = e;
            e = (d + t1) | 0;
            d = c;
            c = b;
            b = a;
            a = (t1 + t2) | 0;
          }
          s.h0 = (s.h0 + a) | 0;
          s.h1 = (s.h1 + b) | 0;
          s.h2 = (s.h2 + c) | 0;
          s.h3 = (s.h3 + d) | 0;
          s.h4 = (s.h4 + e) | 0;
          s.h5 = (s.h5 + f) | 0;
          s.h6 = (s.h6 + g) | 0;
          s.h7 = (s.h7 + h) | 0;
          len -= 64;
        }
        return s;
      };
      sha256._createState = function() {
        var state = {
          h0: 0x6A09E667,
          h1: 0xBB67AE85,
          h2: 0x3C6EF372,
          h3: 0xA54FF53A,
          h4: 0x510E527F,
          h5: 0x9B05688C,
          h6: 0x1F83D9AB,
          h7: 0x5BE0CD19
        };
        state.copy = function() {
          var rval = sha256._createState();
          rval.h0 = state.h0;
          rval.h1 = state.h1;
          rval.h2 = state.h2;
          rval.h3 = state.h3;
          rval.h4 = state.h4;
          rval.h5 = state.h5;
          rval.h6 = state.h6;
          rval.h7 = state.h7;
          return rval;
        };
        state.write = function(buffer) {
          buffer.putInt32(state.h0);
          buffer.putInt32(state.h1);
          buffer.putInt32(state.h2);
          buffer.putInt32(state.h3);
          buffer.putInt32(state.h4);
          buffer.putInt32(state.h5);
          buffer.putInt32(state.h6);
          buffer.putInt32(state.h7);
        };
        return state;
      };
      sha256._init = function() {
        sha256._k = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
        sha256._w = new Array(64);
      };
    })(_nodejs);
    if (!XMLSerializer) {
      var _defineXMLSerializer = function() {
        XMLSerializer = require('xmldom').XMLSerializer;
      };
    }
    jsonld.url = {};
    jsonld.url.parsers = {
      simple: {
        keys: ['href', 'scheme', 'authority', 'path', 'query', 'fragment'],
        regex: /^(?:([^:\/?#]+):)?(?:\/\/([^\/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?/
      },
      full: {
        keys: ['href', 'protocol', 'scheme', 'authority', 'auth', 'user', 'password', 'hostname', 'port', 'path', 'directory', 'file', 'query', 'fragment'],
        regex: /^(([^:\/?#]+):)?(?:\/\/((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?))?(?:(((?:[^?#\/]*\/)*)([^?#]*))(?:\?([^#]*))?(?:#(.*))?)/
      }
    };
    jsonld.url.parse = function(str, parser) {
      var parsed = {};
      var o = jsonld.url.parsers[parser || 'full'];
      var m = o.regex.exec(str);
      var i = o.keys.length;
      while (i--) {
        parsed[o.keys[i]] = (m[i] === undefined) ? null : m[i];
      }
      parsed.normalizedPath = _removeDotSegments(parsed.path, !!parsed.authority);
      return parsed;
    };
    function _removeDotSegments(path, hasAuthority) {
      var rval = '';
      if (path.indexOf('/') === 0) {
        rval = '/';
      }
      var input = path.split('/');
      var output = [];
      while (input.length > 0) {
        if (input[0] === '.' || (input[0] === '' && input.length > 1)) {
          input.shift();
          continue;
        }
        if (input[0] === '..') {
          input.shift();
          if (hasAuthority || (output.length > 0 && output[output.length - 1] !== '..')) {
            output.pop();
          } else {
            output.push('..');
          }
          continue;
        }
        output.push(input.shift());
      }
      return rval + output.join('/');
    }
    if (_nodejs) {
      jsonld.useDocumentLoader('node');
    } else if (typeof XMLHttpRequest !== 'undefined') {
      jsonld.useDocumentLoader('xhr');
    }
    if (_nodejs) {
      jsonld.use = function(extension) {
        switch (extension) {
          case 'request':
            jsonld.request = require('jsonld-request');
            break;
          default:
            throw new JsonLdError('Unknown extension.', 'jsonld.UnknownExtension', {extension: extension});
        }
      };
      var _module = {
        exports: {},
        filename: __dirname
      };
      require('pkginfo')(_module, 'version');
      jsonld.version = _module.exports.version;
    }
    return jsonld;
  };
  var factory = function() {
    return wrapper(function() {
      return factory();
    });
  };
  if (!_nodejs && (typeof define === 'function' && define.amd)) {
    define("b", [], function() {
      wrapper(factory);
      return factory;
    });
  } else {
    wrapper(factory);
    if (typeof require === 'function' && typeof module !== 'undefined' && module.exports) {
      module.exports = factory;
    }
    if (_browser) {
      if (typeof jsonld === 'undefined') {
        jsonld = jsonldjs = factory;
      } else {
        jsonldjs = factory;
      }
    }
  }
  return factory;
})();

_removeDefine();
})();
(function() {
var _removeDefine = $__System.get("@@amd-helpers").createDefine();
define("c", ["b"], function(main) {
  return main;
});

_removeDefine();
})();
$__System.registerDynamic("d", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $Object = Object;
  module.exports = {
    create: $Object.create,
    getProto: $Object.getPrototypeOf,
    isEnum: {}.propertyIsEnumerable,
    getDesc: $Object.getOwnPropertyDescriptor,
    setDesc: $Object.defineProperty,
    setDescs: $Object.defineProperties,
    getKeys: $Object.keys,
    getNames: $Object.getOwnPropertyNames,
    getSymbols: $Object.getOwnPropertySymbols,
    each: [].forEach
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("e", ["d"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = req('d');
  module.exports = function defineProperty(it, key, desc) {
    return $.setDesc(it, key, desc);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("f", ["e"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": req('e'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("10", ["f"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  "use strict";
  var _Object$defineProperty = req('f')["default"];
  exports["default"] = (function() {
    function defineProperties(target, props) {
      for (var i = 0; i < props.length; i++) {
        var descriptor = props[i];
        descriptor.enumerable = descriptor.enumerable || false;
        descriptor.configurable = true;
        if ("value" in descriptor)
          descriptor.writable = true;
        _Object$defineProperty(target, descriptor.key, descriptor);
      }
    }
    return function(Constructor, protoProps, staticProps) {
      if (protoProps)
        defineProperties(Constructor.prototype, protoProps);
      if (staticProps)
        defineProperties(Constructor, staticProps);
      return Constructor;
    };
  })();
  exports.__esModule = true;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("11", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  "use strict";
  exports["default"] = function(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
      throw new TypeError("Cannot call a class as a function");
    }
  };
  exports.__esModule = true;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("12", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var ceil = Math.ceil,
      floor = Math.floor;
  module.exports = function(it) {
    return isNaN(it = +it) ? 0 : (it > 0 ? floor : ceil)(it);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("13", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = function(it) {
    if (it == undefined)
      throw TypeError("Can't call method on  " + it);
    return it;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("14", ["12", "13"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var toInteger = req('12'),
      defined = req('13');
  module.exports = function(TO_STRING) {
    return function(that, pos) {
      var s = String(defined(that)),
          i = toInteger(pos),
          l = s.length,
          a,
          b;
      if (i < 0 || i >= l)
        return TO_STRING ? '' : undefined;
      a = s.charCodeAt(i);
      return a < 0xd800 || a > 0xdbff || i + 1 === l || (b = s.charCodeAt(i + 1)) < 0xdc00 || b > 0xdfff ? TO_STRING ? s.charAt(i) : a : TO_STRING ? s.slice(i, i + 2) : (a - 0xd800 << 10) + (b - 0xdc00) + 0x10000;
    };
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("15", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = true;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("16", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var global = module.exports = typeof window != 'undefined' && window.Math == Math ? window : typeof self != 'undefined' && self.Math == Math ? self : Function('return this')();
  if (typeof __g == 'number')
    __g = global;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("17", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var core = module.exports = {version: '1.2.3'};
  if (typeof __e == 'number')
    __e = core;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("18", ["16", "17"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var global = req('16'),
      core = req('17'),
      PROTOTYPE = 'prototype';
  var ctx = function(fn, that) {
    return function() {
      return fn.apply(that, arguments);
    };
  };
  var $def = function(type, name, source) {
    var key,
        own,
        out,
        exp,
        isGlobal = type & $def.G,
        isProto = type & $def.P,
        target = isGlobal ? global : type & $def.S ? global[name] : (global[name] || {})[PROTOTYPE],
        exports = isGlobal ? core : core[name] || (core[name] = {});
    if (isGlobal)
      source = name;
    for (key in source) {
      own = !(type & $def.F) && target && key in target;
      if (own && key in exports)
        continue;
      out = own ? target[key] : source[key];
      if (isGlobal && typeof target[key] != 'function')
        exp = source[key];
      else if (type & $def.B && own)
        exp = ctx(out, global);
      else if (type & $def.W && target[key] == out)
        !function(C) {
          exp = function(param) {
            return this instanceof C ? new C(param) : C(param);
          };
          exp[PROTOTYPE] = C[PROTOTYPE];
        }(out);
      else
        exp = isProto && typeof out == 'function' ? ctx(Function.call, out) : out;
      exports[key] = exp;
      if (isProto)
        (exports[PROTOTYPE] || (exports[PROTOTYPE] = {}))[key] = out;
    }
  };
  $def.F = 1;
  $def.G = 2;
  $def.S = 4;
  $def.P = 8;
  $def.B = 16;
  $def.W = 32;
  module.exports = $def;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("19", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = function(bitmap, value) {
    return {
      enumerable: !(bitmap & 1),
      configurable: !(bitmap & 2),
      writable: !(bitmap & 4),
      value: value
    };
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1a", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = function(exec) {
    try {
      return !!exec();
    } catch (e) {
      return true;
    }
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1b", ["1a"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = !req('1a')(function() {
    return Object.defineProperty({}, 'a', {get: function() {
        return 7;
      }}).a != 7;
  });
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1c", ["d", "19", "1b"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = req('d'),
      createDesc = req('19');
  module.exports = req('1b') ? function(object, key, value) {
    return $.setDesc(object, key, createDesc(1, value));
  } : function(object, key, value) {
    object[key] = value;
    return object;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1d", ["1c"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = req('1c');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1e", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var hasOwnProperty = {}.hasOwnProperty;
  module.exports = function(it, key) {
    return hasOwnProperty.call(it, key);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1f", ["16"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var global = req('16'),
      SHARED = '__core-js_shared__',
      store = global[SHARED] || (global[SHARED] = {});
  module.exports = function(key) {
    return store[key] || (store[key] = {});
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("20", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var id = 0,
      px = Math.random();
  module.exports = function(key) {
    return 'Symbol('.concat(key === undefined ? '' : key, ')_', (++id + px).toString(36));
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("21", ["1f", "16", "20"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var store = req('1f')('wks'),
      Symbol = req('16').Symbol;
  module.exports = function(name) {
    return store[name] || (store[name] = Symbol && Symbol[name] || (Symbol || req('20'))('Symbol.' + name));
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("22", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {};
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("23", ["d", "1e", "21"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var def = req('d').setDesc,
      has = req('1e'),
      TAG = req('21')('toStringTag');
  module.exports = function(it, tag, stat) {
    if (it && !has(it = stat ? it : it.prototype, TAG))
      def(it, TAG, {
        configurable: true,
        value: tag
      });
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("24", ["d", "1c", "21", "19", "23"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var $ = req('d'),
      IteratorPrototype = {};
  req('1c')(IteratorPrototype, req('21')('iterator'), function() {
    return this;
  });
  module.exports = function(Constructor, NAME, next) {
    Constructor.prototype = $.create(IteratorPrototype, {next: req('19')(1, next)});
    req('23')(Constructor, NAME + ' Iterator');
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("25", ["15", "18", "1d", "1c", "1e", "21", "22", "24", "d", "23"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var LIBRARY = req('15'),
      $def = req('18'),
      $redef = req('1d'),
      hide = req('1c'),
      has = req('1e'),
      SYMBOL_ITERATOR = req('21')('iterator'),
      Iterators = req('22'),
      BUGGY = !([].keys && 'next' in [].keys()),
      FF_ITERATOR = '@@iterator',
      KEYS = 'keys',
      VALUES = 'values';
  var returnThis = function() {
    return this;
  };
  module.exports = function(Base, NAME, Constructor, next, DEFAULT, IS_SET, FORCE) {
    req('24')(Constructor, NAME, next);
    var createMethod = function(kind) {
      switch (kind) {
        case KEYS:
          return function keys() {
            return new Constructor(this, kind);
          };
        case VALUES:
          return function values() {
            return new Constructor(this, kind);
          };
      }
      return function entries() {
        return new Constructor(this, kind);
      };
    };
    var TAG = NAME + ' Iterator',
        proto = Base.prototype,
        _native = proto[SYMBOL_ITERATOR] || proto[FF_ITERATOR] || DEFAULT && proto[DEFAULT],
        _default = _native || createMethod(DEFAULT),
        methods,
        key;
    if (_native) {
      var IteratorPrototype = req('d').getProto(_default.call(new Base));
      req('23')(IteratorPrototype, TAG, true);
      if (!LIBRARY && has(proto, FF_ITERATOR))
        hide(IteratorPrototype, SYMBOL_ITERATOR, returnThis);
    }
    if (!LIBRARY || FORCE)
      hide(proto, SYMBOL_ITERATOR, _default);
    Iterators[NAME] = _default;
    Iterators[TAG] = returnThis;
    if (DEFAULT) {
      methods = {
        values: DEFAULT == VALUES ? _default : createMethod(VALUES),
        keys: IS_SET ? _default : createMethod(KEYS),
        entries: DEFAULT != VALUES ? _default : createMethod('entries')
      };
      if (FORCE)
        for (key in methods) {
          if (!(key in proto))
            $redef(proto, key, methods[key]);
        }
      else
        $def($def.P + $def.F * BUGGY, NAME, methods);
    }
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("26", ["14", "25"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var $at = req('14')(true);
  req('25')(String, 'String', function(iterated) {
    this._t = String(iterated);
    this._i = 0;
  }, function() {
    var O = this._t,
        index = this._i,
        point;
    if (index >= O.length)
      return {
        value: undefined,
        done: true
      };
    point = $at(O, index);
    this._i += point.length;
    return {
      value: point,
      done: false
    };
  });
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("27", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = function(it) {
    if (typeof it != 'function')
      throw TypeError(it + ' is not a function!');
    return it;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("28", ["27"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var aFunction = req('27');
  module.exports = function(fn, that, length) {
    aFunction(fn);
    if (that === undefined)
      return fn;
    switch (length) {
      case 1:
        return function(a) {
          return fn.call(that, a);
        };
      case 2:
        return function(a, b) {
          return fn.call(that, a, b);
        };
      case 3:
        return function(a, b, c) {
          return fn.call(that, a, b, c);
        };
    }
    return function() {
      return fn.apply(that, arguments);
    };
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("29", ["13"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var defined = req('13');
  module.exports = function(it) {
    return Object(defined(it));
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2a", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = function(it) {
    return typeof it === 'object' ? it !== null : typeof it === 'function';
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2b", ["2a"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var isObject = req('2a');
  module.exports = function(it) {
    if (!isObject(it))
      throw TypeError(it + ' is not an object!');
    return it;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2c", ["2b"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var anObject = req('2b');
  module.exports = function(iterator, fn, value, entries) {
    try {
      return entries ? fn(anObject(value)[0], value[1]) : fn(value);
    } catch (e) {
      var ret = iterator['return'];
      if (ret !== undefined)
        anObject(ret.call(iterator));
      throw e;
    }
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2d", ["22", "21"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var Iterators = req('22'),
      ITERATOR = req('21')('iterator');
  module.exports = function(it) {
    return (Iterators.Array || Array.prototype[ITERATOR]) === it;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2e", ["12"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var toInteger = req('12'),
      min = Math.min;
  module.exports = function(it) {
    return it > 0 ? min(toInteger(it), 0x1fffffffffffff) : 0;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2f", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var toString = {}.toString;
  module.exports = function(it) {
    return toString.call(it).slice(8, -1);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("30", ["2f", "21"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var cof = req('2f'),
      TAG = req('21')('toStringTag'),
      ARG = cof(function() {
        return arguments;
      }()) == 'Arguments';
  module.exports = function(it) {
    var O,
        T,
        B;
    return it === undefined ? 'Undefined' : it === null ? 'Null' : typeof(T = (O = Object(it))[TAG]) == 'string' ? T : ARG ? cof(O) : (B = cof(O)) == 'Object' && typeof O.callee == 'function' ? 'Arguments' : B;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("31", ["30", "21", "22", "17"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var classof = req('30'),
      ITERATOR = req('21')('iterator'),
      Iterators = req('22');
  module.exports = req('17').getIteratorMethod = function(it) {
    if (it != undefined)
      return it[ITERATOR] || it['@@iterator'] || Iterators[classof(it)];
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("32", ["21"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var SYMBOL_ITERATOR = req('21')('iterator'),
      SAFE_CLOSING = false;
  try {
    var riter = [7][SYMBOL_ITERATOR]();
    riter['return'] = function() {
      SAFE_CLOSING = true;
    };
    Array.from(riter, function() {
      throw 2;
    });
  } catch (e) {}
  module.exports = function(exec, skipClosing) {
    if (!skipClosing && !SAFE_CLOSING)
      return false;
    var safe = false;
    try {
      var arr = [7],
          iter = arr[SYMBOL_ITERATOR]();
      iter.next = function() {
        safe = true;
      };
      arr[SYMBOL_ITERATOR] = function() {
        return iter;
      };
      exec(arr);
    } catch (e) {}
    return safe;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("33", ["28", "18", "29", "2c", "2d", "2e", "31", "32"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var ctx = req('28'),
      $def = req('18'),
      toObject = req('29'),
      call = req('2c'),
      isArrayIter = req('2d'),
      toLength = req('2e'),
      getIterFn = req('31');
  $def($def.S + $def.F * !req('32')(function(iter) {
    Array.from(iter);
  }), 'Array', {from: function from(arrayLike) {
      var O = toObject(arrayLike),
          C = typeof this == 'function' ? this : Array,
          $$ = arguments,
          $$len = $$.length,
          mapfn = $$len > 1 ? $$[1] : undefined,
          mapping = mapfn !== undefined,
          index = 0,
          iterFn = getIterFn(O),
          length,
          result,
          step,
          iterator;
      if (mapping)
        mapfn = ctx(mapfn, $$len > 2 ? $$[2] : undefined, 2);
      if (iterFn != undefined && !(C == Array && isArrayIter(iterFn))) {
        for (iterator = iterFn.call(O), result = new C; !(step = iterator.next()).done; index++) {
          result[index] = mapping ? call(iterator, mapfn, [step.value, index], true) : step.value;
        }
      } else {
        length = toLength(O.length);
        for (result = new C(length); length > index; index++) {
          result[index] = mapping ? mapfn(O[index], index) : O[index];
        }
      }
      result.length = index;
      return result;
    }});
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("34", ["26", "33", "17"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  req('26');
  req('33');
  module.exports = req('17').Array.from;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("35", ["34"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": req('34'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("36", ["35"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  "use strict";
  var _Array$from = req('35')["default"];
  exports["default"] = function(arr) {
    if (Array.isArray(arr)) {
      for (var i = 0,
          arr2 = Array(arr.length); i < arr.length; i++)
        arr2[i] = arr[i];
      return arr2;
    } else {
      return _Array$from(arr);
    }
  };
  exports.__esModule = true;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("37", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = function() {};
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("38", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = function(done, value) {
    return {
      value: value,
      done: !!done
    };
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("39", ["2f"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var cof = req('2f');
  module.exports = Object('z').propertyIsEnumerable(0) ? Object : function(it) {
    return cof(it) == 'String' ? it.split('') : Object(it);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3a", ["39", "13"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var IObject = req('39'),
      defined = req('13');
  module.exports = function(it) {
    return IObject(defined(it));
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3b", ["37", "38", "22", "3a", "25"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var setUnscope = req('37'),
      step = req('38'),
      Iterators = req('22'),
      toIObject = req('3a');
  req('25')(Array, 'Array', function(iterated, kind) {
    this._t = toIObject(iterated);
    this._i = 0;
    this._k = kind;
  }, function() {
    var O = this._t,
        kind = this._k,
        index = this._i++;
    if (!O || index >= O.length) {
      this._t = undefined;
      return step(1);
    }
    if (kind == 'keys')
      return step(0, index);
    if (kind == 'values')
      return step(0, O[index]);
    return step(0, [index, O[index]]);
  }, 'values');
  Iterators.Arguments = Iterators.Array;
  setUnscope('keys');
  setUnscope('values');
  setUnscope('entries');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3c", ["3b", "22"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  req('3b');
  var Iterators = req('22');
  Iterators.NodeList = Iterators.HTMLCollection = Iterators.Array;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3d", ["2b", "31", "17"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var anObject = req('2b'),
      get = req('31');
  module.exports = req('17').getIterator = function(it) {
    var iterFn = get(it);
    if (typeof iterFn != 'function')
      throw TypeError(it + ' is not iterable!');
    return anObject(iterFn.call(it));
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3e", ["3c", "26", "3d"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  req('3c');
  req('26');
  module.exports = req('3d');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3f", ["3e"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": req('3e'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("40", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  "format cjs";
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("41", ["d", "21", "1b"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var $ = req('d'),
      SPECIES = req('21')('species');
  module.exports = function(C) {
    if (req('1b') && !(SPECIES in C))
      $.setDesc(C, SPECIES, {
        configurable: true,
        get: function() {
          return this;
        }
      });
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("42", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = function(it, Constructor, name) {
    if (!(it instanceof Constructor))
      throw TypeError(name + ": use the 'new' operator!");
    return it;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("43", ["28", "2c", "2d", "2b", "2e", "31"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var ctx = req('28'),
      call = req('2c'),
      isArrayIter = req('2d'),
      anObject = req('2b'),
      toLength = req('2e'),
      getIterFn = req('31');
  module.exports = function(iterable, entries, fn, that) {
    var iterFn = getIterFn(iterable),
        f = ctx(fn, that, entries ? 2 : 1),
        index = 0,
        length,
        step,
        iterator;
    if (typeof iterFn != 'function')
      throw TypeError(iterable + ' is not iterable!');
    if (isArrayIter(iterFn))
      for (length = toLength(iterable.length); length > index; index++) {
        entries ? f(anObject(step = iterable[index])[0], step[1]) : f(iterable[index]);
      }
    else
      for (iterator = iterFn.call(iterable); !(step = iterator.next()).done; ) {
        call(iterator, f, step.value, entries);
      }
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("44", ["1d"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $redef = req('1d');
  module.exports = function(target, src) {
    for (var key in src)
      $redef(target, key, src[key]);
    return target;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("45", ["d", "1c", "28", "41", "42", "13", "43", "38", "20", "1e", "2a", "1b", "44", "25", "17"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var $ = req('d'),
      hide = req('1c'),
      ctx = req('28'),
      species = req('41'),
      strictNew = req('42'),
      defined = req('13'),
      forOf = req('43'),
      step = req('38'),
      ID = req('20')('id'),
      $has = req('1e'),
      isObject = req('2a'),
      isExtensible = Object.isExtensible || isObject,
      SUPPORT_DESC = req('1b'),
      SIZE = SUPPORT_DESC ? '_s' : 'size',
      id = 0;
  var fastKey = function(it, create) {
    if (!isObject(it))
      return typeof it == 'symbol' ? it : (typeof it == 'string' ? 'S' : 'P') + it;
    if (!$has(it, ID)) {
      if (!isExtensible(it))
        return 'F';
      if (!create)
        return 'E';
      hide(it, ID, ++id);
    }
    return 'O' + it[ID];
  };
  var getEntry = function(that, key) {
    var index = fastKey(key),
        entry;
    if (index !== 'F')
      return that._i[index];
    for (entry = that._f; entry; entry = entry.n) {
      if (entry.k == key)
        return entry;
    }
  };
  module.exports = {
    getConstructor: function(wrapper, NAME, IS_MAP, ADDER) {
      var C = wrapper(function(that, iterable) {
        strictNew(that, C, NAME);
        that._i = $.create(null);
        that._f = undefined;
        that._l = undefined;
        that[SIZE] = 0;
        if (iterable != undefined)
          forOf(iterable, IS_MAP, that[ADDER], that);
      });
      req('44')(C.prototype, {
        clear: function clear() {
          for (var that = this,
              data = that._i,
              entry = that._f; entry; entry = entry.n) {
            entry.r = true;
            if (entry.p)
              entry.p = entry.p.n = undefined;
            delete data[entry.i];
          }
          that._f = that._l = undefined;
          that[SIZE] = 0;
        },
        'delete': function(key) {
          var that = this,
              entry = getEntry(that, key);
          if (entry) {
            var next = entry.n,
                prev = entry.p;
            delete that._i[entry.i];
            entry.r = true;
            if (prev)
              prev.n = next;
            if (next)
              next.p = prev;
            if (that._f == entry)
              that._f = next;
            if (that._l == entry)
              that._l = prev;
            that[SIZE]--;
          }
          return !!entry;
        },
        forEach: function forEach(callbackfn) {
          var f = ctx(callbackfn, arguments.length > 1 ? arguments[1] : undefined, 3),
              entry;
          while (entry = entry ? entry.n : this._f) {
            f(entry.v, entry.k, this);
            while (entry && entry.r)
              entry = entry.p;
          }
        },
        has: function has(key) {
          return !!getEntry(this, key);
        }
      });
      if (SUPPORT_DESC)
        $.setDesc(C.prototype, 'size', {get: function() {
            return defined(this[SIZE]);
          }});
      return C;
    },
    def: function(that, key, value) {
      var entry = getEntry(that, key),
          prev,
          index;
      if (entry) {
        entry.v = value;
      } else {
        that._l = entry = {
          i: index = fastKey(key, true),
          k: key,
          v: value,
          p: prev = that._l,
          n: undefined,
          r: false
        };
        if (!that._f)
          that._f = entry;
        if (prev)
          prev.n = entry;
        that[SIZE]++;
        if (index !== 'F')
          that._i[index] = entry;
      }
      return that;
    },
    getEntry: getEntry,
    setStrong: function(C, NAME, IS_MAP) {
      req('25')(C, NAME, function(iterated, kind) {
        this._t = iterated;
        this._k = kind;
        this._l = undefined;
      }, function() {
        var that = this,
            kind = that._k,
            entry = that._l;
        while (entry && entry.r)
          entry = entry.p;
        if (!that._t || !(that._l = entry = entry ? entry.n : that._t._f)) {
          that._t = undefined;
          return step(1);
        }
        if (kind == 'keys')
          return step(0, entry.k);
        if (kind == 'values')
          return step(0, entry.v);
        return step(0, [entry.k, entry.v]);
      }, IS_MAP ? 'entries' : 'values', !IS_MAP, true);
      species(C);
      species(req('17')[NAME]);
    }
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("46", ["d", "18", "1c", "43", "42", "16", "1b", "1a", "44", "23"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var $ = req('d'),
      $def = req('18'),
      hide = req('1c'),
      forOf = req('43'),
      strictNew = req('42');
  module.exports = function(NAME, wrapper, methods, common, IS_MAP, IS_WEAK) {
    var Base = req('16')[NAME],
        C = Base,
        ADDER = IS_MAP ? 'set' : 'add',
        proto = C && C.prototype,
        O = {};
    if (!req('1b') || typeof C != 'function' || !(IS_WEAK || proto.forEach && !req('1a')(function() {
      new C().entries().next();
    }))) {
      C = common.getConstructor(wrapper, NAME, IS_MAP, ADDER);
      req('44')(C.prototype, methods);
    } else {
      C = wrapper(function(target, iterable) {
        strictNew(target, C, NAME);
        target._c = new Base;
        if (iterable != undefined)
          forOf(iterable, IS_MAP, target[ADDER], target);
      });
      $.each.call('add,clear,delete,forEach,get,has,set,keys,values,entries'.split(','), function(KEY) {
        var chain = KEY == 'add' || KEY == 'set';
        if (KEY in proto && !(IS_WEAK && KEY == 'clear'))
          hide(C.prototype, KEY, function(a, b) {
            var result = this._c[KEY](a === 0 ? 0 : a, b);
            return chain ? this : result;
          });
      });
      if ('size' in proto)
        $.setDesc(C.prototype, 'size', {get: function() {
            return this._c.size;
          }});
    }
    req('23')(C, NAME);
    O[NAME] = C;
    $def($def.G + $def.W + $def.F, O);
    if (!IS_WEAK)
      common.setStrong(C, NAME, IS_MAP);
    return C;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("47", ["45", "46"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var strong = req('45');
  req('46')('Set', function(get) {
    return function Set() {
      return get(this, arguments.length > 0 ? arguments[0] : undefined);
    };
  }, {add: function add(value) {
      return strong.def(this, value = value === 0 ? 0 : value, value);
    }}, strong);
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("48", ["43", "30"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var forOf = req('43'),
      classof = req('30');
  module.exports = function(NAME) {
    return function toJSON() {
      if (classof(this) != NAME)
        throw TypeError(NAME + "#toJSON isn't generic");
      var arr = [];
      forOf(this, false, arr.push, arr);
      return arr;
    };
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("49", ["18", "48"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $def = req('18');
  $def($def.P, 'Set', {toJSON: req('48')('Set')});
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4a", ["40", "26", "3c", "47", "49", "17"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  req('40');
  req('26');
  req('3c');
  req('47');
  req('49');
  module.exports = req('17').Set;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4b", ["4a"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": req('4a'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4c", [], false, function(__require, __exports, __module) {
  var _retrieveGlobal = $__System.get("@@global-helpers").prepareGlobal(__module.id, null, null);
  (function() {
    "format global";
    L.Control.Sidebar = L.Control.extend({
      includes: L.Mixin.Events,
      options: {position: 'left'},
      initialize: function(id, options) {
        var i,
            child;
        L.setOptions(this, options);
        this._sidebar = L.DomUtil.get(id);
        L.DomUtil.addClass(this._sidebar, 'sidebar-' + this.options.position);
        if (L.Browser.touch)
          L.DomUtil.addClass(this._sidebar, 'leaflet-touch');
        for (i = this._sidebar.children.length - 1; i >= 0; i--) {
          child = this._sidebar.children[i];
          if (child.tagName == 'DIV' && L.DomUtil.hasClass(child, 'sidebar-content'))
            this._container = child;
        }
        this._tabitems = this._sidebar.querySelectorAll('ul.sidebar-tabs > li, .sidebar-tabs > ul > li');
        for (i = this._tabitems.length - 1; i >= 0; i--) {
          this._tabitems[i]._sidebar = this;
        }
        this._panes = [];
        this._closeButtons = [];
        for (i = this._container.children.length - 1; i >= 0; i--) {
          child = this._container.children[i];
          if (child.tagName == 'DIV' && L.DomUtil.hasClass(child, 'sidebar-pane')) {
            this._panes.push(child);
            var closeButtons = child.querySelectorAll('.sidebar-close');
            for (var j = 0,
                len = closeButtons.length; j < len; j++)
              this._closeButtons.push(closeButtons[j]);
          }
        }
      },
      addTo: function(map) {
        var i,
            child;
        this._map = map;
        for (i = this._tabitems.length - 1; i >= 0; i--) {
          child = this._tabitems[i];
          L.DomEvent.on(child.querySelector('a'), 'click', L.DomEvent.preventDefault).on(child.querySelector('a'), 'click', this._onClick, child);
        }
        for (i = this._closeButtons.length - 1; i >= 0; i--) {
          child = this._closeButtons[i];
          L.DomEvent.on(child, 'click', this._onCloseClick, this);
        }
        return this;
      },
      removeFrom: function(map) {
        var i,
            child;
        this._map = null;
        for (i = this._tabitems.length - 1; i >= 0; i--) {
          child = this._tabitems[i];
          L.DomEvent.off(child.querySelector('a'), 'click', this._onClick);
        }
        for (i = this._closeButtons.length - 1; i >= 0; i--) {
          child = this._closeButtons[i];
          L.DomEvent.off(child, 'click', this._onCloseClick, this);
        }
        return this;
      },
      open: function(id) {
        var i,
            child;
        for (i = this._panes.length - 1; i >= 0; i--) {
          child = this._panes[i];
          if (child.id == id)
            L.DomUtil.addClass(child, 'active');
          else if (L.DomUtil.hasClass(child, 'active'))
            L.DomUtil.removeClass(child, 'active');
        }
        for (i = this._tabitems.length - 1; i >= 0; i--) {
          child = this._tabitems[i];
          if (child.querySelector('a').hash == '#' + id)
            L.DomUtil.addClass(child, 'active');
          else if (L.DomUtil.hasClass(child, 'active'))
            L.DomUtil.removeClass(child, 'active');
        }
        this.fire('content', {id: id});
        if (L.DomUtil.hasClass(this._sidebar, 'collapsed')) {
          this.fire('opening');
          L.DomUtil.removeClass(this._sidebar, 'collapsed');
        }
        return this;
      },
      close: function() {
        for (var i = this._tabitems.length - 1; i >= 0; i--) {
          var child = this._tabitems[i];
          if (L.DomUtil.hasClass(child, 'active'))
            L.DomUtil.removeClass(child, 'active');
        }
        if (!L.DomUtil.hasClass(this._sidebar, 'collapsed')) {
          this.fire('closing');
          L.DomUtil.addClass(this._sidebar, 'collapsed');
        }
        return this;
      },
      _onClick: function() {
        if (L.DomUtil.hasClass(this, 'active'))
          this._sidebar.close();
        else if (!L.DomUtil.hasClass(this, 'disabled'))
          this._sidebar.open(this.querySelector('a').hash.slice(1));
      },
      _onCloseClick: function() {
        this.close();
      }
    });
    L.control.sidebar = function(id, options) {
      return new L.Control.Sidebar(id, options);
    };
  })();
  return _retrieveGlobal();
});

$__System.register("4d", [], function() { return { setters: [], execute: function() {} } });

(function() {
var _removeDefine = $__System.get("@@amd-helpers").createDefine();
/^u/.test(typeof define) && function(a) {
  var b = this.require = function(b) {
    return a[b];
  };
  this.define = function(c, d) {
    a[c] = a[c] || d(b);
  };
}({}), define("4e", [], function() {
  function a(a) {
    return a.substr(0, 3);
  }
  function b(a) {
    return a != Fa ? "" + a : "";
  }
  function c(a) {
    return "string" == typeof a;
  }
  function d(a) {
    return !!a && "object" == typeof a;
  }
  function e(a) {
    return a && a.nodeType;
  }
  function f(a) {
    return "number" == typeof a;
  }
  function g(a) {
    return d(a) && !!a.getDay;
  }
  function h(a) {
    return !0 === a || !1 === a;
  }
  function i(a) {
    var b = typeof a;
    return "object" == b ? !(!a || !a.getDay) : "string" == b || "number" == b || h(a);
  }
  function j(a) {
    return a;
  }
  function k(a) {
    return a + 1;
  }
  function l(a, c, d) {
    return b(a).replace(c, d != Fa ? d : "");
  }
  function m(a) {
    return l(a, /[\\\[\]\/{}()*+?.$|^-]/g, "\\$&");
  }
  function n(a) {
    return l(a, /^\s+|\s+$/g);
  }
  function o(a, b, c) {
    for (var d in a)
      a.hasOwnProperty(d) && b.call(c || a, d, a[d]);
    return a;
  }
  function p(a, b, c) {
    if (a)
      for (var d = 0; d < a.length; d++)
        b.call(c || a, a[d], d);
    return a;
  }
  function q(a, b, c) {
    var d = [],
        e = ea(b) ? b : function(a) {
          return b != a;
        };
    return p(a, function(b, f) {
      e.call(c || a, b, f) && d.push(b);
    }), d;
  }
  function r(a, b, c, d) {
    var e = [];
    return a(b, function(a, f) {
      fa(a = c.call(d || b, a, f)) ? p(a, function(a) {
        e.push(a);
      }) : a != Fa && e.push(a);
    }), e;
  }
  function s(a, b, c) {
    return r(p, a, b, c);
  }
  function t(a) {
    var b = 0;
    return o(a, function() {
      b++;
    }), b;
  }
  function u(a) {
    var b = [];
    return o(a, function(a) {
      b.push(a);
    }), b;
  }
  function v(a, b, c) {
    var d = [];
    return p(a, function(e, f) {
      d.push(b.call(c || a, e, f));
    }), d;
  }
  function w(a, b) {
    if (fa(a)) {
      var c = wa(b);
      return M(G(a, 0, c.length), c);
    }
    return b != Fa && a.substr(0, b.length) == b;
  }
  function x(a, b) {
    if (fa(a)) {
      var c = wa(b);
      return M(G(a, -c.length), c) || !c.length;
    }
    return b != Fa && a.substr(a.length - b.length) == b;
  }
  function y(a) {
    var b = a.length;
    return fa(a) ? new va(v(a, function() {
      return a[--b];
    })) : l(a, /[\s\S]/g, function() {
      return a.charAt(--b);
    });
  }
  function z(a, b) {
    var c = {};
    return p(a, function(a) {
      c[a] = b;
    }), c;
  }
  function A(a, b) {
    var c,
        d = b || {};
    for (c in a)
      d[c] = a[c];
    return d;
  }
  function B(a, b) {
    for (var c = b,
        d = 0; d < a.length; d++)
      c = A(a[d], c);
    return c;
  }
  function C(a) {
    return ea(a) ? a : function(b, c) {
      return a === b ? c : void 0;
    };
  }
  function D(a, b, c) {
    return b == Fa ? c : 0 > b ? Math.max(a.length + b, 0) : Math.min(a.length, b);
  }
  function E(a, b, c, d) {
    b = C(b), d = D(a, d, a.length);
    for (var e = D(a, c, 0); d > e; e++)
      if ((c = b.call(a, a[e], e)) != Fa)
        return c;
  }
  function F(a, b, c, d) {
    b = C(b), d = D(a, d, -1);
    for (var e = D(a, c, a.length - 1); e > d; e--)
      if ((c = b.call(a, a[e], e)) != Fa)
        return c;
  }
  function G(a, b, c) {
    var d = [];
    if (a)
      for (c = D(a, c, a.length), b = D(a, b, 0); c > b; b++)
        d.push(a[b]);
    return d;
  }
  function H(a) {
    return v(a, j);
  }
  function I(a) {
    return function() {
      return new va(O(a, arguments));
    };
  }
  function J(a) {
    var b = {};
    return q(a, function(a) {
      return b[a] ? !1 : b[a] = 1;
    });
  }
  function K(a, b) {
    var c = z(b, 1);
    return q(a, function(a) {
      var b = c[a];
      return c[a] = 0, b;
    });
  }
  function L(a, b) {
    for (var c = 0; c < a.length; c++)
      if (a[c] == b)
        return !0;
    return !1;
  }
  function M(a, b) {
    var c,
        d = ea(a) ? a() : a,
        e = ea(b) ? b() : b;
    return d == e ? !0 : d == Fa || e == Fa ? !1 : i(d) || i(e) ? g(d) && g(e) && +d == +e : fa(d) ? d.length == e.length && !E(d, function(a, b) {
      return M(a, e[b]) ? void 0 : !0;
    }) : !fa(e) && (c = u(d)).length == t(e) && !E(c, function(a) {
      return M(d[a], e[a]) ? void 0 : !0;
    });
  }
  function N(a, b, c) {
    return ea(a) ? a.apply(c && b, v(c || b, j)) : void 0;
  }
  function O(a, b, c) {
    return v(a, function(a) {
      return N(a, b, c);
    });
  }
  function P(a, b, c, d) {
    return function() {
      return N(a, b, s([c, arguments, d], j));
    };
  }
  function Q(a, b) {
    for (var c = 0 > b ? "-" : "",
        d = (c ? -b : b).toFixed(0); d.length < a; )
      d = "0" + d;
    return c + d;
  }
  function R(a, b, c) {
    var d,
        e = 0,
        f = c ? b : y(b);
    return a = (c ? a : y(a)).replace(/./g, function(a) {
      return "0" == a ? (d = !1, f.charAt(e++) || "0") : "#" == a ? (d = !0, f.charAt(e++) || "") : d && !f.charAt(e) ? "" : a;
    }), c ? a : b.substr(0, b.length - e) + y(a);
  }
  function S(a, b, c) {
    return b != Fa && a ? 60 * parseFloat(a[b] + a[b + 1]) + parseFloat(a[b] + a[b + 2]) + c.getTimezoneOffset() : 0;
  }
  function T(a) {
    return new Date(+a);
  }
  function U(a, b, c) {
    return a["set" + b](a["get" + b]() + c), a;
  }
  function V(a, b, c) {
    return c == Fa ? V(new Date, a, b) : U(T(a), b.charAt(0).toUpperCase() + b.substr(1), c);
  }
  function W(a, b, c) {
    var d = +b,
        e = +c,
        f = e - d;
    if (0 > f)
      return -W(a, c, b);
    if (b = {
      milliseconds: 1,
      seconds: 1e3,
      minutes: 6e4,
      hours: 36e5
    }[a])
      return f / b;
    for (b = a.charAt(0).toUpperCase() + a.substr(1), a = Math.floor(f / {
      fullYear: 31536e6,
      month: 2628e6,
      date: 864e5
    }[a] - 2), d = U(new Date(d), b, a), f = a; 1.2 * a + 4 > f; f++)
      if (+U(d, b, 1) > e)
        return f;
  }
  function X(a) {
    return "\\u" + ("0000" + a.charCodeAt(0).toString(16)).slice(-4);
  }
  function Y(a) {
    return l(a, /[\x00-\x1f'"\u2028\u2029]/g, X);
  }
  function Z(a, b) {
    return a.split(b);
  }
  function $(a, b) {
    function c(a, c) {
      var d = [];
      return e.call(c || a, a, function(a, b) {
        fa(a) ? p(a, function(a, c) {
          b.call(a, a, c);
        }) : o(a, function(a, c) {
          b.call(c, a, c);
        });
      }, b || j, function() {
        N(d.push, d, arguments);
      }, wa), d.join("");
    }
    if (Ma[a])
      return Ma[a];
    var d = "with(_.isObject(obj)?obj:{}){" + v(Z(a, /{{|}}}?/g), function(a, b) {
      var c,
          d = n(a),
          e = l(d, /^{/),
          d = d == e ? "esc(" : "";
      return b % 2 ? (c = /^each\b(\s+([\w_]+(\s*,\s*[\w_]+)?)\s*:)?(.*)/.exec(e)) ? "each(" + (n(c[4]) ? c[4] : "this") + ", function(" + c[2] + "){" : (c = /^if\b(.*)/.exec(e)) ? "if(" + c[1] + "){" : (c = /^else\b\s*(if\b(.*))?/.exec(e)) ? "}else " + (c[1] ? "if(" + c[2] + ")" : "") + "{" : (c = /^\/(if)?/.exec(e)) ? c[1] ? "}\n" : "});\n" : (c = /^(var\s.*)/.exec(e)) ? c[1] + ";" : (c = /^#(.*)/.exec(e)) ? c[1] : (c = /(.*)::\s*(.*)/.exec(e)) ? "print(" + d + '_.formatValue("' + Y(c[2]) + '",' + (n(c[1]) ? c[1] : "this") + (d && ")") + "));\n" : "print(" + d + (n(e) ? e : "this") + (d && ")") + ");\n" : a ? 'print("' + Y(a) + '");\n' : void 0;
    }).join("") + "}",
        e = Function("obj", "each", "esc", "print", "_", d);
    return 99 < Na.push(c) && delete Ma[Na.shift()], Ma[a] = c;
  }
  function _(a) {
    return l(a, /[<>'"&]/g, function(a) {
      return "&#" + a.charCodeAt(0) + ";";
    });
  }
  function aa(a, b) {
    return $(a, _)(b);
  }
  function ba(a) {
    return function(b, c) {
      return new va(a(this, b, c));
    };
  }
  function ca(a) {
    return function(b, c, d) {
      return a(this, b, c, d);
    };
  }
  function da(a) {
    return function(b, c, d) {
      return new va(a(b, c, d));
    };
  }
  function ea(a) {
    return "function" == typeof a && !a.item;
  }
  function fa(a) {
    return a && a.length != Fa && !c(a) && !e(a) && !ea(a) && a !== ya;
  }
  function ga(a) {
    return parseFloat(l(a, /^[^\d-]+/));
  }
  function ha(a) {
    return a.Nia = a.Nia || ++Ba;
  }
  function ia(a, b) {
    var c,
        d = [],
        e = {};
    return sa(a, function(a) {
      sa(b(a), function(a) {
        e[c = ha(a)] || (d.push(a), e[c] = !0);
      });
    }), d;
  }
  function ja(a, b) {
    var c = {
      $position: "absolute",
      $visibility: "hidden",
      $display: "block",
      $height: Fa
    },
        d = a.get(c),
        c = a.set(c).get("clientHeight");
    return a.set(d), c * b + "px";
  }
  function ka(a) {
    Ca ? Ca.push(a) : setTimeout(a, 0);
  }
  function la(a, b, c) {
    return pa(a, b, c)[0];
  }
  function ma(a, b, c) {
    return a = oa(document.createElement(a)), fa(b) || b != Fa && !d(b) ? a.add(b) : a.set(b).add(c);
  }
  function na(a) {
    return r(sa, a, function(a) {
      return fa(a) ? na(a) : (e(a) && (a = a.cloneNode(!0), a.removeAttribute && a.removeAttribute("id")), a);
    });
  }
  function oa(a, b, c) {
    return ea(a) ? ka(a) : new va(pa(a, b, c));
  }
  function pa(a, b, d) {
    function f(a) {
      return fa(a) ? r(sa, a, f) : a;
    }
    function g(a) {
      return q(r(sa, a, f), function(a) {
        for (; a = a.parentNode; )
          if (a == b[0] || d)
            return a == b[0];
      });
    }
    return b ? 1 != (b = pa(b)).length ? ia(b, function(b) {
      return pa(a, b, d);
    }) : c(a) ? 1 != e(b[0]) ? [] : d ? g(b[0].querySelectorAll(a)) : b[0].querySelectorAll(a) : g(a) : c(a) ? document.querySelectorAll(a) : r(sa, a, f);
  }
  function qa(a, b) {
    function d(a, b) {
      var c = RegExp("(^|\\s+)" + a + "(?=$|\\s)", "i");
      return function(d) {
        return a ? c.test(d[b]) : !0;
      };
    }
    var g,
        h,
        i = {},
        j = i;
    return ea(a) ? a : f(a) ? function(b, c) {
      return c == a;
    } : !a || "*" == a || c(a) && (j = /^([\w-]*)\.?([\w-]*)$/.exec(a)) ? (g = d(j[1], "tagName"), h = d(j[2], "className"), function(a) {
      return 1 == e(a) && g(a) && h(a);
    }) : b ? function(c) {
      return oa(a, b).find(c) != Fa;
    } : (oa(a).each(function(a) {
      i[ha(a)] = !0;
    }), function(a) {
      return i[ha(a)];
    });
  }
  function ra(a) {
    var b = qa(a);
    return function(a) {
      return b(a) ? Fa : !0;
    };
  }
  function sa(a, b) {
    return fa(a) ? p(a, b) : a != Fa && b(a, 0), a;
  }
  function ta() {
    this.state = null, this.values = [], this.parent = null;
  }
  function ua() {
    var a,
        b,
        c = [],
        e = arguments,
        f = e.length,
        g = 0,
        h = 0,
        i = new ta;
    return i.errHandled = function() {
      h++, i.parent && i.parent.errHandled();
    }, a = i.fire = function(a, b) {
      return null == i.state && null != a && (i.state = !!a, i.values = fa(b) ? b : [b], setTimeout(function() {
        p(c, function(a) {
          a();
        });
      }, 0)), i;
    }, p(e, function j(b, c) {
      try {
        b.then ? b.then(function(b) {
          (d(b) || ea(b)) && ea(b.then) ? j(b, c) : (i.values[c] = H(arguments), ++g == f && a(!0, 2 > f ? i.values[c] : i.values));
        }, function() {
          i.values[c] = H(arguments), a(!1, 2 > f ? i.values[c] : [i.values[c][0], i.values, c]);
        }) : b(function() {
          a(!0, H(arguments));
        }, function() {
          a(!1, H(arguments));
        });
      } catch (e) {
        a(!1, [e, i.values, c]);
      }
    }), i.stop = function() {
      return p(e, function(a) {
        a.stop && a.stop();
      }), i.stop0 && N(i.stop0);
    }, b = i.then = function(a, b) {
      function e() {
        try {
          var c = i.state ? a : b;
          ea(c) ? function g(a) {
            try {
              var b,
                  c = 0;
              if ((d(a) || ea(a)) && ea(b = a.then)) {
                if (a === f)
                  throw new TypeError;
                b.call(a, function(a) {
                  c++ || g(a);
                }, function(a) {
                  c++ || f.fire(!1, [a]);
                }), f.stop0 = a.stop;
              } else
                f.fire(!0, [a]);
            } catch (e) {
              if (!c++ && (f.fire(!1, [e]), !h))
                throw e;
            }
          }(N(c, xa, i.values)) : f.fire(i.state, i.values);
        } catch (e) {
          if (f.fire(!1, [e]), !h)
            throw e;
        }
      }
      var f = ua();
      return ea(b) && i.errHandled(), f.stop0 = i.stop, f.parent = i, null != i.state ? setTimeout(e, 0) : c.push(e), f;
    }, i.always = function(a) {
      return b(a, a);
    }, i.error = function(a) {
      return b(0, a);
    }, i;
  }
  function va(a, b) {
    var c,
        d,
        e,
        f,
        g,
        h = 0;
    if (a)
      for (c = 0, d = a.length; d > c; c++)
        if (e = a[c], b && fa(e))
          for (f = 0, g = e.length; g > f; f++)
            this[h++] = e[f];
        else
          this[h++] = e;
    else
      this[h++] = b;
    this.length = h, this._ = !0;
  }
  function wa() {
    return new va(arguments, !0);
  }
  var xa,
      ya = window,
      za = {},
      Aa = {},
      Ba = 1,
      Ca = /^[ic]/.test(document.readyState) ? Fa : [],
      Da = {},
      Ea = 0,
      Fa = null,
      Ga = Z("January,February,March,April,May,June,July,August,September,October,November,December", /,/g),
      Ha = v(Ga, a),
      Ia = Z("Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday", /,/g),
      Ja = v(Ia, a),
      Ka = {
        y: ["FullYear", j],
        Y: ["FullYear", function(a) {
          return a % 100;
        }],
        M: ["Month", k],
        n: ["Month", Ha],
        N: ["Month", Ga],
        d: ["Date", j],
        m: ["Minutes", j],
        H: ["Hours", j],
        h: ["Hours", function(a) {
          return a % 12 || 12;
        }],
        k: ["Hours", k],
        K: ["Hours", function(a) {
          return a % 12;
        }],
        s: ["Seconds", j],
        S: ["Milliseconds", j],
        a: ["Hours", Z("am,am,am,am,am,am,am,am,am,am,am,am,pm,pm,pm,pm,pm,pm,pm,pm,pm,pm,pm,pm", /,/g)],
        w: ["Day", Ja],
        W: ["Day", Ia],
        z: ["TimezoneOffset", function(a, b, c) {
          return c ? c : (b = 0 > a ? -a : a, (a > 0 ? "-" : "+") + Q(2, Math.floor(b / 60)) + Q(2, b % 60));
        }]
      },
      La = {
        y: 0,
        Y: [0, -2e3],
        M: [1, 1],
        n: [1, Ha],
        N: [1, Ga],
        d: 2,
        m: 4,
        H: 3,
        h: 3,
        K: [3, 1],
        k: [3, 1],
        s: 5,
        S: 6,
        a: [3, Z("am,pm", /,/g)]
      },
      Ma = {},
      Na = [];
  return A({
    each: ca(p),
    filter: ba(q),
    collect: ba(s),
    map: ba(v),
    toObject: ca(z),
    equals: ca(M),
    sub: ba(G),
    reverse: ca(y),
    find: ca(E),
    findLast: ca(F),
    startsWith: ca(w),
    endsWith: ca(x),
    contains: ca(L),
    call: ba(O),
    array: ca(H),
    unite: ca(I),
    merge: ca(B),
    uniq: ba(J),
    intersection: ba(K),
    join: function(a) {
      return v(this, j).join(a);
    },
    reduce: function(a, b) {
      return p(this, function(c, d) {
        b = a.call(this, b, c, d);
      }), b;
    },
    sort: function(a) {
      return new va(v(this, j).sort(a));
    },
    remove: function() {
      sa(this, function(a) {
        a.parentNode.removeChild(a);
      });
    },
    text: function() {
      return r(sa, this, function(a) {
        return a.textContent;
      }).join("");
    },
    trav: function(a, b, c) {
      var d = f(b),
          e = qa(d ? Fa : b),
          g = d ? b : c;
      return new va(ia(this, function(b) {
        for (var c = []; (b = b[a]) && c.length != g; )
          e(b) && c.push(b);
        return c;
      }));
    },
    next: function(a, b) {
      return this.trav("nextSibling", a, b || 1);
    },
    up: function(a, b) {
      return this.trav("parentNode", a, b || 1);
    },
    select: function(a, b) {
      return oa(a, this, b);
    },
    is: function(a) {
      return !this.find(ra(a));
    },
    only: function(a) {
      return new va(q(this, qa(a)));
    },
    not: function(a) {
      return new va(q(this, ra(a)));
    },
    get: function(a, b) {
      var d,
          e,
          f,
          g,
          h = this,
          i = h[0];
      return i ? c(a) ? (d = /^(\W*)(.*)/.exec(l(a, /^%/, "@data-")), e = d[1], f = Aa[e] ? Aa[e](this, d[2]) : "$" == a ? h.get("className") : "$$" == a ? h.get("@style") : "$$slide" == a ? h.get("$height") : "$$fade" == a || "$$show" == a ? "hidden" == h.get("$visibility") || "none" == h.get("$display") ? 0 : "$$fade" == a ? isNaN(h.get("$opacity", !0)) ? 1 : h.get("$opacity", !0) : 1 : "$" == e ? ya.getComputedStyle(i, Fa).getPropertyValue(l(d[2], /[A-Z]/g, function(a) {
        return "-" + a.toLowerCase();
      })) : "@" == e ? i.getAttribute(d[2]) : i[d[2]], b ? ga(f) : f) : (g = {}, (fa(a) ? sa : o)(a, function(a) {
        g[a] = h.get(a, b);
      }), g) : void 0;
    },
    set: function(a, b) {
      var d,
          e,
          f = this;
      return b !== xa ? (d = /^(\W*)(.*)/.exec(l(l(a, /^\$float$/, "cssFloat"), /^%/, "@data-")), e = d[1], za[e] ? za[e](this, d[2], b) : "$$fade" == a ? this.set({
        $visibility: b ? "visible" : "hidden",
        $opacity: b
      }) : "$$slide" == a ? f.set({
        $visibility: b ? "visible" : "hidden",
        $overflow: "hidden",
        $height: /px/.test(b) ? b : function(a, c, d) {
          return ja(oa(d), b);
        }
      }) : "$$show" == a ? b ? f.set({
        $visibility: b ? "visible" : "hidden",
        $display: ""
      }).set({$display: function(a) {
          return "none" == a ? "block" : a;
        }}) : f.set({$display: "none"}) : "$$" == a ? f.set("@style", b) : sa(this, function(c, f) {
        var g = ea(b) ? b(oa(c).get(a), f, c) : b;
        "$" == e ? d[2] ? c.style[d[2]] = g : sa(g && g.split(/\s+/), function(a) {
          var b = l(a, /^[+-]/),
              d = c.className || "",
              e = l(d, RegExp("(^|\\s+)" + b + "(?=$|\\s)"));
          (/^\+/.test(a) || b == a && d == e) && (e += " " + b), c.className = n(e);
        }) : "$$scrollX" == a ? c.scroll(g, oa(c).get("$$scrollY")) : "$$scrollY" == a ? c.scroll(oa(c).get("$$scrollX"), g) : "@" == e ? g == Fa ? c.removeAttribute(d[2]) : c.setAttribute(d[2], g) : c[d[2]] = g;
      })) : c(a) || ea(a) ? f.set("$", a) : o(a, function(a, b) {
        f.set(a, b);
      }), f;
    },
    show: function() {
      return this.set("$$show", 1);
    },
    hide: function() {
      return this.set("$$show", 0);
    },
    add: function(a, b) {
      return this.each(function(c, d) {
        function f(a) {
          fa(a) ? sa(a, f) : ea(a) ? f(a(c, d)) : a != Fa && (a = e(a) ? a : document.createTextNode(a), g ? g.parentNode.insertBefore(a, g.nextSibling) : b ? b(a, c, c.parentNode) : c.appendChild(a), g = a);
        }
        var g;
        f(d && !ea(a) ? na(a) : a);
      });
    },
    fill: function(a) {
      return this.each(function(a) {
        oa(a.childNodes).remove();
      }).add(a);
    },
    addAfter: function(a) {
      return this.add(a, function(a, b, c) {
        c.insertBefore(a, b.nextSibling);
      });
    },
    addBefore: function(a) {
      return this.add(a, function(a, b, c) {
        c.insertBefore(a, b);
      });
    },
    addFront: function(a) {
      return this.add(a, function(a, b) {
        b.insertBefore(a, b.firstChild);
      });
    },
    replace: function(a) {
      return this.add(a, function(a, b, c) {
        c.replaceChild(a, b);
      });
    },
    clone: ba(na),
    animate: function(a, b, c) {
      var d,
          e = ua(),
          f = this,
          g = r(sa, this, function(b, d) {
            var e,
                f = oa(b),
                g = {};
            return o(e = f.get(a), function(c, e) {
              var h = a[c];
              g[c] = ea(h) ? h(e, d, b) : "$$slide" == c ? ja(f, h) : h;
            }), f.dial(e, g, c);
          }),
          h = b || 500;
      return e.stop0 = function() {
        return e.fire(!1), d();
      }, d = oa.loop(function(a) {
        O(g, [a / h]), a >= h && (d(), e.fire(!0, [f]));
      }), e;
    },
    dial: function(a, c, d) {
      function e(a, b) {
        return /^#/.test(a) ? parseInt(6 < a.length ? a.substr(2 * b + 1, 2) : (a = a.charAt(b + 1)) + a, 16) : ga(a.split(",")[b]);
      }
      var f = this,
          g = d || 0,
          h = ea(g) ? g : function(a, b, c) {
            return c * (b - a) * (g + (1 - g) * c * (3 - 2 * c)) + a;
          };
      return function(d) {
        o(a, function(a, g) {
          var i = c[a],
              j = 0;
          f.set(a, 0 >= d ? g : d >= 1 ? i : /^#|rgb\(/.test(i) ? "rgb(" + Math.round(h(e(g, j), e(i, j++), d)) + "," + Math.round(h(e(g, j), e(i, j++), d)) + "," + Math.round(h(e(g, j), e(i, j++), d)) + ")" : l(i, /-?[\d.]+/, b(h(ga(g), ga(i), d))));
        });
      };
    },
    toggle: function(a, b, c, d) {
      var e,
          f,
          g = this,
          h = !1;
      return b ? (g.set(a), function(i) {
        i !== h && (f = (h = !0 === i || !1 === i ? i : !h) ? b : a, c ? (e = g.animate(f, e ? e.stop() : c, d)).then(function() {
          e = Fa;
        }) : g.set(f));
      }) : g.toggle(l(a, /\b(?=\w)/g, "-"), l(a, /\b(?=\w)/g, "+"));
    },
    values: function(a) {
      var c = a || {};
      return this.each(function(a) {
        var d = a.name || a.id,
            e = b(a.value);
        if (/form/i.test(a.tagName))
          for (d = 0; d < a.elements.length; d++)
            oa(a.elements[d]).values(c);
        else
          !d || /ox|io/i.test(a.type) && !a.checked || (c[d] = c[d] == Fa ? e : r(sa, [c[d], e], j));
      }), c;
    },
    offset: function() {
      for (var a = this[0],
          b = {
            x: 0,
            y: 0
          }; a; )
        b.x += a.offsetLeft, b.y += a.offsetTop, a = a.offsetParent;
      return b;
    },
    on: function(a, d, e, f, g) {
      return ea(d) ? this.on(Fa, a, d, e, f) : c(f) ? this.on(a, d, e, Fa, f) : this.each(function(c, h) {
        sa(a ? pa(a, c) : c, function(a) {
          sa(b(d).split(/\s/), function(b) {
            function c(b, c, d) {
              var j,
                  l = !g;
              if (d = g ? d : a, g)
                for (j = qa(g, a); d && d != a && !(l = j(d)); )
                  d = d.parentNode;
              return !l || i != b || e.apply(oa(d), f || [c, h]) && "?" == k || "|" == k;
            }
            function d(a) {
              c(i, a, a.target) || (a.preventDefault(), a.stopPropagation());
            }
            var i = l(b, /[?|]/g),
                k = l(b, /[^?|]/g),
                m = ("blur" == i || "focus" == i) && !!g,
                n = Ba++;
            a.addEventListener(i, d, m), a.M || (a.M = {}), a.M[n] = c, e.M = r(sa, [e.M, function() {
              a.removeEventListener(i, d, m), delete a.M[n];
            }], j);
          });
        });
      });
    },
    onOver: function(a, b) {
      var c = this,
          d = [];
      return ea(b) ? this.on(a, "|mouseover |mouseout", function(a, e) {
        var f = a.relatedTarget || a.toElement,
            g = "mouseout" != a.type;
        d[e] === g || !g && f && (f == c[e] || oa(f).up(c[e]).length) || (d[e] = g, b.call(this, g, a));
      }) : this.onOver(Fa, a);
    },
    onFocus: function(a, b, c) {
      return ea(b) ? this.on(a, "|blur", b, [!1], c).on(a, "|focus", b, [!0], c) : this.onFocus(Fa, a, b);
    },
    onChange: function(a, b, c) {
      return ea(b) ? this.on(a, "|input |change |click", function(a, c) {
        var d = this[0],
            e = /ox|io/i.test(d.type) ? d.checked : d.value;
        d.NiaP != e && b.call(this, d.NiaP = e, c);
      }, c) : this.onChange(Fa, a, b);
    },
    onClick: function(a, b, c, d) {
      return ea(b) ? this.on(a, "click", b, c, d) : this.onClick(Fa, a, b, c);
    },
    trigger: function(a, b) {
      return this.each(function(c) {
        for (var d = !0,
            e = c; e && d; )
          o(e.M, function(e, f) {
            d = d && f(a, b, c);
          }), e = e.parentNode;
      });
    },
    per: function(a, b) {
      if (ea(a))
        for (var c = this.length,
            d = 0; c > d; d++)
          a.call(this, new va(Fa, this[d]), d);
      else
        oa(a, this).per(b);
      return this;
    },
    ht: function(a, b) {
      var c = 2 < arguments.length ? B(G(arguments, 1)) : b;
      return this.set("innerHTML", ea(a) ? a(c) : /{{/.test(a) ? aa(a, c) : /^#\S+$/.test(a) ? aa(la(a).text, c) : a);
    }
  }, va.prototype), A({
    request: function(a, c, d, e) {
      e = e || {};
      var f,
          g = 0,
          h = ua(),
          i = d && d.constructor == e.constructor;
      try {
        h.xhr = f = new XMLHttpRequest, h.stop0 = function() {
          f.abort();
        }, i && (d = r(o, d, function(a, b) {
          return r(sa, b, function(b) {
            return encodeURIComponent(a) + (b != Fa ? "=" + encodeURIComponent(b) : "");
          });
        }).join("&")), d == Fa || /post/i.test(a) || (c += "?" + d, d = Fa), f.open(a, c, !0, e.user, e.pass), i && /post/i.test(a) && f.setRequestHeader("Content-Type", "application/x-www-form-urlencoded"), o(e.headers, function(a, b) {
          f.setRequestHeader(a, b);
        }), o(e.xhr, function(a, b) {
          f[a] = b;
        }), f.onreadystatechange = function() {
          4 != f.readyState || g++ || (200 <= f.status && 300 > f.status ? h.fire(!0, [f.responseText, f]) : h.fire(!1, [f.status, f.responseText, f]));
        }, f.send(d);
      } catch (j) {
        g || h.fire(!1, [0, Fa, b(j)]);
      }
      return h;
    },
    toJSON: JSON.stringify,
    parseJSON: JSON.parse,
    ready: ka,
    loop: function(a) {
      function b(a) {
        o(Da, function(b, c) {
          c(a);
        }), Ea && g(b);
      }
      function c() {
        return Da[f] && (delete Da[f], Ea--), e;
      }
      var d,
          e = 0,
          f = Ba++,
          g = ya.requestAnimationFrame || function(a) {
            setTimeout(function() {
              a(+new Date);
            }, 33);
          };
      return Da[f] = function(b) {
        d = d || b, a(e = b - d, c);
      }, Ea++ || g(b), c;
    },
    off: function(a) {
      O(a.M), a.M = Fa;
    },
    setCookie: function(a, b, c, e) {
      document.cookie = a + "=" + (e ? b : escape(b)) + (c ? "; expires=" + (d(c) ? c : new Date(+new Date + 864e5 * c)).toUTCString() : "");
    },
    getCookie: function(a, b) {
      var c,
          d = (c = RegExp("(^|;)\\s*" + a + "=([^;]*)").exec(document.cookie)) && c[2];
      return b ? d : d && unescape(d);
    },
    wait: function(a, b) {
      var c = ua(),
          d = setTimeout(function() {
            c.fire(!0, b);
          }, a);
      return c.stop0 = function() {
        c.fire(!1), clearTimeout(d);
      }, c;
    }
  }, oa), A({
    filter: da(q),
    collect: da(s),
    map: da(v),
    sub: da(G),
    reverse: y,
    each: p,
    toObject: z,
    find: E,
    findLast: F,
    contains: L,
    startsWith: w,
    endsWith: x,
    equals: M,
    call: da(O),
    array: H,
    unite: I,
    merge: B,
    uniq: da(J),
    intersection: da(K),
    keys: da(u),
    values: da(function(a, b) {
      var c = [];
      return b ? p(b, function(b) {
        c.push(a[b]);
      }) : o(a, function(a, b) {
        c.push(b);
      }), c;
    }),
    copyObj: A,
    extend: function(a) {
      return B(G(arguments, 1), a);
    },
    range: function(a, b) {
      for (var c = [],
          d = b == Fa ? a : b,
          e = b != Fa ? a : 0; d > e; e++)
        c.push(e);
      return new va(c);
    },
    bind: P,
    partial: function(a, b, c) {
      return P(a, this, b, c);
    },
    eachObj: o,
    mapObj: function(a, b, c) {
      var d = {};
      return o(a, function(e, f) {
        d[e] = b.call(c || a, e, f);
      }), d;
    },
    filterObj: function(a, b, c) {
      var d = {};
      return o(a, function(e, f) {
        b.call(c || a, e, f) && (d[e] = f);
      }), d;
    },
    isList: fa,
    isFunction: ea,
    isObject: d,
    isNumber: f,
    isBool: h,
    isDate: g,
    isValue: i,
    isString: c,
    toString: b,
    dateClone: T,
    dateAdd: V,
    dateDiff: W,
    dateMidnight: function(a) {
      return a = a || new Date, new Date(a.getFullYear(), a.getMonth(), a.getDate());
    },
    pad: Q,
    formatValue: function(a, d) {
      var e,
          h,
          i = l(a, /^\?/);
      return g(d) ? ((h = /^\[(([+-])(\d\d)(\d\d))\]\s*(.*)/.exec(i)) && (e = h[1], d = V(d, "minutes", S(h, 2, d)), i = h[5]), l(i, /(\w)(\1*)(?:\[([^\]]+)\])?/g, function(a, b, f, g) {
        return (b = Ka[b]) && (a = d["get" + b[0]](), g = g && g.split(","), a = fa(b[1]) ? (g || b[1])[a] : b[1](a, g, e), a == Fa || c(a) || (a = Q(f.length + 1, a))), a;
      })) : E(i.split(/\s*\|\s*/), function(a) {
        var c,
            e;
        if (c = /^([<>]?)(=?)([^:]*?)\s*:\s*(.*)$/.exec(a)) {
          if (a = d, e = +c[3], (isNaN(e) || !f(a)) && (a = a == Fa ? "null" : b(a), e = c[3]), c[1]) {
            if (!c[2] && a == e || "<" == c[1] && a > e || ">" == c[1] && e > a)
              return Fa;
          } else if (a != e)
            return Fa;
          c = c[4];
        } else
          c = a;
        return f(d) ? c.replace(/[0#](.*[0#])?/, function(a) {
          var b,
              c = /^([^.]+)(\.)([^.]+)$/.exec(a) || /^([^,]+)(,)([^,]+)$/.exec(a),
              e = 0 > d ? "-" : "",
              f = /(\d+)(\.(\d+))?/.exec((e ? -d : d).toFixed(c ? c[3].length : 0));
          return a = c ? c[1] : a, b = c ? R(c[3], l(f[3], /0+$/), !0) : "", (e ? "-" : "") + ("#" == a ? f[1] : R(a, f[1])) + (b.length ? c[2] : "") + b;
        }) : c;
      });
    },
    parseDate: function(a, b) {
      var c,
          d,
          e,
          f,
          g,
          h,
          i,
          j,
          k,
          o = {},
          p = 1,
          q = l(a, /^\?/);
      if (q != a && !n(b))
        return Fa;
      if ((e = /^\[([+-])(\d\d)(\d\d)\]\s*(.*)/.exec(q)) && (c = e, q = e[4]), !(e = RegExp(q.replace(/(.)(\1*)(?:\[([^\]]*)\])?/g, function(a, b, c, e) {
        return /[dmhkyhs]/i.test(b) ? (o[p++] = b, a = c.length + 1, "(\\d" + (2 > a ? "+" : "{1," + a + "}") + ")") : "z" == b ? (d = p, p += 3, "([+-])(\\d\\d)(\\d\\d)") : /[Nna]/.test(b) ? (o[p++] = [b, e && e.split(",")], "([a-zA-Z\\u0080-\\u1fff]+)") : /w/i.test(b) ? "[a-zA-Z\\u0080-\\u1fff]+" : /\s/.test(b) ? "\\s+" : m(a);
      })).exec(b)))
        return xa;
      for (q = [0, 0, 0, 0, 0, 0, 0], f = 1; p > f; f++)
        if (g = e[f], h = o[f], fa(h)) {
          if (i = h[0], j = La[i], k = j[0], h = E(h[1] || j[1], function(a, b) {
            return w(g.toLowerCase(), a.toLowerCase()) ? b : void 0;
          }), h == Fa)
            return xa;
          q[k] = "a" == i ? q[k] + 12 * h : h;
        } else
          h && (i = parseFloat(g), j = La[h], fa(j) ? q[j[0]] += i - j[1] : q[j] += i);
      return q = new Date(q[0], q[1], q[2], q[3], q[4], q[5], q[6]), V(q, "minutes", -S(c, 1, q) - S(e, d, q));
    },
    parseNumber: function(a, b) {
      var c = l(a, /^\?/);
      return c == a || n(b) ? (c = /(^|[^0#.,])(,|[0#.]*,[0#]+|[0#]+\.[0#]+\.[0#.,]*)($|[^0#.,])/.test(c) ? "," : ".", c = parseFloat(l(l(l(b, "," == c ? /\./g : /,/g), c, "."), /^[^\d-]*(-?\d)/, "$1")), isNaN(c) ? xa : c) : Fa;
    },
    trim: n,
    isEmpty: function(a, b) {
      return a == Fa || !a.length || b && /^\s*$/.test(a);
    },
    escapeRegExp: m,
    escapeHtml: _,
    format: function(a, b, c) {
      return $(a, c)(b);
    },
    template: $,
    formatHtml: aa,
    promise: ua
  }, wa), document.addEventListener("DOMContentLoaded", function() {
    O(Ca), Ca = Fa;
  }, !1), {
    HTML: function() {
      var a = ma("div");
      return wa(N(a.ht, a, arguments)[0].childNodes);
    },
    _: wa,
    $: oa,
    $$: la,
    EE: ma,
    M: va,
    getter: Aa,
    setter: za
  };
});

_removeDefine();
})();
(function() {
var _removeDefine = $__System.get("@@amd-helpers").createDefine();
define("4f", ["4e"], function(main) {
  return main;
});

_removeDefine();
})();
$__System.registerDynamic("50", ["d", "2a", "2b", "28"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var getDesc = req('d').getDesc,
      isObject = req('2a'),
      anObject = req('2b');
  var check = function(O, proto) {
    anObject(O);
    if (!isObject(proto) && proto !== null)
      throw TypeError(proto + ": can't set as prototype!");
  };
  module.exports = {
    set: Object.setPrototypeOf || ('__proto__' in {} ? function(test, buggy, set) {
      try {
        set = req('28')(Function.call, getDesc(Object.prototype, '__proto__').set, 2);
        set(test, []);
        buggy = !(test instanceof Array);
      } catch (e) {
        buggy = true;
      }
      return function setPrototypeOf(O, proto) {
        check(O, proto);
        if (buggy)
          O.__proto__ = proto;
        else
          set(O, proto);
        return O;
      };
    }({}, false) : undefined),
    check: check
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("51", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = Object.is || function is(x, y) {
    return x === y ? x !== 0 || 1 / x === 1 / y : x != x && y != y;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("52", ["2b", "27", "21"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var anObject = req('2b'),
      aFunction = req('27'),
      SPECIES = req('21')('species');
  module.exports = function(O, D) {
    var C = anObject(O).constructor,
        S;
    return C === undefined || (S = anObject(C)[SPECIES]) == undefined ? D : aFunction(S);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("53", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = function(fn, args, that) {
    var un = that === undefined;
    switch (args.length) {
      case 0:
        return un ? fn() : fn.call(that);
      case 1:
        return un ? fn(args[0]) : fn.call(that, args[0]);
      case 2:
        return un ? fn(args[0], args[1]) : fn.call(that, args[0], args[1]);
      case 3:
        return un ? fn(args[0], args[1], args[2]) : fn.call(that, args[0], args[1], args[2]);
      case 4:
        return un ? fn(args[0], args[1], args[2], args[3]) : fn.call(that, args[0], args[1], args[2], args[3]);
    }
    return fn.apply(that, args);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("54", ["16"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = req('16').document && document.documentElement;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("55", ["2a", "16"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var isObject = req('2a'),
      document = req('16').document,
      is = isObject(document) && isObject(document.createElement);
  module.exports = function(it) {
    return is ? document.createElement(it) : {};
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("56", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var process = module.exports = {};
  var queue = [];
  var draining = false;
  var currentQueue;
  var queueIndex = -1;
  function cleanUpNextTick() {
    draining = false;
    if (currentQueue.length) {
      queue = currentQueue.concat(queue);
    } else {
      queueIndex = -1;
    }
    if (queue.length) {
      drainQueue();
    }
  }
  function drainQueue() {
    if (draining) {
      return;
    }
    var timeout = setTimeout(cleanUpNextTick);
    draining = true;
    var len = queue.length;
    while (len) {
      currentQueue = queue;
      queue = [];
      while (++queueIndex < len) {
        if (currentQueue) {
          currentQueue[queueIndex].run();
        }
      }
      queueIndex = -1;
      len = queue.length;
    }
    currentQueue = null;
    draining = false;
    clearTimeout(timeout);
  }
  process.nextTick = function(fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
      for (var i = 1; i < arguments.length; i++) {
        args[i - 1] = arguments[i];
      }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
      setTimeout(drainQueue, 0);
    }
  };
  function Item(fun, array) {
    this.fun = fun;
    this.array = array;
  }
  Item.prototype.run = function() {
    this.fun.apply(null, this.array);
  };
  process.title = 'browser';
  process.browser = true;
  process.env = {};
  process.argv = [];
  process.version = '';
  process.versions = {};
  function noop() {}
  process.on = noop;
  process.addListener = noop;
  process.once = noop;
  process.off = noop;
  process.removeListener = noop;
  process.removeAllListeners = noop;
  process.emit = noop;
  process.binding = function(name) {
    throw new Error('process.binding is not supported');
  };
  process.cwd = function() {
    return '/';
  };
  process.chdir = function(dir) {
    throw new Error('process.chdir is not supported');
  };
  process.umask = function() {
    return 0;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("57", ["56"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = req('56');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("58", ["57"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__System._nodeRequire ? process : req('57');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("59", ["58"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = req('58');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("5a", ["28", "53", "54", "55", "16", "2f", "59"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    'use strict';
    var ctx = req('28'),
        invoke = req('53'),
        html = req('54'),
        cel = req('55'),
        global = req('16'),
        process = global.process,
        setTask = global.setImmediate,
        clearTask = global.clearImmediate,
        MessageChannel = global.MessageChannel,
        counter = 0,
        queue = {},
        ONREADYSTATECHANGE = 'onreadystatechange',
        defer,
        channel,
        port;
    var run = function() {
      var id = +this;
      if (queue.hasOwnProperty(id)) {
        var fn = queue[id];
        delete queue[id];
        fn();
      }
    };
    var listner = function(event) {
      run.call(event.data);
    };
    if (!setTask || !clearTask) {
      setTask = function setImmediate(fn) {
        var args = [],
            i = 1;
        while (arguments.length > i)
          args.push(arguments[i++]);
        queue[++counter] = function() {
          invoke(typeof fn == 'function' ? fn : Function(fn), args);
        };
        defer(counter);
        return counter;
      };
      clearTask = function clearImmediate(id) {
        delete queue[id];
      };
      if (req('2f')(process) == 'process') {
        defer = function(id) {
          process.nextTick(ctx(run, id, 1));
        };
      } else if (MessageChannel) {
        channel = new MessageChannel;
        port = channel.port2;
        channel.port1.onmessage = listner;
        defer = ctx(port.postMessage, port, 1);
      } else if (global.addEventListener && typeof postMessage == 'function' && !global.importScripts) {
        defer = function(id) {
          global.postMessage(id + '', '*');
        };
        global.addEventListener('message', listner, false);
      } else if (ONREADYSTATECHANGE in cel('script')) {
        defer = function(id) {
          html.appendChild(cel('script'))[ONREADYSTATECHANGE] = function() {
            html.removeChild(this);
            run.call(id);
          };
        };
      } else {
        defer = function(id) {
          setTimeout(ctx(run, id, 1), 0);
        };
      }
    }
    module.exports = {
      set: setTask,
      clear: clearTask
    };
  })(req('59'));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("5b", ["16", "5a", "2f", "59"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    var global = req('16'),
        macrotask = req('5a').set,
        Observer = global.MutationObserver || global.WebKitMutationObserver,
        process = global.process,
        isNode = req('2f')(process) == 'process',
        head,
        last,
        notify;
    var flush = function() {
      var parent,
          domain;
      if (isNode && (parent = process.domain)) {
        process.domain = null;
        parent.exit();
      }
      while (head) {
        domain = head.domain;
        if (domain)
          domain.enter();
        head.fn.call();
        if (domain)
          domain.exit();
        head = head.next;
      }
      last = undefined;
      if (parent)
        parent.enter();
    };
    if (isNode) {
      notify = function() {
        process.nextTick(flush);
      };
    } else if (Observer) {
      var toggle = 1,
          node = document.createTextNode('');
      new Observer(flush).observe(node, {characterData: true});
      notify = function() {
        node.data = toggle = -toggle;
      };
    } else {
      notify = function() {
        macrotask.call(global, flush);
      };
    }
    module.exports = function asap(fn) {
      var task = {
        fn: fn,
        next: undefined,
        domain: isNode && process.domain
      };
      if (last)
        last.next = task;
      if (!head) {
        head = task;
        notify();
      }
      last = task;
    };
  })(req('59'));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("5c", ["d", "15", "16", "28", "30", "18", "2a", "2b", "27", "42", "43", "50", "51", "41", "21", "52", "20", "5b", "1b", "44", "23", "17", "32", "59"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    'use strict';
    var $ = req('d'),
        LIBRARY = req('15'),
        global = req('16'),
        ctx = req('28'),
        classof = req('30'),
        $def = req('18'),
        isObject = req('2a'),
        anObject = req('2b'),
        aFunction = req('27'),
        strictNew = req('42'),
        forOf = req('43'),
        setProto = req('50').set,
        same = req('51'),
        species = req('41'),
        SPECIES = req('21')('species'),
        speciesConstructor = req('52'),
        RECORD = req('20')('record'),
        asap = req('5b'),
        PROMISE = 'Promise',
        process = global.process,
        isNode = classof(process) == 'process',
        P = global[PROMISE],
        Wrapper;
    var testResolve = function(sub) {
      var test = new P(function() {});
      if (sub)
        test.constructor = Object;
      return P.resolve(test) === test;
    };
    var useNative = function() {
      var works = false;
      function P2(x) {
        var self = new P(x);
        setProto(self, P2.prototype);
        return self;
      }
      try {
        works = P && P.resolve && testResolve();
        setProto(P2, P);
        P2.prototype = $.create(P.prototype, {constructor: {value: P2}});
        if (!(P2.resolve(5).then(function() {}) instanceof P2)) {
          works = false;
        }
        if (works && req('1b')) {
          var thenableThenGotten = false;
          P.resolve($.setDesc({}, 'then', {get: function() {
              thenableThenGotten = true;
            }}));
          works = thenableThenGotten;
        }
      } catch (e) {
        works = false;
      }
      return works;
    }();
    var isPromise = function(it) {
      return isObject(it) && (useNative ? classof(it) == 'Promise' : RECORD in it);
    };
    var sameConstructor = function(a, b) {
      if (LIBRARY && a === P && b === Wrapper)
        return true;
      return same(a, b);
    };
    var getConstructor = function(C) {
      var S = anObject(C)[SPECIES];
      return S != undefined ? S : C;
    };
    var isThenable = function(it) {
      var then;
      return isObject(it) && typeof(then = it.then) == 'function' ? then : false;
    };
    var notify = function(record, isReject) {
      if (record.n)
        return;
      record.n = true;
      var chain = record.c;
      asap(function() {
        var value = record.v,
            ok = record.s == 1,
            i = 0;
        var run = function(react) {
          var cb = ok ? react.ok : react.fail,
              ret,
              then;
          try {
            if (cb) {
              if (!ok)
                record.h = true;
              ret = cb === true ? value : cb(value);
              if (ret === react.P) {
                react.rej(TypeError('Promise-chain cycle'));
              } else if (then = isThenable(ret)) {
                then.call(ret, react.res, react.rej);
              } else
                react.res(ret);
            } else
              react.rej(value);
          } catch (err) {
            react.rej(err);
          }
        };
        while (chain.length > i)
          run(chain[i++]);
        chain.length = 0;
        record.n = false;
        if (isReject)
          setTimeout(function() {
            var promise = record.p,
                handler,
                console;
            if (isUnhandled(promise)) {
              if (isNode) {
                process.emit('unhandledRejection', value, promise);
              } else if (handler = global.onunhandledrejection) {
                handler({
                  promise: promise,
                  reason: value
                });
              } else if ((console = global.console) && console.error) {
                console.error('Unhandled promise rejection', value);
              }
            }
            record.a = undefined;
          }, 1);
      });
    };
    var isUnhandled = function(promise) {
      var record = promise[RECORD],
          chain = record.a || record.c,
          i = 0,
          react;
      if (record.h)
        return false;
      while (chain.length > i) {
        react = chain[i++];
        if (react.fail || !isUnhandled(react.P))
          return false;
      }
      return true;
    };
    var $reject = function(value) {
      var record = this;
      if (record.d)
        return;
      record.d = true;
      record = record.r || record;
      record.v = value;
      record.s = 2;
      record.a = record.c.slice();
      notify(record, true);
    };
    var $resolve = function(value) {
      var record = this,
          then;
      if (record.d)
        return;
      record.d = true;
      record = record.r || record;
      try {
        if (then = isThenable(value)) {
          asap(function() {
            var wrapper = {
              r: record,
              d: false
            };
            try {
              then.call(value, ctx($resolve, wrapper, 1), ctx($reject, wrapper, 1));
            } catch (e) {
              $reject.call(wrapper, e);
            }
          });
        } else {
          record.v = value;
          record.s = 1;
          notify(record, false);
        }
      } catch (e) {
        $reject.call({
          r: record,
          d: false
        }, e);
      }
    };
    if (!useNative) {
      P = function Promise(executor) {
        aFunction(executor);
        var record = {
          p: strictNew(this, P, PROMISE),
          c: [],
          a: undefined,
          s: 0,
          d: false,
          v: undefined,
          h: false,
          n: false
        };
        this[RECORD] = record;
        try {
          executor(ctx($resolve, record, 1), ctx($reject, record, 1));
        } catch (err) {
          $reject.call(record, err);
        }
      };
      req('44')(P.prototype, {
        then: function then(onFulfilled, onRejected) {
          var react = {
            ok: typeof onFulfilled == 'function' ? onFulfilled : true,
            fail: typeof onRejected == 'function' ? onRejected : false
          };
          var promise = react.P = new (speciesConstructor(this, P))(function(res, rej) {
            react.res = res;
            react.rej = rej;
          });
          aFunction(react.res);
          aFunction(react.rej);
          var record = this[RECORD];
          record.c.push(react);
          if (record.a)
            record.a.push(react);
          if (record.s)
            notify(record, false);
          return promise;
        },
        'catch': function(onRejected) {
          return this.then(undefined, onRejected);
        }
      });
    }
    $def($def.G + $def.W + $def.F * !useNative, {Promise: P});
    req('23')(P, PROMISE);
    species(P);
    species(Wrapper = req('17')[PROMISE]);
    $def($def.S + $def.F * !useNative, PROMISE, {reject: function reject(r) {
        return new this(function(res, rej) {
          rej(r);
        });
      }});
    $def($def.S + $def.F * (!useNative || testResolve(true)), PROMISE, {resolve: function resolve(x) {
        return isPromise(x) && sameConstructor(x.constructor, this) ? x : new this(function(res) {
          res(x);
        });
      }});
    $def($def.S + $def.F * !(useNative && req('32')(function(iter) {
      P.all(iter)['catch'](function() {});
    })), PROMISE, {
      all: function all(iterable) {
        var C = getConstructor(this),
            values = [];
        return new C(function(res, rej) {
          forOf(iterable, false, values.push, values);
          var remaining = values.length,
              results = Array(remaining);
          if (remaining)
            $.each.call(values, function(promise, index) {
              C.resolve(promise).then(function(value) {
                results[index] = value;
                --remaining || res(results);
              }, rej);
            });
          else
            res(results);
        });
      },
      race: function race(iterable) {
        var C = getConstructor(this);
        return new C(function(res, rej) {
          forOf(iterable, false, function(promise) {
            C.resolve(promise).then(res, rej);
          });
        });
      }
    });
  })(req('59'));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("5d", ["40", "26", "3c", "5c", "17"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  req('40');
  req('26');
  req('3c');
  req('5c');
  module.exports = req('17').Promise;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("5e", ["5d"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": req('5d'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.register('5f', ['5e', '3f'], function (_export) {
  var _Promise, _getIterator;

  function readLayers(wmsEndpoint) {
    return readCapabilities(wmsEndpoint).then(getLayers);
  }

  function readCapabilities(wmsEndpoint) {
    // not using minified.js here since it doesn't support overrideMimeType()
    // see https://github.com/timjansen/minified.js/issues/65

    return new _Promise(function (resolve, reject) {
      var req = new XMLHttpRequest();
      req.open('GET', wmsEndpoint + '?service=wms&version=1.1.1&request=GetCapabilities');
      req.overrideMimeType('text/xml');

      req.addEventListener('load', function () {
        var xml = req.responseXML;
        resolve(xml);
      });

      req.addEventListener('error', function () {
        reject(new Error('Network error loading resource at ' + wmsEndpoint));
      });

      req.send();
    });
  }

  function getLayers(xml) {
    // not using minified.js here since it has problems with external xml documents
    // see https://github.com/timjansen/minified.js/issues/66
    var layers = [];
    var layerNodes = xml.getElementsByTagName('Layer');
    var _iteratorNormalCompletion = true;
    var _didIteratorError = false;
    var _iteratorError = undefined;

    try {
      for (var _iterator = _getIterator(layerNodes), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
        var layerNode = _step.value;

        if (layerNode.getAttribute('queryable') !== '1') continue;
        var children = [].slice.call(layerNode.children);
        var nameEl = children.find(function (el) {
          return el.tagName === 'Name';
        });
        var titleEl = children.find(function (el) {
          return el.tagName === 'Title';
        });
        if (nameEl) {
          var _name = nameEl.textContent;
          layers.push({ name: _name, title: titleEl.textContent });
        }
      }
    } catch (err) {
      _didIteratorError = true;
      _iteratorError = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion && _iterator['return']) {
          _iterator['return']();
        }
      } finally {
        if (_didIteratorError) {
          throw _iteratorError;
        }
      }
    }

    return layers;
  }

  return {
    setters: [function (_e) {
      _Promise = _e['default'];
    }, function (_f) {
      _getIterator = _f['default'];
    }],
    execute: function () {
      'use strict';

      _export('readLayers', readLayers);

      _export('readCapabilities', readCapabilities);

      _export('getLayers', getLayers);
    }
  };
});

$__System.register('60', ['2', '4', '10', '11', '36', '3f', '4b', '4c', '4d', '4f', '5f'], function (_export) {
  var L, _createClass, _classCallCheck, _toConsumableArray, _getIterator, _Set, $, HTML, wms, templatesHtml, sidebarHtml, Sidebar;

  function fromTemplate(id) {
    return document.importNode($('#' + id)[0].content, true).children[0];
  }

  function sortByKey(array, key) {
    return array.sort(function (a, b) {
      var x = a[key];
      var y = b[key];
      return x < y ? -1 : x > y ? 1 : 0;
    });
  }
  return {
    setters: [function (_5) {}, function (_4) {
      L = _4['default'];
    }, function (_) {
      _createClass = _['default'];
    }, function (_2) {
      _classCallCheck = _2['default'];
    }, function (_3) {
      _toConsumableArray = _3['default'];
    }, function (_f) {
      _getIterator = _f['default'];
    }, function (_b) {
      _Set = _b['default'];
    }, function (_c) {}, function (_d) {}, function (_f2) {
      $ = _f2.$;
      HTML = _f2.HTML;
    }, function (_f3) {
      wms = _f3;
    }],
    execute: function () {
      'use strict';

      templatesHtml = '\n<template id="template-dataset-list-item">\n  <li class="list-group-item">\n    <h4 class="list-group-item-heading dataset-title"></h4>\n    <p class="dataset-publisher"></p>\n    <p class="dataset-distribution-labels"></p>\n    <p class="dataset-description"></p>\n    <p class="dataset-temporal"><i class="glyphicon glyphicon-time"></i> <span class="dataset-temporal-text"></span></p>\n    <p class="dataset-spatial-geometry"><i class="glyphicon glyphicon-globe"></i> <span class="dataset-spatial-geometry-text"></span></p>\n    <div class="dataset-spatial-minimap"></div>\n  </li>\n</template\n';

      $('body').add(HTML(templatesHtml));

      sidebarHtml = function sidebarHtml(id) {
        return '\n<div id="' + id + '" class="sidebar collapsed">\n  <!-- Nav tabs -->\n  <div class="sidebar-tabs">\n      <ul role="tablist">\n          <li><a href="#datasets" role="tab"><i class="glyphicon glyphicon-align-justify"></i></a></li>\n      </ul>\n  </div>\n  \n  <!-- Tab panes -->\n  <div class="sidebar-content">\n      <div class="sidebar-pane" id="datasets">\n          <h1 class="sidebar-header">Datasets<div class="sidebar-close"><i class="glyphicon glyphicon-menu-left"></i></div></h1>\n  \n          <ul class="list-group dataset-list"></ul>\n      </div>\n  </div>\n</div>\n';
      };

      Sidebar = (function () {
        function Sidebar(map) {
          var _ref = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];

          var _ref$id = _ref.id;
          var id = _ref$id === undefined ? 'sidebar' : _ref$id;
          var _ref$layerControl = _ref.layerControl;
          var layerControl = _ref$layerControl === undefined ? null : _ref$layerControl;

          _classCallCheck(this, Sidebar);

          this.map = map;
          this.id = id;
          this.layerControl = layerControl;
          // has to come before the map div, otherwise it overlays zoom controls
          $('body').addFront(HTML(sidebarHtml(id)));

          $('#' + map.getContainer().id).set('+sidebar-map');
          this.control = L.control.sidebar(id).addTo(map);
        }

        _createClass(Sidebar, [{
          key: 'addDatasets',
          value: function addDatasets(datasets) {
            var sortKey = arguments.length <= 1 || arguments[1] === undefined ? 'title' : arguments[1];

            datasets = sortByKey(datasets, sortKey);
            var _iteratorNormalCompletion = true;
            var _didIteratorError = false;
            var _iteratorError = undefined;

            try {
              for (var _iterator = _getIterator(datasets), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
                var dataset = _step.value;

                this.addDataset(dataset);
              }
            } catch (err) {
              _didIteratorError = true;
              _iteratorError = err;
            } finally {
              try {
                if (!_iteratorNormalCompletion && _iterator['return']) {
                  _iterator['return']();
                }
              } finally {
                if (_didIteratorError) {
                  throw _iteratorError;
                }
              }
            }
          }
        }, {
          key: 'addDataset',
          value: function addDataset(dataset) {
            var _this = this;

            var el = fromTemplate('template-dataset-list-item');
            $('.dataset-list', '#' + this.id).add(el);

            // TODO switch to .landingPage once https://github.com/ckan/ckanext-dcat/issues/50 is fixed
            //let landingPage = dataset.landingPage
            var landingPage = dataset['dcat:landingPage'];
            if (landingPage) {
              $('.dataset-title', el).fill(HTML('<a href="' + landingPage + '" target="_new" class="external dataset-title">' + dataset.title + '</a>'));
            } else {
              $('.dataset-title', el).fill(dataset.title);
            }

            $('.dataset-description', el).fill(dataset.description);

            if (dataset.publisher) {
              // TODO switch to .homepage once https://github.com/ckan/ckanext-dcat/issues/50 is fixed
              //let homepage = dataset.publisher.homepage
              var homepage = dataset.publisher['foaf:homepage'];
              if (homepage) {
                $('.dataset-publisher', el).fill(HTML('<a class="external" href="' + homepage + '"><em>' + dataset.publisher.name + '</em></a>'));
              } else {
                $('.dataset-publisher', el).fill(HTML('<em>' + dataset.publisher.name + '</em>'));
              }
            } else {
              $('.dataset-publisher', el).hide();
            }

            if (dataset.temporal) {
              var temporal = dataset.temporal.startDate.substr(0, 10) + ' to ' + dataset.temporal.endDate.substr(0, 10);
              $('.dataset-temporal-text', el).fill(temporal);
            } else {
              $('.dataset-temporal', el).hide();
            }

            var isGlobal = undefined;
            var geom = dataset.spatial ? JSON.parse(dataset.spatial.geometry) : null;
            // check if global bounding box and don't display map in that case
            if (geom) {
              var geomLayer = L.geoJson(geom);
              isGlobal = geomLayer.getBounds().equals([[-90, -180], [90, 180]]);
            }

            if (dataset.spatial && !isGlobal) {
              (function () {
                $('.dataset-spatial-geometry', el).hide();

                var map = L.map($('.dataset-spatial-minimap', el)[0], {
                  touchZoom: false,
                  scrollWheelZoom: false,
                  doubleClickZoom: false,
                  boxZoom: false,
                  zoomControl: false,
                  attributionControl: false
                }).on('load', function () {
                  L.tileLayer('http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
                });

                setTimeout(function () {
                  var geomLayer = L.geoJson(geom, {
                    style: function style() {
                      return { color: "#ff7800", weight: 1, clickable: false };
                    }
                  });
                  map.fitBounds(geomLayer.getBounds(), { reset: true });
                  geomLayer.addTo(map);
                }, 1000);
              })();
            } else {
              $('.dataset-spatial-minimap', el).hide();
              if (isGlobal) {
                $('.dataset-spatial-geometry-text', el).fill('global');
              } else {
                $('.dataset-spatial-geometry', el).hide();
              }
            }

            var supportedFormats = new _Set(['WMS', 'GeoJSON']);
            if (dataset.distributions) {
              var types = new _Set(dataset.distributions.map(function (dist) {
                return dist.format ? dist.format : dist.mediaType;
              }));
              types = [].concat(_toConsumableArray(types));
              types.sort();
              var _iteratorNormalCompletion2 = true;
              var _didIteratorError2 = false;
              var _iteratorError2 = undefined;

              try {
                var _loop = function () {
                  var type = _step2.value;

                  if (!type) return 'continue';
                  var color = supportedFormats.has(type) ? 'success' : 'default';
                  var html = undefined;
                  if (supportedFormats.has(type)) {
                    html = HTML('<a href="#"><span class="label label-success">' + type + '</span></a> ');

                    // hacky, see https://github.com/timjansen/minified.js/issues/68
                    $(html[0]).on('click', function () {
                      if (type === 'WMS') {
                        _this._displayWMS(dataset);
                      } else if (type === 'GeoJSON') {
                        _this._displayGeoJSON(dataset);
                      } else {
                        throw new Error('should not happen');
                      }
                    });
                  } else {
                    html = HTML('<span class="label label-' + color + '">' + type + '</span> ');
                  }
                  $('.dataset-distribution-labels', el).add(html);
                };

                for (var _iterator2 = _getIterator(types), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
                  var _ret2 = _loop();

                  if (_ret2 === 'continue') continue;
                }
              } catch (err) {
                _didIteratorError2 = true;
                _iteratorError2 = err;
              } finally {
                try {
                  if (!_iteratorNormalCompletion2 && _iterator2['return']) {
                    _iterator2['return']();
                  }
                } finally {
                  if (_didIteratorError2) {
                    throw _iteratorError2;
                  }
                }
              }
            }
          }

          // TODO the display code should not be directly in the sidebar module
        }, {
          key: '_displayWMS',
          value: function _displayWMS(dataset) {
            var _this2 = this;

            var _iteratorNormalCompletion3 = true;
            var _didIteratorError3 = false;
            var _iteratorError3 = undefined;

            try {
              var _loop2 = function () {
                var dist = _step3.value;

                // TODO remove dcat: once ckanext-dcat is fixed
                var url = dist['dcat:accessURL'];
                _this2.map.fire('dataloading');
                wms.readLayers(url).then(function (wmsLayers) {
                  var _iteratorNormalCompletion4 = true;
                  var _didIteratorError4 = false;
                  var _iteratorError4 = undefined;

                  try {
                    for (var _iterator4 = _getIterator(wmsLayers), _step4; !(_iteratorNormalCompletion4 = (_step4 = _iterator4.next()).done); _iteratorNormalCompletion4 = true) {
                      var wmsLayer = _step4.value;

                      var layer = L.tileLayer.wms(url, {
                        layers: wmsLayer.name,
                        format: 'image/png',
                        transparent: true
                      });
                      _this2.layerControl.addOverlay(layer, wmsLayer.title, { groupName: dataset.title, expanded: true });
                    }
                  } catch (err) {
                    _didIteratorError4 = true;
                    _iteratorError4 = err;
                  } finally {
                    try {
                      if (!_iteratorNormalCompletion4 && _iterator4['return']) {
                        _iterator4['return']();
                      }
                    } finally {
                      if (_didIteratorError4) {
                        throw _iteratorError4;
                      }
                    }
                  }

                  _this2.map.fire('dataload');
                });
              };

              for (var _iterator3 = _getIterator(dataset.distributions.filter(function (dist) {
                return dist.format === 'WMS';
              })), _step3; !(_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done); _iteratorNormalCompletion3 = true) {
                _loop2();
              }
            } catch (err) {
              _didIteratorError3 = true;
              _iteratorError3 = err;
            } finally {
              try {
                if (!_iteratorNormalCompletion3 && _iterator3['return']) {
                  _iterator3['return']();
                }
              } finally {
                if (_didIteratorError3) {
                  throw _iteratorError3;
                }
              }
            }
          }
        }, {
          key: '_displayGeoJSON',
          value: function _displayGeoJSON(dataset) {
            var _this3 = this;

            var bounds = [];
            var _iteratorNormalCompletion5 = true;
            var _didIteratorError5 = false;
            var _iteratorError5 = undefined;

            try {
              var _loop3 = function () {
                var dist = _step5.value;

                // TODO remove dcat: once ckanext-dcat is fixed
                var url = dist['dcat:accessURL'] || dist['dcat:downloadURL'];
                _this3.map.fire('dataloading');
                $.request('get', url).then(function (json) {
                  var layer = L.geoJson(JSON.parse(json), {
                    onEachFeature: function onEachFeature(feature, layer) {
                      layer.bindPopup('<pre><code class="code-nowrap">' + JSON.stringify(feature.properties, null, 4) + '</code></pre>', { maxWidth: 400, maxHeight: 300 });
                    }
                  });
                  bounds.push(layer.getBounds());
                  layer.addTo(_this3.map);
                  _this3.layerControl.addOverlay(layer, dist.title, { groupName: dataset.title, expanded: true });
                  _this3.map.fitBounds(bounds);
                  _this3.map.fire('dataload');
                });
              };

              for (var _iterator5 = _getIterator(dataset.distributions.filter(function (dist) {
                return dist.format === 'GeoJSON';
              })), _step5; !(_iteratorNormalCompletion5 = (_step5 = _iterator5.next()).done); _iteratorNormalCompletion5 = true) {
                _loop3();
              }
            } catch (err) {
              _didIteratorError5 = true;
              _iteratorError5 = err;
            } finally {
              try {
                if (!_iteratorNormalCompletion5 && _iterator5['return']) {
                  _iterator5['return']();
                }
              } finally {
                if (_didIteratorError5) {
                  throw _iteratorError5;
                }
              }
            }
          }
        }, {
          key: 'open',
          value: function open(tabId) {
            this.control.open(tabId);
          }
        }]);

        return Sidebar;
      })();

      _export('default', Sidebar);
    }
  };
});

$__System.register("61", [], function() { return { setters: [], execute: function() {} } });

$__System.register("62", [], function() { return { setters: [], execute: function() {} } });

$__System.register('1', ['2', '4', '5', '7', '8', '60', '61', '62', 'a', 'c'], function (_export) {
  'use strict';

  var L, Sidebar, jsonld, DCAT_CATALOG_URL, DCAT_CATALOG_FRAME, map, osm, baseMaps, layerControl, sidebar;
  return {
    setters: [function (_) {}, function (_2) {
      L = _2['default'];
    }, function (_3) {}, function (_4) {}, function (_5) {}, function (_6) {
      Sidebar = _6['default'];
    }, function (_7) {}, function (_8) {}, function (_a) {}, function (_c) {
      jsonld = _c.promises;
    }],
    execute: function () {
      DCAT_CATALOG_URL = 'http://ckan-demo.melodiesproject.eu';
      DCAT_CATALOG_FRAME = {
        "@context": ["https://rawgit.com/ec-melodies/wp02-dcat/master/context.jsonld", { // override since we want the GeoJSON geometry, not the WKT one
          "geometry": {
            "@id": "locn:geometry",
            "@type": "https://www.iana.org/assignments/media-types/application/vnd.geo+json"
          }
        }],
        "@type": "Catalog"
      };
      map = L.map('map', {
        loadingControl: true,
        // initial center and zoom has to be set before layers can be added
        center: [10, 0],
        zoom: 2
      });

      // Layer control and base layer setup
      osm = L.tileLayer('http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: 'Map data &copy; <a href="http://www.osm.org">OpenStreetMap</a>'
      });

      osm.addTo(map);

      baseMaps = [{
        groupName: 'Base Maps',
        expanded: true,
        layers: {
          'OpenStreetMap': osm
        }
      }];
      layerControl = L.Control.styledLayerControl(baseMaps, [], {
        container_width: "300px",
        container_maxHeight: "500px",
        collapsed: false
      });

      map.addControl(layerControl);

      // Sidebar setup
      sidebar = new Sidebar(map, { layerControl: layerControl });

      jsonld.frame(DCAT_CATALOG_URL, DCAT_CATALOG_FRAME).then(function (framed) {
        return jsonld.compact(framed, framed['@context']);
      }).then(function (compacted) {
        var datasets = compacted.datasets;
        console.log(datasets);
        sidebar.addDatasets(datasets);
        sidebar.open('datasets');
      })['catch'](function (e) {
        alert('Error: ' + e);
      });
    }
  };
});

$__System.register('github:twbs/bootstrap@3.3.5/css/bootstrap.css!github:systemjs/plugin-css@0.1.19', [], false, function() {});
$__System.register('github:Leaflet/Leaflet@0.7.7/dist/leaflet.css!github:systemjs/plugin-css@0.1.19', [], false, function() {});
$__System.register('github:ebrelsford/Leaflet.loading@0.1.16/src/Control.Loading.css!github:systemjs/plugin-css@0.1.19', [], false, function() {});
$__System.register('github:Turbo87/sidebar-v2@master/css/leaflet-sidebar.css!github:systemjs/plugin-css@0.1.19', [], false, function() {});
$__System.register('app/css/style.css!github:systemjs/plugin-css@0.1.19', [], false, function() {});
$__System.register('app/css/styledLayerControl/styledLayerControl.css!github:systemjs/plugin-css@0.1.19', [], false, function() {});
(function(c){if (typeof document == 'undefined') return; var d=document,a='appendChild',i='styleSheet',s=d.createElement('style');s.type='text/css';d.getElementsByTagName('head')[0][a](s);s[i]?s[i].cssText=c:s[a](d.createTextNode(c));})
("/*!\n * Bootstrap v3.3.5 (http://getbootstrap.com)\n * Copyright 2011-2015 Twitter, Inc.\n * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)\n *//*! normalize.css v3.0.3 | MIT License | github.com/necolas/normalize.css */html{font-family:sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}body{margin:0}article,aside,details,figcaption,figure,footer,header,hgroup,main,menu,nav,section,summary{display:block}audio,canvas,progress,video{display:inline-block;vertical-align:baseline}audio:not([controls]){display:none;height:0}[hidden],template{display:none}a{background-color:transparent}a:active,a:hover{outline:0}abbr[title]{border-bottom:1px dotted}b,strong{font-weight:700}dfn{font-style:italic}h1{margin:.67em 0;font-size:2em}mark{color:#000;background:#ff0}small{font-size:80%}sub,sup{position:relative;font-size:75%;line-height:0;vertical-align:baseline}sup{top:-.5em}sub{bottom:-.25em}img{border:0}svg:not(:root){overflow:hidden}figure{margin:1em 40px}hr{height:0;-webkit-box-sizing:content-box;-moz-box-sizing:content-box;box-sizing:content-box}pre{overflow:auto}code,kbd,pre,samp{font-family:monospace,monospace;font-size:1em}button,input,optgroup,select,textarea{margin:0;font:inherit;color:inherit}button{overflow:visible}button,select{text-transform:none}button,html input[type=button],input[type=reset],input[type=submit]{-webkit-appearance:button;cursor:pointer}button[disabled],html input[disabled]{cursor:default}button::-moz-focus-inner,input::-moz-focus-inner{padding:0;border:0}input{line-height:normal}input[type=checkbox],input[type=radio]{-webkit-box-sizing:border-box;-moz-box-sizing:border-box;box-sizing:border-box;padding:0}input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{height:auto}input[type=search]{-webkit-box-sizing:content-box;-moz-box-sizing:content-box;box-sizing:content-box;-webkit-appearance:textfield}input[type=search]::-webkit-search-cancel-button,input[type=search]::-webkit-search-decoration{-webkit-appearance:none}fieldset{padding:.35em .625em .75em;margin:0 2px;border:1px solid silver}legend{padding:0;border:0}textarea{overflow:auto}optgroup{font-weight:700}table{border-spacing:0;border-collapse:collapse}td,th{padding:0}/*! Source: https://github.com/h5bp/html5-boilerplate/blob/master/src/css/main.css */@media print{*,:after,:before{color:#000!important;text-shadow:none!important;background:0 0!important;-webkit-box-shadow:none!important;box-shadow:none!important}a,a:visited{text-decoration:underline}a[href]:after{content:\" (\" attr(href) \")\"}abbr[title]:after{content:\" (\" attr(title) \")\"}a[href^=\"javascript:\"]:after,a[href^=\"#\"]:after{content:\"\"}blockquote,pre{border:1px solid #999;page-break-inside:avoid}thead{display:table-header-group}img,tr{page-break-inside:avoid}img{max-width:100%!important}h2,h3,p{orphans:3;widows:3}h2,h3{page-break-after:avoid}.navbar{display:none}.btn>.caret,.dropup>.btn>.caret{border-top-color:#000!important}.label{border:1px solid #000}.table{border-collapse:collapse!important}.table td,.table th{background-color:#fff!important}.table-bordered td,.table-bordered th{border:1px solid #ddd!important}}@font-face{font-family:'Glyphicons Halflings';src:url(jspm_packages/github/twbs/bootstrap@3.3.5/fonts/glyphicons-halflings-regular.eot);src:url(jspm_packages/github/twbs/bootstrap@3.3.5/fonts/glyphicons-halflings-regular.eot?#iefix) format('embedded-opentype'),url(jspm_packages/github/twbs/bootstrap@3.3.5/fonts/glyphicons-halflings-regular.woff2) format('woff2'),url(jspm_packages/github/twbs/bootstrap@3.3.5/fonts/glyphicons-halflings-regular.woff) format('woff'),url(jspm_packages/github/twbs/bootstrap@3.3.5/fonts/glyphicons-halflings-regular.ttf) format('truetype'),url(jspm_packages/github/twbs/bootstrap@3.3.5/fonts/glyphicons-halflings-regular.svg#glyphicons_halflingsregular) format('svg')}.glyphicon{position:relative;top:1px;display:inline-block;font-family:'Glyphicons Halflings';font-style:normal;font-weight:400;line-height:1;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}.glyphicon-asterisk:before{content:\"\\2a\"}.glyphicon-plus:before{content:\"\\2b\"}.glyphicon-eur:before,.glyphicon-euro:before{content:\"\\20ac\"}.glyphicon-minus:before{content:\"\\2212\"}.glyphicon-cloud:before{content:\"\\2601\"}.glyphicon-envelope:before{content:\"\\2709\"}.glyphicon-pencil:before{content:\"\\270f\"}.glyphicon-glass:before{content:\"\\e001\"}.glyphicon-music:before{content:\"\\e002\"}.glyphicon-search:before{content:\"\\e003\"}.glyphicon-heart:before{content:\"\\e005\"}.glyphicon-star:before{content:\"\\e006\"}.glyphicon-star-empty:before{content:\"\\e007\"}.glyphicon-user:before{content:\"\\e008\"}.glyphicon-film:before{content:\"\\e009\"}.glyphicon-th-large:before{content:\"\\e010\"}.glyphicon-th:before{content:\"\\e011\"}.glyphicon-th-list:before{content:\"\\e012\"}.glyphicon-ok:before{content:\"\\e013\"}.glyphicon-remove:before{content:\"\\e014\"}.glyphicon-zoom-in:before{content:\"\\e015\"}.glyphicon-zoom-out:before{content:\"\\e016\"}.glyphicon-off:before{content:\"\\e017\"}.glyphicon-signal:before{content:\"\\e018\"}.glyphicon-cog:before{content:\"\\e019\"}.glyphicon-trash:before{content:\"\\e020\"}.glyphicon-home:before{content:\"\\e021\"}.glyphicon-file:before{content:\"\\e022\"}.glyphicon-time:before{content:\"\\e023\"}.glyphicon-road:before{content:\"\\e024\"}.glyphicon-download-alt:before{content:\"\\e025\"}.glyphicon-download:before{content:\"\\e026\"}.glyphicon-upload:before{content:\"\\e027\"}.glyphicon-inbox:before{content:\"\\e028\"}.glyphicon-play-circle:before{content:\"\\e029\"}.glyphicon-repeat:before{content:\"\\e030\"}.glyphicon-refresh:before{content:\"\\e031\"}.glyphicon-list-alt:before{content:\"\\e032\"}.glyphicon-lock:before{content:\"\\e033\"}.glyphicon-flag:before{content:\"\\e034\"}.glyphicon-headphones:before{content:\"\\e035\"}.glyphicon-volume-off:before{content:\"\\e036\"}.glyphicon-volume-down:before{content:\"\\e037\"}.glyphicon-volume-up:before{content:\"\\e038\"}.glyphicon-qrcode:before{content:\"\\e039\"}.glyphicon-barcode:before{content:\"\\e040\"}.glyphicon-tag:before{content:\"\\e041\"}.glyphicon-tags:before{content:\"\\e042\"}.glyphicon-book:before{content:\"\\e043\"}.glyphicon-bookmark:before{content:\"\\e044\"}.glyphicon-print:before{content:\"\\e045\"}.glyphicon-camera:before{content:\"\\e046\"}.glyphicon-font:before{content:\"\\e047\"}.glyphicon-bold:before{content:\"\\e048\"}.glyphicon-italic:before{content:\"\\e049\"}.glyphicon-text-height:before{content:\"\\e050\"}.glyphicon-text-width:before{content:\"\\e051\"}.glyphicon-align-left:before{content:\"\\e052\"}.glyphicon-align-center:before{content:\"\\e053\"}.glyphicon-align-right:before{content:\"\\e054\"}.glyphicon-align-justify:before{content:\"\\e055\"}.glyphicon-list:before{content:\"\\e056\"}.glyphicon-indent-left:before{content:\"\\e057\"}.glyphicon-indent-right:before{content:\"\\e058\"}.glyphicon-facetime-video:before{content:\"\\e059\"}.glyphicon-picture:before{content:\"\\e060\"}.glyphicon-map-marker:before{content:\"\\e062\"}.glyphicon-adjust:before{content:\"\\e063\"}.glyphicon-tint:before{content:\"\\e064\"}.glyphicon-edit:before{content:\"\\e065\"}.glyphicon-share:before{content:\"\\e066\"}.glyphicon-check:before{content:\"\\e067\"}.glyphicon-move:before{content:\"\\e068\"}.glyphicon-step-backward:before{content:\"\\e069\"}.glyphicon-fast-backward:before{content:\"\\e070\"}.glyphicon-backward:before{content:\"\\e071\"}.glyphicon-play:before{content:\"\\e072\"}.glyphicon-pause:before{content:\"\\e073\"}.glyphicon-stop:before{content:\"\\e074\"}.glyphicon-forward:before{content:\"\\e075\"}.glyphicon-fast-forward:before{content:\"\\e076\"}.glyphicon-step-forward:before{content:\"\\e077\"}.glyphicon-eject:before{content:\"\\e078\"}.glyphicon-chevron-left:before{content:\"\\e079\"}.glyphicon-chevron-right:before{content:\"\\e080\"}.glyphicon-plus-sign:before{content:\"\\e081\"}.glyphicon-minus-sign:before{content:\"\\e082\"}.glyphicon-remove-sign:before{content:\"\\e083\"}.glyphicon-ok-sign:before{content:\"\\e084\"}.glyphicon-question-sign:before{content:\"\\e085\"}.glyphicon-info-sign:before{content:\"\\e086\"}.glyphicon-screenshot:before{content:\"\\e087\"}.glyphicon-remove-circle:before{content:\"\\e088\"}.glyphicon-ok-circle:before{content:\"\\e089\"}.glyphicon-ban-circle:before{content:\"\\e090\"}.glyphicon-arrow-left:before{content:\"\\e091\"}.glyphicon-arrow-right:before{content:\"\\e092\"}.glyphicon-arrow-up:before{content:\"\\e093\"}.glyphicon-arrow-down:before{content:\"\\e094\"}.glyphicon-share-alt:before{content:\"\\e095\"}.glyphicon-resize-full:before{content:\"\\e096\"}.glyphicon-resize-small:before{content:\"\\e097\"}.glyphicon-exclamation-sign:before{content:\"\\e101\"}.glyphicon-gift:before{content:\"\\e102\"}.glyphicon-leaf:before{content:\"\\e103\"}.glyphicon-fire:before{content:\"\\e104\"}.glyphicon-eye-open:before{content:\"\\e105\"}.glyphicon-eye-close:before{content:\"\\e106\"}.glyphicon-warning-sign:before{content:\"\\e107\"}.glyphicon-plane:before{content:\"\\e108\"}.glyphicon-calendar:before{content:\"\\e109\"}.glyphicon-random:before{content:\"\\e110\"}.glyphicon-comment:before{content:\"\\e111\"}.glyphicon-magnet:before{content:\"\\e112\"}.glyphicon-chevron-up:before{content:\"\\e113\"}.glyphicon-chevron-down:before{content:\"\\e114\"}.glyphicon-retweet:before{content:\"\\e115\"}.glyphicon-shopping-cart:before{content:\"\\e116\"}.glyphicon-folder-close:before{content:\"\\e117\"}.glyphicon-folder-open:before{content:\"\\e118\"}.glyphicon-resize-vertical:before{content:\"\\e119\"}.glyphicon-resize-horizontal:before{content:\"\\e120\"}.glyphicon-hdd:before{content:\"\\e121\"}.glyphicon-bullhorn:before{content:\"\\e122\"}.glyphicon-bell:before{content:\"\\e123\"}.glyphicon-certificate:before{content:\"\\e124\"}.glyphicon-thumbs-up:before{content:\"\\e125\"}.glyphicon-thumbs-down:before{content:\"\\e126\"}.glyphicon-hand-right:before{content:\"\\e127\"}.glyphicon-hand-left:before{content:\"\\e128\"}.glyphicon-hand-up:before{content:\"\\e129\"}.glyphicon-hand-down:before{content:\"\\e130\"}.glyphicon-circle-arrow-right:before{content:\"\\e131\"}.glyphicon-circle-arrow-left:before{content:\"\\e132\"}.glyphicon-circle-arrow-up:before{content:\"\\e133\"}.glyphicon-circle-arrow-down:before{content:\"\\e134\"}.glyphicon-globe:before{content:\"\\e135\"}.glyphicon-wrench:before{content:\"\\e136\"}.glyphicon-tasks:before{content:\"\\e137\"}.glyphicon-filter:before{content:\"\\e138\"}.glyphicon-briefcase:before{content:\"\\e139\"}.glyphicon-fullscreen:before{content:\"\\e140\"}.glyphicon-dashboard:before{content:\"\\e141\"}.glyphicon-paperclip:before{content:\"\\e142\"}.glyphicon-heart-empty:before{content:\"\\e143\"}.glyphicon-link:before{content:\"\\e144\"}.glyphicon-phone:before{content:\"\\e145\"}.glyphicon-pushpin:before{content:\"\\e146\"}.glyphicon-usd:before{content:\"\\e148\"}.glyphicon-gbp:before{content:\"\\e149\"}.glyphicon-sort:before{content:\"\\e150\"}.glyphicon-sort-by-alphabet:before{content:\"\\e151\"}.glyphicon-sort-by-alphabet-alt:before{content:\"\\e152\"}.glyphicon-sort-by-order:before{content:\"\\e153\"}.glyphicon-sort-by-order-alt:before{content:\"\\e154\"}.glyphicon-sort-by-attributes:before{content:\"\\e155\"}.glyphicon-sort-by-attributes-alt:before{content:\"\\e156\"}.glyphicon-unchecked:before{content:\"\\e157\"}.glyphicon-expand:before{content:\"\\e158\"}.glyphicon-collapse-down:before{content:\"\\e159\"}.glyphicon-collapse-up:before{content:\"\\e160\"}.glyphicon-log-in:before{content:\"\\e161\"}.glyphicon-flash:before{content:\"\\e162\"}.glyphicon-log-out:before{content:\"\\e163\"}.glyphicon-new-window:before{content:\"\\e164\"}.glyphicon-record:before{content:\"\\e165\"}.glyphicon-save:before{content:\"\\e166\"}.glyphicon-open:before{content:\"\\e167\"}.glyphicon-saved:before{content:\"\\e168\"}.glyphicon-import:before{content:\"\\e169\"}.glyphicon-export:before{content:\"\\e170\"}.glyphicon-send:before{content:\"\\e171\"}.glyphicon-floppy-disk:before{content:\"\\e172\"}.glyphicon-floppy-saved:before{content:\"\\e173\"}.glyphicon-floppy-remove:before{content:\"\\e174\"}.glyphicon-floppy-save:before{content:\"\\e175\"}.glyphicon-floppy-open:before{content:\"\\e176\"}.glyphicon-credit-card:before{content:\"\\e177\"}.glyphicon-transfer:before{content:\"\\e178\"}.glyphicon-cutlery:before{content:\"\\e179\"}.glyphicon-header:before{content:\"\\e180\"}.glyphicon-compressed:before{content:\"\\e181\"}.glyphicon-earphone:before{content:\"\\e182\"}.glyphicon-phone-alt:before{content:\"\\e183\"}.glyphicon-tower:before{content:\"\\e184\"}.glyphicon-stats:before{content:\"\\e185\"}.glyphicon-sd-video:before{content:\"\\e186\"}.glyphicon-hd-video:before{content:\"\\e187\"}.glyphicon-subtitles:before{content:\"\\e188\"}.glyphicon-sound-stereo:before{content:\"\\e189\"}.glyphicon-sound-dolby:before{content:\"\\e190\"}.glyphicon-sound-5-1:before{content:\"\\e191\"}.glyphicon-sound-6-1:before{content:\"\\e192\"}.glyphicon-sound-7-1:before{content:\"\\e193\"}.glyphicon-copyright-mark:before{content:\"\\e194\"}.glyphicon-registration-mark:before{content:\"\\e195\"}.glyphicon-cloud-download:before{content:\"\\e197\"}.glyphicon-cloud-upload:before{content:\"\\e198\"}.glyphicon-tree-conifer:before{content:\"\\e199\"}.glyphicon-tree-deciduous:before{content:\"\\e200\"}.glyphicon-cd:before{content:\"\\e201\"}.glyphicon-save-file:before{content:\"\\e202\"}.glyphicon-open-file:before{content:\"\\e203\"}.glyphicon-level-up:before{content:\"\\e204\"}.glyphicon-copy:before{content:\"\\e205\"}.glyphicon-paste:before{content:\"\\e206\"}.glyphicon-alert:before{content:\"\\e209\"}.glyphicon-equalizer:before{content:\"\\e210\"}.glyphicon-king:before{content:\"\\e211\"}.glyphicon-queen:before{content:\"\\e212\"}.glyphicon-pawn:before{content:\"\\e213\"}.glyphicon-bishop:before{content:\"\\e214\"}.glyphicon-knight:before{content:\"\\e215\"}.glyphicon-baby-formula:before{content:\"\\e216\"}.glyphicon-tent:before{content:\"\\26fa\"}.glyphicon-blackboard:before{content:\"\\e218\"}.glyphicon-bed:before{content:\"\\e219\"}.glyphicon-apple:before{content:\"\\f8ff\"}.glyphicon-erase:before{content:\"\\e221\"}.glyphicon-hourglass:before{content:\"\\231b\"}.glyphicon-lamp:before{content:\"\\e223\"}.glyphicon-duplicate:before{content:\"\\e224\"}.glyphicon-piggy-bank:before{content:\"\\e225\"}.glyphicon-scissors:before{content:\"\\e226\"}.glyphicon-bitcoin:before{content:\"\\e227\"}.glyphicon-btc:before{content:\"\\e227\"}.glyphicon-xbt:before{content:\"\\e227\"}.glyphicon-yen:before{content:\"\\00a5\"}.glyphicon-jpy:before{content:\"\\00a5\"}.glyphicon-ruble:before{content:\"\\20bd\"}.glyphicon-rub:before{content:\"\\20bd\"}.glyphicon-scale:before{content:\"\\e230\"}.glyphicon-ice-lolly:before{content:\"\\e231\"}.glyphicon-ice-lolly-tasted:before{content:\"\\e232\"}.glyphicon-education:before{content:\"\\e233\"}.glyphicon-option-horizontal:before{content:\"\\e234\"}.glyphicon-option-vertical:before{content:\"\\e235\"}.glyphicon-menu-hamburger:before{content:\"\\e236\"}.glyphicon-modal-window:before{content:\"\\e237\"}.glyphicon-oil:before{content:\"\\e238\"}.glyphicon-grain:before{content:\"\\e239\"}.glyphicon-sunglasses:before{content:\"\\e240\"}.glyphicon-text-size:before{content:\"\\e241\"}.glyphicon-text-color:before{content:\"\\e242\"}.glyphicon-text-background:before{content:\"\\e243\"}.glyphicon-object-align-top:before{content:\"\\e244\"}.glyphicon-object-align-bottom:before{content:\"\\e245\"}.glyphicon-object-align-horizontal:before{content:\"\\e246\"}.glyphicon-object-align-left:before{content:\"\\e247\"}.glyphicon-object-align-vertical:before{content:\"\\e248\"}.glyphicon-object-align-right:before{content:\"\\e249\"}.glyphicon-triangle-right:before{content:\"\\e250\"}.glyphicon-triangle-left:before{content:\"\\e251\"}.glyphicon-triangle-bottom:before{content:\"\\e252\"}.glyphicon-triangle-top:before{content:\"\\e253\"}.glyphicon-console:before{content:\"\\e254\"}.glyphicon-superscript:before{content:\"\\e255\"}.glyphicon-subscript:before{content:\"\\e256\"}.glyphicon-menu-left:before{content:\"\\e257\"}.glyphicon-menu-right:before{content:\"\\e258\"}.glyphicon-menu-down:before{content:\"\\e259\"}.glyphicon-menu-up:before{content:\"\\e260\"}*{-webkit-box-sizing:border-box;-moz-box-sizing:border-box;box-sizing:border-box}:after,:before{-webkit-box-sizing:border-box;-moz-box-sizing:border-box;box-sizing:border-box}html{font-size:10px;-webkit-tap-highlight-color:transparent}body{font-family:\"Helvetica Neue\",Helvetica,Arial,sans-serif;font-size:14px;line-height:1.42857143;color:#333;background-color:#fff}button,input,select,textarea{font-family:inherit;font-size:inherit;line-height:inherit}a{color:#337ab7;text-decoration:none}a:focus,a:hover{color:#23527c;text-decoration:underline}a:focus{outline:thin dotted;outline:5px auto -webkit-focus-ring-color;outline-offset:-2px}figure{margin:0}img{vertical-align:middle}.carousel-inner>.item>a>img,.carousel-inner>.item>img,.img-responsive,.thumbnail a>img,.thumbnail>img{display:block;max-width:100%;height:auto}.img-rounded{border-radius:6px}.img-thumbnail{display:inline-block;max-width:100%;height:auto;padding:4px;line-height:1.42857143;background-color:#fff;border:1px solid #ddd;border-radius:4px;-webkit-transition:all .2s ease-in-out;-o-transition:all .2s ease-in-out;transition:all .2s ease-in-out}.img-circle{border-radius:50%}hr{margin-top:20px;margin-bottom:20px;border:0;border-top:1px solid #eee}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0}.sr-only-focusable:active,.sr-only-focusable:focus{position:static;width:auto;height:auto;margin:0;overflow:visible;clip:auto}[role=button]{cursor:pointer}.h1,.h2,.h3,.h4,.h5,.h6,h1,h2,h3,h4,h5,h6{font-family:inherit;font-weight:500;line-height:1.1;color:inherit}.h1 .small,.h1 small,.h2 .small,.h2 small,.h3 .small,.h3 small,.h4 .small,.h4 small,.h5 .small,.h5 small,.h6 .small,.h6 small,h1 .small,h1 small,h2 .small,h2 small,h3 .small,h3 small,h4 .small,h4 small,h5 .small,h5 small,h6 .small,h6 small{font-weight:400;line-height:1;color:#777}.h1,.h2,.h3,h1,h2,h3{margin-top:20px;margin-bottom:10px}.h1 .small,.h1 small,.h2 .small,.h2 small,.h3 .small,.h3 small,h1 .small,h1 small,h2 .small,h2 small,h3 .small,h3 small{font-size:65%}.h4,.h5,.h6,h4,h5,h6{margin-top:10px;margin-bottom:10px}.h4 .small,.h4 small,.h5 .small,.h5 small,.h6 .small,.h6 small,h4 .small,h4 small,h5 .small,h5 small,h6 .small,h6 small{font-size:75%}.h1,h1{font-size:36px}.h2,h2{font-size:30px}.h3,h3{font-size:24px}.h4,h4{font-size:18px}.h5,h5{font-size:14px}.h6,h6{font-size:12px}p{margin:0 0 10px}.lead{margin-bottom:20px;font-size:16px;font-weight:300;line-height:1.4}@media (min-width:768px){.lead{font-size:21px}}.small,small{font-size:85%}.mark,mark{padding:.2em;background-color:#fcf8e3}.text-left{text-align:left}.text-right{text-align:right}.text-center{text-align:center}.text-justify{text-align:justify}.text-nowrap{white-space:nowrap}.text-lowercase{text-transform:lowercase}.text-uppercase{text-transform:uppercase}.text-capitalize{text-transform:capitalize}.text-muted{color:#777}.text-primary{color:#337ab7}a.text-primary:focus,a.text-primary:hover{color:#286090}.text-success{color:#3c763d}a.text-success:focus,a.text-success:hover{color:#2b542c}.text-info{color:#31708f}a.text-info:focus,a.text-info:hover{color:#245269}.text-warning{color:#8a6d3b}a.text-warning:focus,a.text-warning:hover{color:#66512c}.text-danger{color:#a94442}a.text-danger:focus,a.text-danger:hover{color:#843534}.bg-primary{color:#fff;background-color:#337ab7}a.bg-primary:focus,a.bg-primary:hover{background-color:#286090}.bg-success{background-color:#dff0d8}a.bg-success:focus,a.bg-success:hover{background-color:#c1e2b3}.bg-info{background-color:#d9edf7}a.bg-info:focus,a.bg-info:hover{background-color:#afd9ee}.bg-warning{background-color:#fcf8e3}a.bg-warning:focus,a.bg-warning:hover{background-color:#f7ecb5}.bg-danger{background-color:#f2dede}a.bg-danger:focus,a.bg-danger:hover{background-color:#e4b9b9}.page-header{padding-bottom:9px;margin:40px 0 20px;border-bottom:1px solid #eee}ol,ul{margin-top:0;margin-bottom:10px}ol ol,ol ul,ul ol,ul ul{margin-bottom:0}.list-unstyled{padding-left:0;list-style:none}.list-inline{padding-left:0;margin-left:-5px;list-style:none}.list-inline>li{display:inline-block;padding-right:5px;padding-left:5px}dl{margin-top:0;margin-bottom:20px}dd,dt{line-height:1.42857143}dt{font-weight:700}dd{margin-left:0}@media (min-width:768px){.dl-horizontal dt{float:left;width:160px;overflow:hidden;clear:left;text-align:right;text-overflow:ellipsis;white-space:nowrap}.dl-horizontal dd{margin-left:180px}}abbr[data-original-title],abbr[title]{cursor:help;border-bottom:1px dotted #777}.initialism{font-size:90%;text-transform:uppercase}blockquote{padding:10px 20px;margin:0 0 20px;font-size:17.5px;border-left:5px solid #eee}blockquote ol:last-child,blockquote p:last-child,blockquote ul:last-child{margin-bottom:0}blockquote .small,blockquote footer,blockquote small{display:block;font-size:80%;line-height:1.42857143;color:#777}blockquote .small:before,blockquote footer:before,blockquote small:before{content:'\\2014 \\00A0'}.blockquote-reverse,blockquote.pull-right{padding-right:15px;padding-left:0;text-align:right;border-right:5px solid #eee;border-left:0}.blockquote-reverse .small:before,.blockquote-reverse footer:before,.blockquote-reverse small:before,blockquote.pull-right .small:before,blockquote.pull-right footer:before,blockquote.pull-right small:before{content:''}.blockquote-reverse .small:after,.blockquote-reverse footer:after,.blockquote-reverse small:after,blockquote.pull-right .small:after,blockquote.pull-right footer:after,blockquote.pull-right small:after{content:'\\00A0 \\2014'}address{margin-bottom:20px;font-style:normal;line-height:1.42857143}code,kbd,pre,samp{font-family:Menlo,Monaco,Consolas,\"Courier New\",monospace}code{padding:2px 4px;font-size:90%;color:#c7254e;background-color:#f9f2f4;border-radius:4px}kbd{padding:2px 4px;font-size:90%;color:#fff;background-color:#333;border-radius:3px;-webkit-box-shadow:inset 0 -1px 0 rgba(0,0,0,.25);box-shadow:inset 0 -1px 0 rgba(0,0,0,.25)}kbd kbd{padding:0;font-size:100%;font-weight:700;-webkit-box-shadow:none;box-shadow:none}pre{display:block;padding:9.5px;margin:0 0 10px;font-size:13px;line-height:1.42857143;color:#333;word-break:break-all;word-wrap:break-word;background-color:#f5f5f5;border:1px solid #ccc;border-radius:4px}pre code{padding:0;font-size:inherit;color:inherit;white-space:pre-wrap;background-color:transparent;border-radius:0}.pre-scrollable{max-height:340px;overflow-y:scroll}.container{padding-right:15px;padding-left:15px;margin-right:auto;margin-left:auto}@media (min-width:768px){.container{width:750px}}@media (min-width:992px){.container{width:970px}}@media (min-width:1200px){.container{width:1170px}}.container-fluid{padding-right:15px;padding-left:15px;margin-right:auto;margin-left:auto}.row{margin-right:-15px;margin-left:-15px}.col-lg-1,.col-lg-10,.col-lg-11,.col-lg-12,.col-lg-2,.col-lg-3,.col-lg-4,.col-lg-5,.col-lg-6,.col-lg-7,.col-lg-8,.col-lg-9,.col-md-1,.col-md-10,.col-md-11,.col-md-12,.col-md-2,.col-md-3,.col-md-4,.col-md-5,.col-md-6,.col-md-7,.col-md-8,.col-md-9,.col-sm-1,.col-sm-10,.col-sm-11,.col-sm-12,.col-sm-2,.col-sm-3,.col-sm-4,.col-sm-5,.col-sm-6,.col-sm-7,.col-sm-8,.col-sm-9,.col-xs-1,.col-xs-10,.col-xs-11,.col-xs-12,.col-xs-2,.col-xs-3,.col-xs-4,.col-xs-5,.col-xs-6,.col-xs-7,.col-xs-8,.col-xs-9{position:relative;min-height:1px;padding-right:15px;padding-left:15px}.col-xs-1,.col-xs-10,.col-xs-11,.col-xs-12,.col-xs-2,.col-xs-3,.col-xs-4,.col-xs-5,.col-xs-6,.col-xs-7,.col-xs-8,.col-xs-9{float:left}.col-xs-12{width:100%}.col-xs-11{width:91.66666667%}.col-xs-10{width:83.33333333%}.col-xs-9{width:75%}.col-xs-8{width:66.66666667%}.col-xs-7{width:58.33333333%}.col-xs-6{width:50%}.col-xs-5{width:41.66666667%}.col-xs-4{width:33.33333333%}.col-xs-3{width:25%}.col-xs-2{width:16.66666667%}.col-xs-1{width:8.33333333%}.col-xs-pull-12{right:100%}.col-xs-pull-11{right:91.66666667%}.col-xs-pull-10{right:83.33333333%}.col-xs-pull-9{right:75%}.col-xs-pull-8{right:66.66666667%}.col-xs-pull-7{right:58.33333333%}.col-xs-pull-6{right:50%}.col-xs-pull-5{right:41.66666667%}.col-xs-pull-4{right:33.33333333%}.col-xs-pull-3{right:25%}.col-xs-pull-2{right:16.66666667%}.col-xs-pull-1{right:8.33333333%}.col-xs-pull-0{right:auto}.col-xs-push-12{left:100%}.col-xs-push-11{left:91.66666667%}.col-xs-push-10{left:83.33333333%}.col-xs-push-9{left:75%}.col-xs-push-8{left:66.66666667%}.col-xs-push-7{left:58.33333333%}.col-xs-push-6{left:50%}.col-xs-push-5{left:41.66666667%}.col-xs-push-4{left:33.33333333%}.col-xs-push-3{left:25%}.col-xs-push-2{left:16.66666667%}.col-xs-push-1{left:8.33333333%}.col-xs-push-0{left:auto}.col-xs-offset-12{margin-left:100%}.col-xs-offset-11{margin-left:91.66666667%}.col-xs-offset-10{margin-left:83.33333333%}.col-xs-offset-9{margin-left:75%}.col-xs-offset-8{margin-left:66.66666667%}.col-xs-offset-7{margin-left:58.33333333%}.col-xs-offset-6{margin-left:50%}.col-xs-offset-5{margin-left:41.66666667%}.col-xs-offset-4{margin-left:33.33333333%}.col-xs-offset-3{margin-left:25%}.col-xs-offset-2{margin-left:16.66666667%}.col-xs-offset-1{margin-left:8.33333333%}.col-xs-offset-0{margin-left:0}@media (min-width:768px){.col-sm-1,.col-sm-10,.col-sm-11,.col-sm-12,.col-sm-2,.col-sm-3,.col-sm-4,.col-sm-5,.col-sm-6,.col-sm-7,.col-sm-8,.col-sm-9{float:left}.col-sm-12{width:100%}.col-sm-11{width:91.66666667%}.col-sm-10{width:83.33333333%}.col-sm-9{width:75%}.col-sm-8{width:66.66666667%}.col-sm-7{width:58.33333333%}.col-sm-6{width:50%}.col-sm-5{width:41.66666667%}.col-sm-4{width:33.33333333%}.col-sm-3{width:25%}.col-sm-2{width:16.66666667%}.col-sm-1{width:8.33333333%}.col-sm-pull-12{right:100%}.col-sm-pull-11{right:91.66666667%}.col-sm-pull-10{right:83.33333333%}.col-sm-pull-9{right:75%}.col-sm-pull-8{right:66.66666667%}.col-sm-pull-7{right:58.33333333%}.col-sm-pull-6{right:50%}.col-sm-pull-5{right:41.66666667%}.col-sm-pull-4{right:33.33333333%}.col-sm-pull-3{right:25%}.col-sm-pull-2{right:16.66666667%}.col-sm-pull-1{right:8.33333333%}.col-sm-pull-0{right:auto}.col-sm-push-12{left:100%}.col-sm-push-11{left:91.66666667%}.col-sm-push-10{left:83.33333333%}.col-sm-push-9{left:75%}.col-sm-push-8{left:66.66666667%}.col-sm-push-7{left:58.33333333%}.col-sm-push-6{left:50%}.col-sm-push-5{left:41.66666667%}.col-sm-push-4{left:33.33333333%}.col-sm-push-3{left:25%}.col-sm-push-2{left:16.66666667%}.col-sm-push-1{left:8.33333333%}.col-sm-push-0{left:auto}.col-sm-offset-12{margin-left:100%}.col-sm-offset-11{margin-left:91.66666667%}.col-sm-offset-10{margin-left:83.33333333%}.col-sm-offset-9{margin-left:75%}.col-sm-offset-8{margin-left:66.66666667%}.col-sm-offset-7{margin-left:58.33333333%}.col-sm-offset-6{margin-left:50%}.col-sm-offset-5{margin-left:41.66666667%}.col-sm-offset-4{margin-left:33.33333333%}.col-sm-offset-3{margin-left:25%}.col-sm-offset-2{margin-left:16.66666667%}.col-sm-offset-1{margin-left:8.33333333%}.col-sm-offset-0{margin-left:0}}@media (min-width:992px){.col-md-1,.col-md-10,.col-md-11,.col-md-12,.col-md-2,.col-md-3,.col-md-4,.col-md-5,.col-md-6,.col-md-7,.col-md-8,.col-md-9{float:left}.col-md-12{width:100%}.col-md-11{width:91.66666667%}.col-md-10{width:83.33333333%}.col-md-9{width:75%}.col-md-8{width:66.66666667%}.col-md-7{width:58.33333333%}.col-md-6{width:50%}.col-md-5{width:41.66666667%}.col-md-4{width:33.33333333%}.col-md-3{width:25%}.col-md-2{width:16.66666667%}.col-md-1{width:8.33333333%}.col-md-pull-12{right:100%}.col-md-pull-11{right:91.66666667%}.col-md-pull-10{right:83.33333333%}.col-md-pull-9{right:75%}.col-md-pull-8{right:66.66666667%}.col-md-pull-7{right:58.33333333%}.col-md-pull-6{right:50%}.col-md-pull-5{right:41.66666667%}.col-md-pull-4{right:33.33333333%}.col-md-pull-3{right:25%}.col-md-pull-2{right:16.66666667%}.col-md-pull-1{right:8.33333333%}.col-md-pull-0{right:auto}.col-md-push-12{left:100%}.col-md-push-11{left:91.66666667%}.col-md-push-10{left:83.33333333%}.col-md-push-9{left:75%}.col-md-push-8{left:66.66666667%}.col-md-push-7{left:58.33333333%}.col-md-push-6{left:50%}.col-md-push-5{left:41.66666667%}.col-md-push-4{left:33.33333333%}.col-md-push-3{left:25%}.col-md-push-2{left:16.66666667%}.col-md-push-1{left:8.33333333%}.col-md-push-0{left:auto}.col-md-offset-12{margin-left:100%}.col-md-offset-11{margin-left:91.66666667%}.col-md-offset-10{margin-left:83.33333333%}.col-md-offset-9{margin-left:75%}.col-md-offset-8{margin-left:66.66666667%}.col-md-offset-7{margin-left:58.33333333%}.col-md-offset-6{margin-left:50%}.col-md-offset-5{margin-left:41.66666667%}.col-md-offset-4{margin-left:33.33333333%}.col-md-offset-3{margin-left:25%}.col-md-offset-2{margin-left:16.66666667%}.col-md-offset-1{margin-left:8.33333333%}.col-md-offset-0{margin-left:0}}@media (min-width:1200px){.col-lg-1,.col-lg-10,.col-lg-11,.col-lg-12,.col-lg-2,.col-lg-3,.col-lg-4,.col-lg-5,.col-lg-6,.col-lg-7,.col-lg-8,.col-lg-9{float:left}.col-lg-12{width:100%}.col-lg-11{width:91.66666667%}.col-lg-10{width:83.33333333%}.col-lg-9{width:75%}.col-lg-8{width:66.66666667%}.col-lg-7{width:58.33333333%}.col-lg-6{width:50%}.col-lg-5{width:41.66666667%}.col-lg-4{width:33.33333333%}.col-lg-3{width:25%}.col-lg-2{width:16.66666667%}.col-lg-1{width:8.33333333%}.col-lg-pull-12{right:100%}.col-lg-pull-11{right:91.66666667%}.col-lg-pull-10{right:83.33333333%}.col-lg-pull-9{right:75%}.col-lg-pull-8{right:66.66666667%}.col-lg-pull-7{right:58.33333333%}.col-lg-pull-6{right:50%}.col-lg-pull-5{right:41.66666667%}.col-lg-pull-4{right:33.33333333%}.col-lg-pull-3{right:25%}.col-lg-pull-2{right:16.66666667%}.col-lg-pull-1{right:8.33333333%}.col-lg-pull-0{right:auto}.col-lg-push-12{left:100%}.col-lg-push-11{left:91.66666667%}.col-lg-push-10{left:83.33333333%}.col-lg-push-9{left:75%}.col-lg-push-8{left:66.66666667%}.col-lg-push-7{left:58.33333333%}.col-lg-push-6{left:50%}.col-lg-push-5{left:41.66666667%}.col-lg-push-4{left:33.33333333%}.col-lg-push-3{left:25%}.col-lg-push-2{left:16.66666667%}.col-lg-push-1{left:8.33333333%}.col-lg-push-0{left:auto}.col-lg-offset-12{margin-left:100%}.col-lg-offset-11{margin-left:91.66666667%}.col-lg-offset-10{margin-left:83.33333333%}.col-lg-offset-9{margin-left:75%}.col-lg-offset-8{margin-left:66.66666667%}.col-lg-offset-7{margin-left:58.33333333%}.col-lg-offset-6{margin-left:50%}.col-lg-offset-5{margin-left:41.66666667%}.col-lg-offset-4{margin-left:33.33333333%}.col-lg-offset-3{margin-left:25%}.col-lg-offset-2{margin-left:16.66666667%}.col-lg-offset-1{margin-left:8.33333333%}.col-lg-offset-0{margin-left:0}}table{background-color:transparent}caption{padding-top:8px;padding-bottom:8px;color:#777;text-align:left}th{text-align:left}.table{width:100%;max-width:100%;margin-bottom:20px}.table>tbody>tr>td,.table>tbody>tr>th,.table>tfoot>tr>td,.table>tfoot>tr>th,.table>thead>tr>td,.table>thead>tr>th{padding:8px;line-height:1.42857143;vertical-align:top;border-top:1px solid #ddd}.table>thead>tr>th{vertical-align:bottom;border-bottom:2px solid #ddd}.table>caption+thead>tr:first-child>td,.table>caption+thead>tr:first-child>th,.table>colgroup+thead>tr:first-child>td,.table>colgroup+thead>tr:first-child>th,.table>thead:first-child>tr:first-child>td,.table>thead:first-child>tr:first-child>th{border-top:0}.table>tbody+tbody{border-top:2px solid #ddd}.table .table{background-color:#fff}.table-condensed>tbody>tr>td,.table-condensed>tbody>tr>th,.table-condensed>tfoot>tr>td,.table-condensed>tfoot>tr>th,.table-condensed>thead>tr>td,.table-condensed>thead>tr>th{padding:5px}.table-bordered{border:1px solid #ddd}.table-bordered>tbody>tr>td,.table-bordered>tbody>tr>th,.table-bordered>tfoot>tr>td,.table-bordered>tfoot>tr>th,.table-bordered>thead>tr>td,.table-bordered>thead>tr>th{border:1px solid #ddd}.table-bordered>thead>tr>td,.table-bordered>thead>tr>th{border-bottom-width:2px}.table-striped>tbody>tr:nth-of-type(odd){background-color:#f9f9f9}.table-hover>tbody>tr:hover{background-color:#f5f5f5}table col[class*=col-]{position:static;display:table-column;float:none}table td[class*=col-],table th[class*=col-]{position:static;display:table-cell;float:none}.table>tbody>tr.active>td,.table>tbody>tr.active>th,.table>tbody>tr>td.active,.table>tbody>tr>th.active,.table>tfoot>tr.active>td,.table>tfoot>tr.active>th,.table>tfoot>tr>td.active,.table>tfoot>tr>th.active,.table>thead>tr.active>td,.table>thead>tr.active>th,.table>thead>tr>td.active,.table>thead>tr>th.active{background-color:#f5f5f5}.table-hover>tbody>tr.active:hover>td,.table-hover>tbody>tr.active:hover>th,.table-hover>tbody>tr:hover>.active,.table-hover>tbody>tr>td.active:hover,.table-hover>tbody>tr>th.active:hover{background-color:#e8e8e8}.table>tbody>tr.success>td,.table>tbody>tr.success>th,.table>tbody>tr>td.success,.table>tbody>tr>th.success,.table>tfoot>tr.success>td,.table>tfoot>tr.success>th,.table>tfoot>tr>td.success,.table>tfoot>tr>th.success,.table>thead>tr.success>td,.table>thead>tr.success>th,.table>thead>tr>td.success,.table>thead>tr>th.success{background-color:#dff0d8}.table-hover>tbody>tr.success:hover>td,.table-hover>tbody>tr.success:hover>th,.table-hover>tbody>tr:hover>.success,.table-hover>tbody>tr>td.success:hover,.table-hover>tbody>tr>th.success:hover{background-color:#d0e9c6}.table>tbody>tr.info>td,.table>tbody>tr.info>th,.table>tbody>tr>td.info,.table>tbody>tr>th.info,.table>tfoot>tr.info>td,.table>tfoot>tr.info>th,.table>tfoot>tr>td.info,.table>tfoot>tr>th.info,.table>thead>tr.info>td,.table>thead>tr.info>th,.table>thead>tr>td.info,.table>thead>tr>th.info{background-color:#d9edf7}.table-hover>tbody>tr.info:hover>td,.table-hover>tbody>tr.info:hover>th,.table-hover>tbody>tr:hover>.info,.table-hover>tbody>tr>td.info:hover,.table-hover>tbody>tr>th.info:hover{background-color:#c4e3f3}.table>tbody>tr.warning>td,.table>tbody>tr.warning>th,.table>tbody>tr>td.warning,.table>tbody>tr>th.warning,.table>tfoot>tr.warning>td,.table>tfoot>tr.warning>th,.table>tfoot>tr>td.warning,.table>tfoot>tr>th.warning,.table>thead>tr.warning>td,.table>thead>tr.warning>th,.table>thead>tr>td.warning,.table>thead>tr>th.warning{background-color:#fcf8e3}.table-hover>tbody>tr.warning:hover>td,.table-hover>tbody>tr.warning:hover>th,.table-hover>tbody>tr:hover>.warning,.table-hover>tbody>tr>td.warning:hover,.table-hover>tbody>tr>th.warning:hover{background-color:#faf2cc}.table>tbody>tr.danger>td,.table>tbody>tr.danger>th,.table>tbody>tr>td.danger,.table>tbody>tr>th.danger,.table>tfoot>tr.danger>td,.table>tfoot>tr.danger>th,.table>tfoot>tr>td.danger,.table>tfoot>tr>th.danger,.table>thead>tr.danger>td,.table>thead>tr.danger>th,.table>thead>tr>td.danger,.table>thead>tr>th.danger{background-color:#f2dede}.table-hover>tbody>tr.danger:hover>td,.table-hover>tbody>tr.danger:hover>th,.table-hover>tbody>tr:hover>.danger,.table-hover>tbody>tr>td.danger:hover,.table-hover>tbody>tr>th.danger:hover{background-color:#ebcccc}.table-responsive{min-height:.01%;overflow-x:auto}@media screen and (max-width:767px){.table-responsive{width:100%;margin-bottom:15px;overflow-y:hidden;-ms-overflow-style:-ms-autohiding-scrollbar;border:1px solid #ddd}.table-responsive>.table{margin-bottom:0}.table-responsive>.table>tbody>tr>td,.table-responsive>.table>tbody>tr>th,.table-responsive>.table>tfoot>tr>td,.table-responsive>.table>tfoot>tr>th,.table-responsive>.table>thead>tr>td,.table-responsive>.table>thead>tr>th{white-space:nowrap}.table-responsive>.table-bordered{border:0}.table-responsive>.table-bordered>tbody>tr>td:first-child,.table-responsive>.table-bordered>tbody>tr>th:first-child,.table-responsive>.table-bordered>tfoot>tr>td:first-child,.table-responsive>.table-bordered>tfoot>tr>th:first-child,.table-responsive>.table-bordered>thead>tr>td:first-child,.table-responsive>.table-bordered>thead>tr>th:first-child{border-left:0}.table-responsive>.table-bordered>tbody>tr>td:last-child,.table-responsive>.table-bordered>tbody>tr>th:last-child,.table-responsive>.table-bordered>tfoot>tr>td:last-child,.table-responsive>.table-bordered>tfoot>tr>th:last-child,.table-responsive>.table-bordered>thead>tr>td:last-child,.table-responsive>.table-bordered>thead>tr>th:last-child{border-right:0}.table-responsive>.table-bordered>tbody>tr:last-child>td,.table-responsive>.table-bordered>tbody>tr:last-child>th,.table-responsive>.table-bordered>tfoot>tr:last-child>td,.table-responsive>.table-bordered>tfoot>tr:last-child>th{border-bottom:0}}fieldset{min-width:0;padding:0;margin:0;border:0}legend{display:block;width:100%;padding:0;margin-bottom:20px;font-size:21px;line-height:inherit;color:#333;border:0;border-bottom:1px solid #e5e5e5}label{display:inline-block;max-width:100%;margin-bottom:5px;font-weight:700}input[type=search]{-webkit-box-sizing:border-box;-moz-box-sizing:border-box;box-sizing:border-box}input[type=checkbox],input[type=radio]{margin:4px 0 0;margin-top:1px\\9;line-height:normal}input[type=file]{display:block}input[type=range]{display:block;width:100%}select[multiple],select[size]{height:auto}input[type=file]:focus,input[type=checkbox]:focus,input[type=radio]:focus{outline:thin dotted;outline:5px auto -webkit-focus-ring-color;outline-offset:-2px}output{display:block;padding-top:7px;font-size:14px;line-height:1.42857143;color:#555}.form-control{display:block;width:100%;height:34px;padding:6px 12px;font-size:14px;line-height:1.42857143;color:#555;background-color:#fff;background-image:none;border:1px solid #ccc;border-radius:4px;-webkit-box-shadow:inset 0 1px 1px rgba(0,0,0,.075);box-shadow:inset 0 1px 1px rgba(0,0,0,.075);-webkit-transition:border-color ease-in-out .15s,-webkit-box-shadow ease-in-out .15s;-o-transition:border-color ease-in-out .15s,box-shadow ease-in-out .15s;transition:border-color ease-in-out .15s,box-shadow ease-in-out .15s}.form-control:focus{border-color:#66afe9;outline:0;-webkit-box-shadow:inset 0 1px 1px rgba(0,0,0,.075),0 0 8px rgba(102,175,233,.6);box-shadow:inset 0 1px 1px rgba(0,0,0,.075),0 0 8px rgba(102,175,233,.6)}.form-control::-moz-placeholder{color:#999;opacity:1}.form-control:-ms-input-placeholder{color:#999}.form-control::-webkit-input-placeholder{color:#999}.form-control[disabled],.form-control[readonly],fieldset[disabled] .form-control{background-color:#eee;opacity:1}.form-control[disabled],fieldset[disabled] .form-control{cursor:not-allowed}textarea.form-control{height:auto}input[type=search]{-webkit-appearance:none}@media screen and (-webkit-min-device-pixel-ratio:0){input[type=date].form-control,input[type=time].form-control,input[type=datetime-local].form-control,input[type=month].form-control{line-height:34px}.input-group-sm input[type=date],.input-group-sm input[type=time],.input-group-sm input[type=datetime-local],.input-group-sm input[type=month],input[type=date].input-sm,input[type=time].input-sm,input[type=datetime-local].input-sm,input[type=month].input-sm{line-height:30px}.input-group-lg input[type=date],.input-group-lg input[type=time],.input-group-lg input[type=datetime-local],.input-group-lg input[type=month],input[type=date].input-lg,input[type=time].input-lg,input[type=datetime-local].input-lg,input[type=month].input-lg{line-height:46px}}.form-group{margin-bottom:15px}.checkbox,.radio{position:relative;display:block;margin-top:10px;margin-bottom:10px}.checkbox label,.radio label{min-height:20px;padding-left:20px;margin-bottom:0;font-weight:400;cursor:pointer}.checkbox input[type=checkbox],.checkbox-inline input[type=checkbox],.radio input[type=radio],.radio-inline input[type=radio]{position:absolute;margin-top:4px\\9;margin-left:-20px}.checkbox+.checkbox,.radio+.radio{margin-top:-5px}.checkbox-inline,.radio-inline{position:relative;display:inline-block;padding-left:20px;margin-bottom:0;font-weight:400;vertical-align:middle;cursor:pointer}.checkbox-inline+.checkbox-inline,.radio-inline+.radio-inline{margin-top:0;margin-left:10px}fieldset[disabled] input[type=checkbox],fieldset[disabled] input[type=radio],input[type=checkbox].disabled,input[type=checkbox][disabled],input[type=radio].disabled,input[type=radio][disabled]{cursor:not-allowed}.checkbox-inline.disabled,.radio-inline.disabled,fieldset[disabled] .checkbox-inline,fieldset[disabled] .radio-inline{cursor:not-allowed}.checkbox.disabled label,.radio.disabled label,fieldset[disabled] .checkbox label,fieldset[disabled] .radio label{cursor:not-allowed}.form-control-static{min-height:34px;padding-top:7px;padding-bottom:7px;margin-bottom:0}.form-control-static.input-lg,.form-control-static.input-sm{padding-right:0;padding-left:0}.input-sm{height:30px;padding:5px 10px;font-size:12px;line-height:1.5;border-radius:3px}select.input-sm{height:30px;line-height:30px}select[multiple].input-sm,textarea.input-sm{height:auto}.form-group-sm .form-control{height:30px;padding:5px 10px;font-size:12px;line-height:1.5;border-radius:3px}.form-group-sm select.form-control{height:30px;line-height:30px}.form-group-sm select[multiple].form-control,.form-group-sm textarea.form-control{height:auto}.form-group-sm .form-control-static{height:30px;min-height:32px;padding:6px 10px;font-size:12px;line-height:1.5}.input-lg{height:46px;padding:10px 16px;font-size:18px;line-height:1.3333333;border-radius:6px}select.input-lg{height:46px;line-height:46px}select[multiple].input-lg,textarea.input-lg{height:auto}.form-group-lg .form-control{height:46px;padding:10px 16px;font-size:18px;line-height:1.3333333;border-radius:6px}.form-group-lg select.form-control{height:46px;line-height:46px}.form-group-lg select[multiple].form-control,.form-group-lg textarea.form-control{height:auto}.form-group-lg .form-control-static{height:46px;min-height:38px;padding:11px 16px;font-size:18px;line-height:1.3333333}.has-feedback{position:relative}.has-feedback .form-control{padding-right:42.5px}.form-control-feedback{position:absolute;top:0;right:0;z-index:2;display:block;width:34px;height:34px;line-height:34px;text-align:center;pointer-events:none}.form-group-lg .form-control+.form-control-feedback,.input-group-lg+.form-control-feedback,.input-lg+.form-control-feedback{width:46px;height:46px;line-height:46px}.form-group-sm .form-control+.form-control-feedback,.input-group-sm+.form-control-feedback,.input-sm+.form-control-feedback{width:30px;height:30px;line-height:30px}.has-success .checkbox,.has-success .checkbox-inline,.has-success .control-label,.has-success .help-block,.has-success .radio,.has-success .radio-inline,.has-success.checkbox label,.has-success.checkbox-inline label,.has-success.radio label,.has-success.radio-inline label{color:#3c763d}.has-success .form-control{border-color:#3c763d;-webkit-box-shadow:inset 0 1px 1px rgba(0,0,0,.075);box-shadow:inset 0 1px 1px rgba(0,0,0,.075)}.has-success .form-control:focus{border-color:#2b542c;-webkit-box-shadow:inset 0 1px 1px rgba(0,0,0,.075),0 0 6px #67b168;box-shadow:inset 0 1px 1px rgba(0,0,0,.075),0 0 6px #67b168}.has-success .input-group-addon{color:#3c763d;background-color:#dff0d8;border-color:#3c763d}.has-success .form-control-feedback{color:#3c763d}.has-warning .checkbox,.has-warning .checkbox-inline,.has-warning .control-label,.has-warning .help-block,.has-warning .radio,.has-warning .radio-inline,.has-warning.checkbox label,.has-warning.checkbox-inline label,.has-warning.radio label,.has-warning.radio-inline label{color:#8a6d3b}.has-warning .form-control{border-color:#8a6d3b;-webkit-box-shadow:inset 0 1px 1px rgba(0,0,0,.075);box-shadow:inset 0 1px 1px rgba(0,0,0,.075)}.has-warning .form-control:focus{border-color:#66512c;-webkit-box-shadow:inset 0 1px 1px rgba(0,0,0,.075),0 0 6px #c0a16b;box-shadow:inset 0 1px 1px rgba(0,0,0,.075),0 0 6px #c0a16b}.has-warning .input-group-addon{color:#8a6d3b;background-color:#fcf8e3;border-color:#8a6d3b}.has-warning .form-control-feedback{color:#8a6d3b}.has-error .checkbox,.has-error .checkbox-inline,.has-error .control-label,.has-error .help-block,.has-error .radio,.has-error .radio-inline,.has-error.checkbox label,.has-error.checkbox-inline label,.has-error.radio label,.has-error.radio-inline label{color:#a94442}.has-error .form-control{border-color:#a94442;-webkit-box-shadow:inset 0 1px 1px rgba(0,0,0,.075);box-shadow:inset 0 1px 1px rgba(0,0,0,.075)}.has-error .form-control:focus{border-color:#843534;-webkit-box-shadow:inset 0 1px 1px rgba(0,0,0,.075),0 0 6px #ce8483;box-shadow:inset 0 1px 1px rgba(0,0,0,.075),0 0 6px #ce8483}.has-error .input-group-addon{color:#a94442;background-color:#f2dede;border-color:#a94442}.has-error .form-control-feedback{color:#a94442}.has-feedback label~.form-control-feedback{top:25px}.has-feedback label.sr-only~.form-control-feedback{top:0}.help-block{display:block;margin-top:5px;margin-bottom:10px;color:#737373}@media (min-width:768px){.form-inline .form-group{display:inline-block;margin-bottom:0;vertical-align:middle}.form-inline .form-control{display:inline-block;width:auto;vertical-align:middle}.form-inline .form-control-static{display:inline-block}.form-inline .input-group{display:inline-table;vertical-align:middle}.form-inline .input-group .form-control,.form-inline .input-group .input-group-addon,.form-inline .input-group .input-group-btn{width:auto}.form-inline .input-group>.form-control{width:100%}.form-inline .control-label{margin-bottom:0;vertical-align:middle}.form-inline .checkbox,.form-inline .radio{display:inline-block;margin-top:0;margin-bottom:0;vertical-align:middle}.form-inline .checkbox label,.form-inline .radio label{padding-left:0}.form-inline .checkbox input[type=checkbox],.form-inline .radio input[type=radio]{position:relative;margin-left:0}.form-inline .has-feedback .form-control-feedback{top:0}}.form-horizontal .checkbox,.form-horizontal .checkbox-inline,.form-horizontal .radio,.form-horizontal .radio-inline{padding-top:7px;margin-top:0;margin-bottom:0}.form-horizontal .checkbox,.form-horizontal .radio{min-height:27px}.form-horizontal .form-group{margin-right:-15px;margin-left:-15px}@media (min-width:768px){.form-horizontal .control-label{padding-top:7px;margin-bottom:0;text-align:right}}.form-horizontal .has-feedback .form-control-feedback{right:15px}@media (min-width:768px){.form-horizontal .form-group-lg .control-label{padding-top:14.33px;font-size:18px}}@media (min-width:768px){.form-horizontal .form-group-sm .control-label{padding-top:6px;font-size:12px}}.btn{display:inline-block;padding:6px 12px;margin-bottom:0;font-size:14px;font-weight:400;line-height:1.42857143;text-align:center;white-space:nowrap;vertical-align:middle;-ms-touch-action:manipulation;touch-action:manipulation;cursor:pointer;-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none;background-image:none;border:1px solid transparent;border-radius:4px}.btn.active.focus,.btn.active:focus,.btn.focus,.btn:active.focus,.btn:active:focus,.btn:focus{outline:thin dotted;outline:5px auto -webkit-focus-ring-color;outline-offset:-2px}.btn.focus,.btn:focus,.btn:hover{color:#333;text-decoration:none}.btn.active,.btn:active{background-image:none;outline:0;-webkit-box-shadow:inset 0 3px 5px rgba(0,0,0,.125);box-shadow:inset 0 3px 5px rgba(0,0,0,.125)}.btn.disabled,.btn[disabled],fieldset[disabled] .btn{cursor:not-allowed;filter:alpha(opacity=65);-webkit-box-shadow:none;box-shadow:none;opacity:.65}a.btn.disabled,fieldset[disabled] a.btn{pointer-events:none}.btn-default{color:#333;background-color:#fff;border-color:#ccc}.btn-default.focus,.btn-default:focus{color:#333;background-color:#e6e6e6;border-color:#8c8c8c}.btn-default:hover{color:#333;background-color:#e6e6e6;border-color:#adadad}.btn-default.active,.btn-default:active,.open>.dropdown-toggle.btn-default{color:#333;background-color:#e6e6e6;border-color:#adadad}.btn-default.active.focus,.btn-default.active:focus,.btn-default.active:hover,.btn-default:active.focus,.btn-default:active:focus,.btn-default:active:hover,.open>.dropdown-toggle.btn-default.focus,.open>.dropdown-toggle.btn-default:focus,.open>.dropdown-toggle.btn-default:hover{color:#333;background-color:#d4d4d4;border-color:#8c8c8c}.btn-default.active,.btn-default:active,.open>.dropdown-toggle.btn-default{background-image:none}.btn-default.disabled,.btn-default.disabled.active,.btn-default.disabled.focus,.btn-default.disabled:active,.btn-default.disabled:focus,.btn-default.disabled:hover,.btn-default[disabled],.btn-default[disabled].active,.btn-default[disabled].focus,.btn-default[disabled]:active,.btn-default[disabled]:focus,.btn-default[disabled]:hover,fieldset[disabled] .btn-default,fieldset[disabled] .btn-default.active,fieldset[disabled] .btn-default.focus,fieldset[disabled] .btn-default:active,fieldset[disabled] .btn-default:focus,fieldset[disabled] .btn-default:hover{background-color:#fff;border-color:#ccc}.btn-default .badge{color:#fff;background-color:#333}.btn-primary{color:#fff;background-color:#337ab7;border-color:#2e6da4}.btn-primary.focus,.btn-primary:focus{color:#fff;background-color:#286090;border-color:#122b40}.btn-primary:hover{color:#fff;background-color:#286090;border-color:#204d74}.btn-primary.active,.btn-primary:active,.open>.dropdown-toggle.btn-primary{color:#fff;background-color:#286090;border-color:#204d74}.btn-primary.active.focus,.btn-primary.active:focus,.btn-primary.active:hover,.btn-primary:active.focus,.btn-primary:active:focus,.btn-primary:active:hover,.open>.dropdown-toggle.btn-primary.focus,.open>.dropdown-toggle.btn-primary:focus,.open>.dropdown-toggle.btn-primary:hover{color:#fff;background-color:#204d74;border-color:#122b40}.btn-primary.active,.btn-primary:active,.open>.dropdown-toggle.btn-primary{background-image:none}.btn-primary.disabled,.btn-primary.disabled.active,.btn-primary.disabled.focus,.btn-primary.disabled:active,.btn-primary.disabled:focus,.btn-primary.disabled:hover,.btn-primary[disabled],.btn-primary[disabled].active,.btn-primary[disabled].focus,.btn-primary[disabled]:active,.btn-primary[disabled]:focus,.btn-primary[disabled]:hover,fieldset[disabled] .btn-primary,fieldset[disabled] .btn-primary.active,fieldset[disabled] .btn-primary.focus,fieldset[disabled] .btn-primary:active,fieldset[disabled] .btn-primary:focus,fieldset[disabled] .btn-primary:hover{background-color:#337ab7;border-color:#2e6da4}.btn-primary .badge{color:#337ab7;background-color:#fff}.btn-success{color:#fff;background-color:#5cb85c;border-color:#4cae4c}.btn-success.focus,.btn-success:focus{color:#fff;background-color:#449d44;border-color:#255625}.btn-success:hover{color:#fff;background-color:#449d44;border-color:#398439}.btn-success.active,.btn-success:active,.open>.dropdown-toggle.btn-success{color:#fff;background-color:#449d44;border-color:#398439}.btn-success.active.focus,.btn-success.active:focus,.btn-success.active:hover,.btn-success:active.focus,.btn-success:active:focus,.btn-success:active:hover,.open>.dropdown-toggle.btn-success.focus,.open>.dropdown-toggle.btn-success:focus,.open>.dropdown-toggle.btn-success:hover{color:#fff;background-color:#398439;border-color:#255625}.btn-success.active,.btn-success:active,.open>.dropdown-toggle.btn-success{background-image:none}.btn-success.disabled,.btn-success.disabled.active,.btn-success.disabled.focus,.btn-success.disabled:active,.btn-success.disabled:focus,.btn-success.disabled:hover,.btn-success[disabled],.btn-success[disabled].active,.btn-success[disabled].focus,.btn-success[disabled]:active,.btn-success[disabled]:focus,.btn-success[disabled]:hover,fieldset[disabled] .btn-success,fieldset[disabled] .btn-success.active,fieldset[disabled] .btn-success.focus,fieldset[disabled] .btn-success:active,fieldset[disabled] .btn-success:focus,fieldset[disabled] .btn-success:hover{background-color:#5cb85c;border-color:#4cae4c}.btn-success .badge{color:#5cb85c;background-color:#fff}.btn-info{color:#fff;background-color:#5bc0de;border-color:#46b8da}.btn-info.focus,.btn-info:focus{color:#fff;background-color:#31b0d5;border-color:#1b6d85}.btn-info:hover{color:#fff;background-color:#31b0d5;border-color:#269abc}.btn-info.active,.btn-info:active,.open>.dropdown-toggle.btn-info{color:#fff;background-color:#31b0d5;border-color:#269abc}.btn-info.active.focus,.btn-info.active:focus,.btn-info.active:hover,.btn-info:active.focus,.btn-info:active:focus,.btn-info:active:hover,.open>.dropdown-toggle.btn-info.focus,.open>.dropdown-toggle.btn-info:focus,.open>.dropdown-toggle.btn-info:hover{color:#fff;background-color:#269abc;border-color:#1b6d85}.btn-info.active,.btn-info:active,.open>.dropdown-toggle.btn-info{background-image:none}.btn-info.disabled,.btn-info.disabled.active,.btn-info.disabled.focus,.btn-info.disabled:active,.btn-info.disabled:focus,.btn-info.disabled:hover,.btn-info[disabled],.btn-info[disabled].active,.btn-info[disabled].focus,.btn-info[disabled]:active,.btn-info[disabled]:focus,.btn-info[disabled]:hover,fieldset[disabled] .btn-info,fieldset[disabled] .btn-info.active,fieldset[disabled] .btn-info.focus,fieldset[disabled] .btn-info:active,fieldset[disabled] .btn-info:focus,fieldset[disabled] .btn-info:hover{background-color:#5bc0de;border-color:#46b8da}.btn-info .badge{color:#5bc0de;background-color:#fff}.btn-warning{color:#fff;background-color:#f0ad4e;border-color:#eea236}.btn-warning.focus,.btn-warning:focus{color:#fff;background-color:#ec971f;border-color:#985f0d}.btn-warning:hover{color:#fff;background-color:#ec971f;border-color:#d58512}.btn-warning.active,.btn-warning:active,.open>.dropdown-toggle.btn-warning{color:#fff;background-color:#ec971f;border-color:#d58512}.btn-warning.active.focus,.btn-warning.active:focus,.btn-warning.active:hover,.btn-warning:active.focus,.btn-warning:active:focus,.btn-warning:active:hover,.open>.dropdown-toggle.btn-warning.focus,.open>.dropdown-toggle.btn-warning:focus,.open>.dropdown-toggle.btn-warning:hover{color:#fff;background-color:#d58512;border-color:#985f0d}.btn-warning.active,.btn-warning:active,.open>.dropdown-toggle.btn-warning{background-image:none}.btn-warning.disabled,.btn-warning.disabled.active,.btn-warning.disabled.focus,.btn-warning.disabled:active,.btn-warning.disabled:focus,.btn-warning.disabled:hover,.btn-warning[disabled],.btn-warning[disabled].active,.btn-warning[disabled].focus,.btn-warning[disabled]:active,.btn-warning[disabled]:focus,.btn-warning[disabled]:hover,fieldset[disabled] .btn-warning,fieldset[disabled] .btn-warning.active,fieldset[disabled] .btn-warning.focus,fieldset[disabled] .btn-warning:active,fieldset[disabled] .btn-warning:focus,fieldset[disabled] .btn-warning:hover{background-color:#f0ad4e;border-color:#eea236}.btn-warning .badge{color:#f0ad4e;background-color:#fff}.btn-danger{color:#fff;background-color:#d9534f;border-color:#d43f3a}.btn-danger.focus,.btn-danger:focus{color:#fff;background-color:#c9302c;border-color:#761c19}.btn-danger:hover{color:#fff;background-color:#c9302c;border-color:#ac2925}.btn-danger.active,.btn-danger:active,.open>.dropdown-toggle.btn-danger{color:#fff;background-color:#c9302c;border-color:#ac2925}.btn-danger.active.focus,.btn-danger.active:focus,.btn-danger.active:hover,.btn-danger:active.focus,.btn-danger:active:focus,.btn-danger:active:hover,.open>.dropdown-toggle.btn-danger.focus,.open>.dropdown-toggle.btn-danger:focus,.open>.dropdown-toggle.btn-danger:hover{color:#fff;background-color:#ac2925;border-color:#761c19}.btn-danger.active,.btn-danger:active,.open>.dropdown-toggle.btn-danger{background-image:none}.btn-danger.disabled,.btn-danger.disabled.active,.btn-danger.disabled.focus,.btn-danger.disabled:active,.btn-danger.disabled:focus,.btn-danger.disabled:hover,.btn-danger[disabled],.btn-danger[disabled].active,.btn-danger[disabled].focus,.btn-danger[disabled]:active,.btn-danger[disabled]:focus,.btn-danger[disabled]:hover,fieldset[disabled] .btn-danger,fieldset[disabled] .btn-danger.active,fieldset[disabled] .btn-danger.focus,fieldset[disabled] .btn-danger:active,fieldset[disabled] .btn-danger:focus,fieldset[disabled] .btn-danger:hover{background-color:#d9534f;border-color:#d43f3a}.btn-danger .badge{color:#d9534f;background-color:#fff}.btn-link{font-weight:400;color:#337ab7;border-radius:0}.btn-link,.btn-link.active,.btn-link:active,.btn-link[disabled],fieldset[disabled] .btn-link{background-color:transparent;-webkit-box-shadow:none;box-shadow:none}.btn-link,.btn-link:active,.btn-link:focus,.btn-link:hover{border-color:transparent}.btn-link:focus,.btn-link:hover{color:#23527c;text-decoration:underline;background-color:transparent}.btn-link[disabled]:focus,.btn-link[disabled]:hover,fieldset[disabled] .btn-link:focus,fieldset[disabled] .btn-link:hover{color:#777;text-decoration:none}.btn-group-lg>.btn,.btn-lg{padding:10px 16px;font-size:18px;line-height:1.3333333;border-radius:6px}.btn-group-sm>.btn,.btn-sm{padding:5px 10px;font-size:12px;line-height:1.5;border-radius:3px}.btn-group-xs>.btn,.btn-xs{padding:1px 5px;font-size:12px;line-height:1.5;border-radius:3px}.btn-block{display:block;width:100%}.btn-block+.btn-block{margin-top:5px}input[type=button].btn-block,input[type=reset].btn-block,input[type=submit].btn-block{width:100%}.fade{opacity:0;-webkit-transition:opacity .15s linear;-o-transition:opacity .15s linear;transition:opacity .15s linear}.fade.in{opacity:1}.collapse{display:none}.collapse.in{display:block}tr.collapse.in{display:table-row}tbody.collapse.in{display:table-row-group}.collapsing{position:relative;height:0;overflow:hidden;-webkit-transition-timing-function:ease;-o-transition-timing-function:ease;transition-timing-function:ease;-webkit-transition-duration:.35s;-o-transition-duration:.35s;transition-duration:.35s;-webkit-transition-property:height,visibility;-o-transition-property:height,visibility;transition-property:height,visibility}.caret{display:inline-block;width:0;height:0;margin-left:2px;vertical-align:middle;border-top:4px dashed;border-top:4px solid\\9;border-right:4px solid transparent;border-left:4px solid transparent}.dropdown,.dropup{position:relative}.dropdown-toggle:focus{outline:0}.dropdown-menu{position:absolute;top:100%;left:0;z-index:1000;display:none;float:left;min-width:160px;padding:5px 0;margin:2px 0 0;font-size:14px;text-align:left;list-style:none;background-color:#fff;-webkit-background-clip:padding-box;background-clip:padding-box;border:1px solid #ccc;border:1px solid rgba(0,0,0,.15);border-radius:4px;-webkit-box-shadow:0 6px 12px rgba(0,0,0,.175);box-shadow:0 6px 12px rgba(0,0,0,.175)}.dropdown-menu.pull-right{right:0;left:auto}.dropdown-menu .divider{height:1px;margin:9px 0;overflow:hidden;background-color:#e5e5e5}.dropdown-menu>li>a{display:block;padding:3px 20px;clear:both;font-weight:400;line-height:1.42857143;color:#333;white-space:nowrap}.dropdown-menu>li>a:focus,.dropdown-menu>li>a:hover{color:#262626;text-decoration:none;background-color:#f5f5f5}.dropdown-menu>.active>a,.dropdown-menu>.active>a:focus,.dropdown-menu>.active>a:hover{color:#fff;text-decoration:none;background-color:#337ab7;outline:0}.dropdown-menu>.disabled>a,.dropdown-menu>.disabled>a:focus,.dropdown-menu>.disabled>a:hover{color:#777}.dropdown-menu>.disabled>a:focus,.dropdown-menu>.disabled>a:hover{text-decoration:none;cursor:not-allowed;background-color:transparent;background-image:none;filter:progid:DXImageTransform.Microsoft.gradient(enabled=false)}.open>.dropdown-menu{display:block}.open>a{outline:0}.dropdown-menu-right{right:0;left:auto}.dropdown-menu-left{right:auto;left:0}.dropdown-header{display:block;padding:3px 20px;font-size:12px;line-height:1.42857143;color:#777;white-space:nowrap}.dropdown-backdrop{position:fixed;top:0;right:0;bottom:0;left:0;z-index:990}.pull-right>.dropdown-menu{right:0;left:auto}.dropup .caret,.navbar-fixed-bottom .dropdown .caret{content:\"\";border-top:0;border-bottom:4px dashed;border-bottom:4px solid\\9}.dropup .dropdown-menu,.navbar-fixed-bottom .dropdown .dropdown-menu{top:auto;bottom:100%;margin-bottom:2px}@media (min-width:768px){.navbar-right .dropdown-menu{right:0;left:auto}.navbar-right .dropdown-menu-left{right:auto;left:0}}.btn-group,.btn-group-vertical{position:relative;display:inline-block;vertical-align:middle}.btn-group-vertical>.btn,.btn-group>.btn{position:relative;float:left}.btn-group-vertical>.btn.active,.btn-group-vertical>.btn:active,.btn-group-vertical>.btn:focus,.btn-group-vertical>.btn:hover,.btn-group>.btn.active,.btn-group>.btn:active,.btn-group>.btn:focus,.btn-group>.btn:hover{z-index:2}.btn-group .btn+.btn,.btn-group .btn+.btn-group,.btn-group .btn-group+.btn,.btn-group .btn-group+.btn-group{margin-left:-1px}.btn-toolbar{margin-left:-5px}.btn-toolbar .btn,.btn-toolbar .btn-group,.btn-toolbar .input-group{float:left}.btn-toolbar>.btn,.btn-toolbar>.btn-group,.btn-toolbar>.input-group{margin-left:5px}.btn-group>.btn:not(:first-child):not(:last-child):not(.dropdown-toggle){border-radius:0}.btn-group>.btn:first-child{margin-left:0}.btn-group>.btn:first-child:not(:last-child):not(.dropdown-toggle){border-top-right-radius:0;border-bottom-right-radius:0}.btn-group>.btn:last-child:not(:first-child),.btn-group>.dropdown-toggle:not(:first-child){border-top-left-radius:0;border-bottom-left-radius:0}.btn-group>.btn-group{float:left}.btn-group>.btn-group:not(:first-child):not(:last-child)>.btn{border-radius:0}.btn-group>.btn-group:first-child:not(:last-child)>.btn:last-child,.btn-group>.btn-group:first-child:not(:last-child)>.dropdown-toggle{border-top-right-radius:0;border-bottom-right-radius:0}.btn-group>.btn-group:last-child:not(:first-child)>.btn:first-child{border-top-left-radius:0;border-bottom-left-radius:0}.btn-group .dropdown-toggle:active,.btn-group.open .dropdown-toggle{outline:0}.btn-group>.btn+.dropdown-toggle{padding-right:8px;padding-left:8px}.btn-group>.btn-lg+.dropdown-toggle{padding-right:12px;padding-left:12px}.btn-group.open .dropdown-toggle{-webkit-box-shadow:inset 0 3px 5px rgba(0,0,0,.125);box-shadow:inset 0 3px 5px rgba(0,0,0,.125)}.btn-group.open .dropdown-toggle.btn-link{-webkit-box-shadow:none;box-shadow:none}.btn .caret{margin-left:0}.btn-lg .caret{border-width:5px 5px 0;border-bottom-width:0}.dropup .btn-lg .caret{border-width:0 5px 5px}.btn-group-vertical>.btn,.btn-group-vertical>.btn-group,.btn-group-vertical>.btn-group>.btn{display:block;float:none;width:100%;max-width:100%}.btn-group-vertical>.btn-group>.btn{float:none}.btn-group-vertical>.btn+.btn,.btn-group-vertical>.btn+.btn-group,.btn-group-vertical>.btn-group+.btn,.btn-group-vertical>.btn-group+.btn-group{margin-top:-1px;margin-left:0}.btn-group-vertical>.btn:not(:first-child):not(:last-child){border-radius:0}.btn-group-vertical>.btn:first-child:not(:last-child){border-top-right-radius:4px;border-bottom-right-radius:0;border-bottom-left-radius:0}.btn-group-vertical>.btn:last-child:not(:first-child){border-top-left-radius:0;border-top-right-radius:0;border-bottom-left-radius:4px}.btn-group-vertical>.btn-group:not(:first-child):not(:last-child)>.btn{border-radius:0}.btn-group-vertical>.btn-group:first-child:not(:last-child)>.btn:last-child,.btn-group-vertical>.btn-group:first-child:not(:last-child)>.dropdown-toggle{border-bottom-right-radius:0;border-bottom-left-radius:0}.btn-group-vertical>.btn-group:last-child:not(:first-child)>.btn:first-child{border-top-left-radius:0;border-top-right-radius:0}.btn-group-justified{display:table;width:100%;table-layout:fixed;border-collapse:separate}.btn-group-justified>.btn,.btn-group-justified>.btn-group{display:table-cell;float:none;width:1%}.btn-group-justified>.btn-group .btn{width:100%}.btn-group-justified>.btn-group .dropdown-menu{left:auto}[data-toggle=buttons]>.btn input[type=checkbox],[data-toggle=buttons]>.btn input[type=radio],[data-toggle=buttons]>.btn-group>.btn input[type=checkbox],[data-toggle=buttons]>.btn-group>.btn input[type=radio]{position:absolute;clip:rect(0,0,0,0);pointer-events:none}.input-group{position:relative;display:table;border-collapse:separate}.input-group[class*=col-]{float:none;padding-right:0;padding-left:0}.input-group .form-control{position:relative;z-index:2;float:left;width:100%;margin-bottom:0}.input-group-lg>.form-control,.input-group-lg>.input-group-addon,.input-group-lg>.input-group-btn>.btn{height:46px;padding:10px 16px;font-size:18px;line-height:1.3333333;border-radius:6px}select.input-group-lg>.form-control,select.input-group-lg>.input-group-addon,select.input-group-lg>.input-group-btn>.btn{height:46px;line-height:46px}select[multiple].input-group-lg>.form-control,select[multiple].input-group-lg>.input-group-addon,select[multiple].input-group-lg>.input-group-btn>.btn,textarea.input-group-lg>.form-control,textarea.input-group-lg>.input-group-addon,textarea.input-group-lg>.input-group-btn>.btn{height:auto}.input-group-sm>.form-control,.input-group-sm>.input-group-addon,.input-group-sm>.input-group-btn>.btn{height:30px;padding:5px 10px;font-size:12px;line-height:1.5;border-radius:3px}select.input-group-sm>.form-control,select.input-group-sm>.input-group-addon,select.input-group-sm>.input-group-btn>.btn{height:30px;line-height:30px}select[multiple].input-group-sm>.form-control,select[multiple].input-group-sm>.input-group-addon,select[multiple].input-group-sm>.input-group-btn>.btn,textarea.input-group-sm>.form-control,textarea.input-group-sm>.input-group-addon,textarea.input-group-sm>.input-group-btn>.btn{height:auto}.input-group .form-control,.input-group-addon,.input-group-btn{display:table-cell}.input-group .form-control:not(:first-child):not(:last-child),.input-group-addon:not(:first-child):not(:last-child),.input-group-btn:not(:first-child):not(:last-child){border-radius:0}.input-group-addon,.input-group-btn{width:1%;white-space:nowrap;vertical-align:middle}.input-group-addon{padding:6px 12px;font-size:14px;font-weight:400;line-height:1;color:#555;text-align:center;background-color:#eee;border:1px solid #ccc;border-radius:4px}.input-group-addon.input-sm{padding:5px 10px;font-size:12px;border-radius:3px}.input-group-addon.input-lg{padding:10px 16px;font-size:18px;border-radius:6px}.input-group-addon input[type=checkbox],.input-group-addon input[type=radio]{margin-top:0}.input-group .form-control:first-child,.input-group-addon:first-child,.input-group-btn:first-child>.btn,.input-group-btn:first-child>.btn-group>.btn,.input-group-btn:first-child>.dropdown-toggle,.input-group-btn:last-child>.btn-group:not(:last-child)>.btn,.input-group-btn:last-child>.btn:not(:last-child):not(.dropdown-toggle){border-top-right-radius:0;border-bottom-right-radius:0}.input-group-addon:first-child{border-right:0}.input-group .form-control:last-child,.input-group-addon:last-child,.input-group-btn:first-child>.btn-group:not(:first-child)>.btn,.input-group-btn:first-child>.btn:not(:first-child),.input-group-btn:last-child>.btn,.input-group-btn:last-child>.btn-group>.btn,.input-group-btn:last-child>.dropdown-toggle{border-top-left-radius:0;border-bottom-left-radius:0}.input-group-addon:last-child{border-left:0}.input-group-btn{position:relative;font-size:0;white-space:nowrap}.input-group-btn>.btn{position:relative}.input-group-btn>.btn+.btn{margin-left:-1px}.input-group-btn>.btn:active,.input-group-btn>.btn:focus,.input-group-btn>.btn:hover{z-index:2}.input-group-btn:first-child>.btn,.input-group-btn:first-child>.btn-group{margin-right:-1px}.input-group-btn:last-child>.btn,.input-group-btn:last-child>.btn-group{z-index:2;margin-left:-1px}.nav{padding-left:0;margin-bottom:0;list-style:none}.nav>li{position:relative;display:block}.nav>li>a{position:relative;display:block;padding:10px 15px}.nav>li>a:focus,.nav>li>a:hover{text-decoration:none;background-color:#eee}.nav>li.disabled>a{color:#777}.nav>li.disabled>a:focus,.nav>li.disabled>a:hover{color:#777;text-decoration:none;cursor:not-allowed;background-color:transparent}.nav .open>a,.nav .open>a:focus,.nav .open>a:hover{background-color:#eee;border-color:#337ab7}.nav .nav-divider{height:1px;margin:9px 0;overflow:hidden;background-color:#e5e5e5}.nav>li>a>img{max-width:none}.nav-tabs{border-bottom:1px solid #ddd}.nav-tabs>li{float:left;margin-bottom:-1px}.nav-tabs>li>a{margin-right:2px;line-height:1.42857143;border:1px solid transparent;border-radius:4px 4px 0 0}.nav-tabs>li>a:hover{border-color:#eee #eee #ddd}.nav-tabs>li.active>a,.nav-tabs>li.active>a:focus,.nav-tabs>li.active>a:hover{color:#555;cursor:default;background-color:#fff;border:1px solid #ddd;border-bottom-color:transparent}.nav-tabs.nav-justified{width:100%;border-bottom:0}.nav-tabs.nav-justified>li{float:none}.nav-tabs.nav-justified>li>a{margin-bottom:5px;text-align:center}.nav-tabs.nav-justified>.dropdown .dropdown-menu{top:auto;left:auto}@media (min-width:768px){.nav-tabs.nav-justified>li{display:table-cell;width:1%}.nav-tabs.nav-justified>li>a{margin-bottom:0}}.nav-tabs.nav-justified>li>a{margin-right:0;border-radius:4px}.nav-tabs.nav-justified>.active>a,.nav-tabs.nav-justified>.active>a:focus,.nav-tabs.nav-justified>.active>a:hover{border:1px solid #ddd}@media (min-width:768px){.nav-tabs.nav-justified>li>a{border-bottom:1px solid #ddd;border-radius:4px 4px 0 0}.nav-tabs.nav-justified>.active>a,.nav-tabs.nav-justified>.active>a:focus,.nav-tabs.nav-justified>.active>a:hover{border-bottom-color:#fff}}.nav-pills>li{float:left}.nav-pills>li>a{border-radius:4px}.nav-pills>li+li{margin-left:2px}.nav-pills>li.active>a,.nav-pills>li.active>a:focus,.nav-pills>li.active>a:hover{color:#fff;background-color:#337ab7}.nav-stacked>li{float:none}.nav-stacked>li+li{margin-top:2px;margin-left:0}.nav-justified{width:100%}.nav-justified>li{float:none}.nav-justified>li>a{margin-bottom:5px;text-align:center}.nav-justified>.dropdown .dropdown-menu{top:auto;left:auto}@media (min-width:768px){.nav-justified>li{display:table-cell;width:1%}.nav-justified>li>a{margin-bottom:0}}.nav-tabs-justified{border-bottom:0}.nav-tabs-justified>li>a{margin-right:0;border-radius:4px}.nav-tabs-justified>.active>a,.nav-tabs-justified>.active>a:focus,.nav-tabs-justified>.active>a:hover{border:1px solid #ddd}@media (min-width:768px){.nav-tabs-justified>li>a{border-bottom:1px solid #ddd;border-radius:4px 4px 0 0}.nav-tabs-justified>.active>a,.nav-tabs-justified>.active>a:focus,.nav-tabs-justified>.active>a:hover{border-bottom-color:#fff}}.tab-content>.tab-pane{display:none}.tab-content>.active{display:block}.nav-tabs .dropdown-menu{margin-top:-1px;border-top-left-radius:0;border-top-right-radius:0}.navbar{position:relative;min-height:50px;margin-bottom:20px;border:1px solid transparent}@media (min-width:768px){.navbar{border-radius:4px}}@media (min-width:768px){.navbar-header{float:left}}.navbar-collapse{padding-right:15px;padding-left:15px;overflow-x:visible;-webkit-overflow-scrolling:touch;border-top:1px solid transparent;-webkit-box-shadow:inset 0 1px 0 rgba(255,255,255,.1);box-shadow:inset 0 1px 0 rgba(255,255,255,.1)}.navbar-collapse.in{overflow-y:auto}@media (min-width:768px){.navbar-collapse{width:auto;border-top:0;-webkit-box-shadow:none;box-shadow:none}.navbar-collapse.collapse{display:block!important;height:auto!important;padding-bottom:0;overflow:visible!important}.navbar-collapse.in{overflow-y:visible}.navbar-fixed-bottom .navbar-collapse,.navbar-fixed-top .navbar-collapse,.navbar-static-top .navbar-collapse{padding-right:0;padding-left:0}}.navbar-fixed-bottom .navbar-collapse,.navbar-fixed-top .navbar-collapse{max-height:340px}@media (max-device-width:480px) and (orientation:landscape){.navbar-fixed-bottom .navbar-collapse,.navbar-fixed-top .navbar-collapse{max-height:200px}}.container-fluid>.navbar-collapse,.container-fluid>.navbar-header,.container>.navbar-collapse,.container>.navbar-header{margin-right:-15px;margin-left:-15px}@media (min-width:768px){.container-fluid>.navbar-collapse,.container-fluid>.navbar-header,.container>.navbar-collapse,.container>.navbar-header{margin-right:0;margin-left:0}}.navbar-static-top{z-index:1000;border-width:0 0 1px}@media (min-width:768px){.navbar-static-top{border-radius:0}}.navbar-fixed-bottom,.navbar-fixed-top{position:fixed;right:0;left:0;z-index:1030}@media (min-width:768px){.navbar-fixed-bottom,.navbar-fixed-top{border-radius:0}}.navbar-fixed-top{top:0;border-width:0 0 1px}.navbar-fixed-bottom{bottom:0;margin-bottom:0;border-width:1px 0 0}.navbar-brand{float:left;height:50px;padding:15px 15px;font-size:18px;line-height:20px}.navbar-brand:focus,.navbar-brand:hover{text-decoration:none}.navbar-brand>img{display:block}@media (min-width:768px){.navbar>.container .navbar-brand,.navbar>.container-fluid .navbar-brand{margin-left:-15px}}.navbar-toggle{position:relative;float:right;padding:9px 10px;margin-top:8px;margin-right:15px;margin-bottom:8px;background-color:transparent;background-image:none;border:1px solid transparent;border-radius:4px}.navbar-toggle:focus{outline:0}.navbar-toggle .icon-bar{display:block;width:22px;height:2px;border-radius:1px}.navbar-toggle .icon-bar+.icon-bar{margin-top:4px}@media (min-width:768px){.navbar-toggle{display:none}}.navbar-nav{margin:7.5px -15px}.navbar-nav>li>a{padding-top:10px;padding-bottom:10px;line-height:20px}@media (max-width:767px){.navbar-nav .open .dropdown-menu{position:static;float:none;width:auto;margin-top:0;background-color:transparent;border:0;-webkit-box-shadow:none;box-shadow:none}.navbar-nav .open .dropdown-menu .dropdown-header,.navbar-nav .open .dropdown-menu>li>a{padding:5px 15px 5px 25px}.navbar-nav .open .dropdown-menu>li>a{line-height:20px}.navbar-nav .open .dropdown-menu>li>a:focus,.navbar-nav .open .dropdown-menu>li>a:hover{background-image:none}}@media (min-width:768px){.navbar-nav{float:left;margin:0}.navbar-nav>li{float:left}.navbar-nav>li>a{padding-top:15px;padding-bottom:15px}}.navbar-form{padding:10px 15px;margin-top:8px;margin-right:-15px;margin-bottom:8px;margin-left:-15px;border-top:1px solid transparent;border-bottom:1px solid transparent;-webkit-box-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 1px 0 rgba(255,255,255,.1);box-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 1px 0 rgba(255,255,255,.1)}@media (min-width:768px){.navbar-form .form-group{display:inline-block;margin-bottom:0;vertical-align:middle}.navbar-form .form-control{display:inline-block;width:auto;vertical-align:middle}.navbar-form .form-control-static{display:inline-block}.navbar-form .input-group{display:inline-table;vertical-align:middle}.navbar-form .input-group .form-control,.navbar-form .input-group .input-group-addon,.navbar-form .input-group .input-group-btn{width:auto}.navbar-form .input-group>.form-control{width:100%}.navbar-form .control-label{margin-bottom:0;vertical-align:middle}.navbar-form .checkbox,.navbar-form .radio{display:inline-block;margin-top:0;margin-bottom:0;vertical-align:middle}.navbar-form .checkbox label,.navbar-form .radio label{padding-left:0}.navbar-form .checkbox input[type=checkbox],.navbar-form .radio input[type=radio]{position:relative;margin-left:0}.navbar-form .has-feedback .form-control-feedback{top:0}}@media (max-width:767px){.navbar-form .form-group{margin-bottom:5px}.navbar-form .form-group:last-child{margin-bottom:0}}@media (min-width:768px){.navbar-form{width:auto;padding-top:0;padding-bottom:0;margin-right:0;margin-left:0;border:0;-webkit-box-shadow:none;box-shadow:none}}.navbar-nav>li>.dropdown-menu{margin-top:0;border-top-left-radius:0;border-top-right-radius:0}.navbar-fixed-bottom .navbar-nav>li>.dropdown-menu{margin-bottom:0;border-top-left-radius:4px;border-top-right-radius:4px;border-bottom-right-radius:0;border-bottom-left-radius:0}.navbar-btn{margin-top:8px;margin-bottom:8px}.navbar-btn.btn-sm{margin-top:10px;margin-bottom:10px}.navbar-btn.btn-xs{margin-top:14px;margin-bottom:14px}.navbar-text{margin-top:15px;margin-bottom:15px}@media (min-width:768px){.navbar-text{float:left;margin-right:15px;margin-left:15px}}@media (min-width:768px){.navbar-left{float:left!important}.navbar-right{float:right!important;margin-right:-15px}.navbar-right~.navbar-right{margin-right:0}}.navbar-default{background-color:#f8f8f8;border-color:#e7e7e7}.navbar-default .navbar-brand{color:#777}.navbar-default .navbar-brand:focus,.navbar-default .navbar-brand:hover{color:#5e5e5e;background-color:transparent}.navbar-default .navbar-text{color:#777}.navbar-default .navbar-nav>li>a{color:#777}.navbar-default .navbar-nav>li>a:focus,.navbar-default .navbar-nav>li>a:hover{color:#333;background-color:transparent}.navbar-default .navbar-nav>.active>a,.navbar-default .navbar-nav>.active>a:focus,.navbar-default .navbar-nav>.active>a:hover{color:#555;background-color:#e7e7e7}.navbar-default .navbar-nav>.disabled>a,.navbar-default .navbar-nav>.disabled>a:focus,.navbar-default .navbar-nav>.disabled>a:hover{color:#ccc;background-color:transparent}.navbar-default .navbar-toggle{border-color:#ddd}.navbar-default .navbar-toggle:focus,.navbar-default .navbar-toggle:hover{background-color:#ddd}.navbar-default .navbar-toggle .icon-bar{background-color:#888}.navbar-default .navbar-collapse,.navbar-default .navbar-form{border-color:#e7e7e7}.navbar-default .navbar-nav>.open>a,.navbar-default .navbar-nav>.open>a:focus,.navbar-default .navbar-nav>.open>a:hover{color:#555;background-color:#e7e7e7}@media (max-width:767px){.navbar-default .navbar-nav .open .dropdown-menu>li>a{color:#777}.navbar-default .navbar-nav .open .dropdown-menu>li>a:focus,.navbar-default .navbar-nav .open .dropdown-menu>li>a:hover{color:#333;background-color:transparent}.navbar-default .navbar-nav .open .dropdown-menu>.active>a,.navbar-default .navbar-nav .open .dropdown-menu>.active>a:focus,.navbar-default .navbar-nav .open .dropdown-menu>.active>a:hover{color:#555;background-color:#e7e7e7}.navbar-default .navbar-nav .open .dropdown-menu>.disabled>a,.navbar-default .navbar-nav .open .dropdown-menu>.disabled>a:focus,.navbar-default .navbar-nav .open .dropdown-menu>.disabled>a:hover{color:#ccc;background-color:transparent}}.navbar-default .navbar-link{color:#777}.navbar-default .navbar-link:hover{color:#333}.navbar-default .btn-link{color:#777}.navbar-default .btn-link:focus,.navbar-default .btn-link:hover{color:#333}.navbar-default .btn-link[disabled]:focus,.navbar-default .btn-link[disabled]:hover,fieldset[disabled] .navbar-default .btn-link:focus,fieldset[disabled] .navbar-default .btn-link:hover{color:#ccc}.navbar-inverse{background-color:#222;border-color:#080808}.navbar-inverse .navbar-brand{color:#9d9d9d}.navbar-inverse .navbar-brand:focus,.navbar-inverse .navbar-brand:hover{color:#fff;background-color:transparent}.navbar-inverse .navbar-text{color:#9d9d9d}.navbar-inverse .navbar-nav>li>a{color:#9d9d9d}.navbar-inverse .navbar-nav>li>a:focus,.navbar-inverse .navbar-nav>li>a:hover{color:#fff;background-color:transparent}.navbar-inverse .navbar-nav>.active>a,.navbar-inverse .navbar-nav>.active>a:focus,.navbar-inverse .navbar-nav>.active>a:hover{color:#fff;background-color:#080808}.navbar-inverse .navbar-nav>.disabled>a,.navbar-inverse .navbar-nav>.disabled>a:focus,.navbar-inverse .navbar-nav>.disabled>a:hover{color:#444;background-color:transparent}.navbar-inverse .navbar-toggle{border-color:#333}.navbar-inverse .navbar-toggle:focus,.navbar-inverse .navbar-toggle:hover{background-color:#333}.navbar-inverse .navbar-toggle .icon-bar{background-color:#fff}.navbar-inverse .navbar-collapse,.navbar-inverse .navbar-form{border-color:#101010}.navbar-inverse .navbar-nav>.open>a,.navbar-inverse .navbar-nav>.open>a:focus,.navbar-inverse .navbar-nav>.open>a:hover{color:#fff;background-color:#080808}@media (max-width:767px){.navbar-inverse .navbar-nav .open .dropdown-menu>.dropdown-header{border-color:#080808}.navbar-inverse .navbar-nav .open .dropdown-menu .divider{background-color:#080808}.navbar-inverse .navbar-nav .open .dropdown-menu>li>a{color:#9d9d9d}.navbar-inverse .navbar-nav .open .dropdown-menu>li>a:focus,.navbar-inverse .navbar-nav .open .dropdown-menu>li>a:hover{color:#fff;background-color:transparent}.navbar-inverse .navbar-nav .open .dropdown-menu>.active>a,.navbar-inverse .navbar-nav .open .dropdown-menu>.active>a:focus,.navbar-inverse .navbar-nav .open .dropdown-menu>.active>a:hover{color:#fff;background-color:#080808}.navbar-inverse .navbar-nav .open .dropdown-menu>.disabled>a,.navbar-inverse .navbar-nav .open .dropdown-menu>.disabled>a:focus,.navbar-inverse .navbar-nav .open .dropdown-menu>.disabled>a:hover{color:#444;background-color:transparent}}.navbar-inverse .navbar-link{color:#9d9d9d}.navbar-inverse .navbar-link:hover{color:#fff}.navbar-inverse .btn-link{color:#9d9d9d}.navbar-inverse .btn-link:focus,.navbar-inverse .btn-link:hover{color:#fff}.navbar-inverse .btn-link[disabled]:focus,.navbar-inverse .btn-link[disabled]:hover,fieldset[disabled] .navbar-inverse .btn-link:focus,fieldset[disabled] .navbar-inverse .btn-link:hover{color:#444}.breadcrumb{padding:8px 15px;margin-bottom:20px;list-style:none;background-color:#f5f5f5;border-radius:4px}.breadcrumb>li{display:inline-block}.breadcrumb>li+li:before{padding:0 5px;color:#ccc;content:\"/\\00a0\"}.breadcrumb>.active{color:#777}.pagination{display:inline-block;padding-left:0;margin:20px 0;border-radius:4px}.pagination>li{display:inline}.pagination>li>a,.pagination>li>span{position:relative;float:left;padding:6px 12px;margin-left:-1px;line-height:1.42857143;color:#337ab7;text-decoration:none;background-color:#fff;border:1px solid #ddd}.pagination>li:first-child>a,.pagination>li:first-child>span{margin-left:0;border-top-left-radius:4px;border-bottom-left-radius:4px}.pagination>li:last-child>a,.pagination>li:last-child>span{border-top-right-radius:4px;border-bottom-right-radius:4px}.pagination>li>a:focus,.pagination>li>a:hover,.pagination>li>span:focus,.pagination>li>span:hover{z-index:3;color:#23527c;background-color:#eee;border-color:#ddd}.pagination>.active>a,.pagination>.active>a:focus,.pagination>.active>a:hover,.pagination>.active>span,.pagination>.active>span:focus,.pagination>.active>span:hover{z-index:2;color:#fff;cursor:default;background-color:#337ab7;border-color:#337ab7}.pagination>.disabled>a,.pagination>.disabled>a:focus,.pagination>.disabled>a:hover,.pagination>.disabled>span,.pagination>.disabled>span:focus,.pagination>.disabled>span:hover{color:#777;cursor:not-allowed;background-color:#fff;border-color:#ddd}.pagination-lg>li>a,.pagination-lg>li>span{padding:10px 16px;font-size:18px;line-height:1.3333333}.pagination-lg>li:first-child>a,.pagination-lg>li:first-child>span{border-top-left-radius:6px;border-bottom-left-radius:6px}.pagination-lg>li:last-child>a,.pagination-lg>li:last-child>span{border-top-right-radius:6px;border-bottom-right-radius:6px}.pagination-sm>li>a,.pagination-sm>li>span{padding:5px 10px;font-size:12px;line-height:1.5}.pagination-sm>li:first-child>a,.pagination-sm>li:first-child>span{border-top-left-radius:3px;border-bottom-left-radius:3px}.pagination-sm>li:last-child>a,.pagination-sm>li:last-child>span{border-top-right-radius:3px;border-bottom-right-radius:3px}.pager{padding-left:0;margin:20px 0;text-align:center;list-style:none}.pager li{display:inline}.pager li>a,.pager li>span{display:inline-block;padding:5px 14px;background-color:#fff;border:1px solid #ddd;border-radius:15px}.pager li>a:focus,.pager li>a:hover{text-decoration:none;background-color:#eee}.pager .next>a,.pager .next>span{float:right}.pager .previous>a,.pager .previous>span{float:left}.pager .disabled>a,.pager .disabled>a:focus,.pager .disabled>a:hover,.pager .disabled>span{color:#777;cursor:not-allowed;background-color:#fff}.label{display:inline;padding:.2em .6em .3em;font-size:75%;font-weight:700;line-height:1;color:#fff;text-align:center;white-space:nowrap;vertical-align:baseline;border-radius:.25em}a.label:focus,a.label:hover{color:#fff;text-decoration:none;cursor:pointer}.label:empty{display:none}.btn .label{position:relative;top:-1px}.label-default{background-color:#777}.label-default[href]:focus,.label-default[href]:hover{background-color:#5e5e5e}.label-primary{background-color:#337ab7}.label-primary[href]:focus,.label-primary[href]:hover{background-color:#286090}.label-success{background-color:#5cb85c}.label-success[href]:focus,.label-success[href]:hover{background-color:#449d44}.label-info{background-color:#5bc0de}.label-info[href]:focus,.label-info[href]:hover{background-color:#31b0d5}.label-warning{background-color:#f0ad4e}.label-warning[href]:focus,.label-warning[href]:hover{background-color:#ec971f}.label-danger{background-color:#d9534f}.label-danger[href]:focus,.label-danger[href]:hover{background-color:#c9302c}.badge{display:inline-block;min-width:10px;padding:3px 7px;font-size:12px;font-weight:700;line-height:1;color:#fff;text-align:center;white-space:nowrap;vertical-align:middle;background-color:#777;border-radius:10px}.badge:empty{display:none}.btn .badge{position:relative;top:-1px}.btn-group-xs>.btn .badge,.btn-xs .badge{top:0;padding:1px 5px}a.badge:focus,a.badge:hover{color:#fff;text-decoration:none;cursor:pointer}.list-group-item.active>.badge,.nav-pills>.active>a>.badge{color:#337ab7;background-color:#fff}.list-group-item>.badge{float:right}.list-group-item>.badge+.badge{margin-right:5px}.nav-pills>li>a>.badge{margin-left:3px}.jumbotron{padding-top:30px;padding-bottom:30px;margin-bottom:30px;color:inherit;background-color:#eee}.jumbotron .h1,.jumbotron h1{color:inherit}.jumbotron p{margin-bottom:15px;font-size:21px;font-weight:200}.jumbotron>hr{border-top-color:#d5d5d5}.container .jumbotron,.container-fluid .jumbotron{border-radius:6px}.jumbotron .container{max-width:100%}@media screen and (min-width:768px){.jumbotron{padding-top:48px;padding-bottom:48px}.container .jumbotron,.container-fluid .jumbotron{padding-right:60px;padding-left:60px}.jumbotron .h1,.jumbotron h1{font-size:63px}}.thumbnail{display:block;padding:4px;margin-bottom:20px;line-height:1.42857143;background-color:#fff;border:1px solid #ddd;border-radius:4px;-webkit-transition:border .2s ease-in-out;-o-transition:border .2s ease-in-out;transition:border .2s ease-in-out}.thumbnail a>img,.thumbnail>img{margin-right:auto;margin-left:auto}a.thumbnail.active,a.thumbnail:focus,a.thumbnail:hover{border-color:#337ab7}.thumbnail .caption{padding:9px;color:#333}.alert{padding:15px;margin-bottom:20px;border:1px solid transparent;border-radius:4px}.alert h4{margin-top:0;color:inherit}.alert .alert-link{font-weight:700}.alert>p,.alert>ul{margin-bottom:0}.alert>p+p{margin-top:5px}.alert-dismissable,.alert-dismissible{padding-right:35px}.alert-dismissable .close,.alert-dismissible .close{position:relative;top:-2px;right:-21px;color:inherit}.alert-success{color:#3c763d;background-color:#dff0d8;border-color:#d6e9c6}.alert-success hr{border-top-color:#c9e2b3}.alert-success .alert-link{color:#2b542c}.alert-info{color:#31708f;background-color:#d9edf7;border-color:#bce8f1}.alert-info hr{border-top-color:#a6e1ec}.alert-info .alert-link{color:#245269}.alert-warning{color:#8a6d3b;background-color:#fcf8e3;border-color:#faebcc}.alert-warning hr{border-top-color:#f7e1b5}.alert-warning .alert-link{color:#66512c}.alert-danger{color:#a94442;background-color:#f2dede;border-color:#ebccd1}.alert-danger hr{border-top-color:#e4b9c0}.alert-danger .alert-link{color:#843534}@-webkit-keyframes progress-bar-stripes{from{background-position:40px 0}to{background-position:0 0}}@-o-keyframes progress-bar-stripes{from{background-position:40px 0}to{background-position:0 0}}@keyframes progress-bar-stripes{from{background-position:40px 0}to{background-position:0 0}}.progress{height:20px;margin-bottom:20px;overflow:hidden;background-color:#f5f5f5;border-radius:4px;-webkit-box-shadow:inset 0 1px 2px rgba(0,0,0,.1);box-shadow:inset 0 1px 2px rgba(0,0,0,.1)}.progress-bar{float:left;width:0;height:100%;font-size:12px;line-height:20px;color:#fff;text-align:center;background-color:#337ab7;-webkit-box-shadow:inset 0 -1px 0 rgba(0,0,0,.15);box-shadow:inset 0 -1px 0 rgba(0,0,0,.15);-webkit-transition:width .6s ease;-o-transition:width .6s ease;transition:width .6s ease}.progress-bar-striped,.progress-striped .progress-bar{background-image:-webkit-linear-gradient(45deg,rgba(255,255,255,.15) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.15) 50%,rgba(255,255,255,.15) 75%,transparent 75%,transparent);background-image:-o-linear-gradient(45deg,rgba(255,255,255,.15) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.15) 50%,rgba(255,255,255,.15) 75%,transparent 75%,transparent);background-image:linear-gradient(45deg,rgba(255,255,255,.15) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.15) 50%,rgba(255,255,255,.15) 75%,transparent 75%,transparent);-webkit-background-size:40px 40px;background-size:40px 40px}.progress-bar.active,.progress.active .progress-bar{-webkit-animation:progress-bar-stripes 2s linear infinite;-o-animation:progress-bar-stripes 2s linear infinite;animation:progress-bar-stripes 2s linear infinite}.progress-bar-success{background-color:#5cb85c}.progress-striped .progress-bar-success{background-image:-webkit-linear-gradient(45deg,rgba(255,255,255,.15) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.15) 50%,rgba(255,255,255,.15) 75%,transparent 75%,transparent);background-image:-o-linear-gradient(45deg,rgba(255,255,255,.15) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.15) 50%,rgba(255,255,255,.15) 75%,transparent 75%,transparent);background-image:linear-gradient(45deg,rgba(255,255,255,.15) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.15) 50%,rgba(255,255,255,.15) 75%,transparent 75%,transparent)}.progress-bar-info{background-color:#5bc0de}.progress-striped .progress-bar-info{background-image:-webkit-linear-gradient(45deg,rgba(255,255,255,.15) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.15) 50%,rgba(255,255,255,.15) 75%,transparent 75%,transparent);background-image:-o-linear-gradient(45deg,rgba(255,255,255,.15) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.15) 50%,rgba(255,255,255,.15) 75%,transparent 75%,transparent);background-image:linear-gradient(45deg,rgba(255,255,255,.15) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.15) 50%,rgba(255,255,255,.15) 75%,transparent 75%,transparent)}.progress-bar-warning{background-color:#f0ad4e}.progress-striped .progress-bar-warning{background-image:-webkit-linear-gradient(45deg,rgba(255,255,255,.15) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.15) 50%,rgba(255,255,255,.15) 75%,transparent 75%,transparent);background-image:-o-linear-gradient(45deg,rgba(255,255,255,.15) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.15) 50%,rgba(255,255,255,.15) 75%,transparent 75%,transparent);background-image:linear-gradient(45deg,rgba(255,255,255,.15) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.15) 50%,rgba(255,255,255,.15) 75%,transparent 75%,transparent)}.progress-bar-danger{background-color:#d9534f}.progress-striped .progress-bar-danger{background-image:-webkit-linear-gradient(45deg,rgba(255,255,255,.15) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.15) 50%,rgba(255,255,255,.15) 75%,transparent 75%,transparent);background-image:-o-linear-gradient(45deg,rgba(255,255,255,.15) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.15) 50%,rgba(255,255,255,.15) 75%,transparent 75%,transparent);background-image:linear-gradient(45deg,rgba(255,255,255,.15) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.15) 50%,rgba(255,255,255,.15) 75%,transparent 75%,transparent)}.media{margin-top:15px}.media:first-child{margin-top:0}.media,.media-body{overflow:hidden;zoom:1}.media-body{width:10000px}.media-object{display:block}.media-object.img-thumbnail{max-width:none}.media-right,.media>.pull-right{padding-left:10px}.media-left,.media>.pull-left{padding-right:10px}.media-body,.media-left,.media-right{display:table-cell;vertical-align:top}.media-middle{vertical-align:middle}.media-bottom{vertical-align:bottom}.media-heading{margin-top:0;margin-bottom:5px}.media-list{padding-left:0;list-style:none}.list-group{padding-left:0;margin-bottom:20px}.list-group-item{position:relative;display:block;padding:10px 15px;margin-bottom:-1px;background-color:#fff;border:1px solid #ddd}.list-group-item:first-child{border-top-left-radius:4px;border-top-right-radius:4px}.list-group-item:last-child{margin-bottom:0;border-bottom-right-radius:4px;border-bottom-left-radius:4px}a.list-group-item,button.list-group-item{color:#555}a.list-group-item .list-group-item-heading,button.list-group-item .list-group-item-heading{color:#333}a.list-group-item:focus,a.list-group-item:hover,button.list-group-item:focus,button.list-group-item:hover{color:#555;text-decoration:none;background-color:#f5f5f5}button.list-group-item{width:100%;text-align:left}.list-group-item.disabled,.list-group-item.disabled:focus,.list-group-item.disabled:hover{color:#777;cursor:not-allowed;background-color:#eee}.list-group-item.disabled .list-group-item-heading,.list-group-item.disabled:focus .list-group-item-heading,.list-group-item.disabled:hover .list-group-item-heading{color:inherit}.list-group-item.disabled .list-group-item-text,.list-group-item.disabled:focus .list-group-item-text,.list-group-item.disabled:hover .list-group-item-text{color:#777}.list-group-item.active,.list-group-item.active:focus,.list-group-item.active:hover{z-index:2;color:#fff;background-color:#337ab7;border-color:#337ab7}.list-group-item.active .list-group-item-heading,.list-group-item.active .list-group-item-heading>.small,.list-group-item.active .list-group-item-heading>small,.list-group-item.active:focus .list-group-item-heading,.list-group-item.active:focus .list-group-item-heading>.small,.list-group-item.active:focus .list-group-item-heading>small,.list-group-item.active:hover .list-group-item-heading,.list-group-item.active:hover .list-group-item-heading>.small,.list-group-item.active:hover .list-group-item-heading>small{color:inherit}.list-group-item.active .list-group-item-text,.list-group-item.active:focus .list-group-item-text,.list-group-item.active:hover .list-group-item-text{color:#c7ddef}.list-group-item-success{color:#3c763d;background-color:#dff0d8}a.list-group-item-success,button.list-group-item-success{color:#3c763d}a.list-group-item-success .list-group-item-heading,button.list-group-item-success .list-group-item-heading{color:inherit}a.list-group-item-success:focus,a.list-group-item-success:hover,button.list-group-item-success:focus,button.list-group-item-success:hover{color:#3c763d;background-color:#d0e9c6}a.list-group-item-success.active,a.list-group-item-success.active:focus,a.list-group-item-success.active:hover,button.list-group-item-success.active,button.list-group-item-success.active:focus,button.list-group-item-success.active:hover{color:#fff;background-color:#3c763d;border-color:#3c763d}.list-group-item-info{color:#31708f;background-color:#d9edf7}a.list-group-item-info,button.list-group-item-info{color:#31708f}a.list-group-item-info .list-group-item-heading,button.list-group-item-info .list-group-item-heading{color:inherit}a.list-group-item-info:focus,a.list-group-item-info:hover,button.list-group-item-info:focus,button.list-group-item-info:hover{color:#31708f;background-color:#c4e3f3}a.list-group-item-info.active,a.list-group-item-info.active:focus,a.list-group-item-info.active:hover,button.list-group-item-info.active,button.list-group-item-info.active:focus,button.list-group-item-info.active:hover{color:#fff;background-color:#31708f;border-color:#31708f}.list-group-item-warning{color:#8a6d3b;background-color:#fcf8e3}a.list-group-item-warning,button.list-group-item-warning{color:#8a6d3b}a.list-group-item-warning .list-group-item-heading,button.list-group-item-warning .list-group-item-heading{color:inherit}a.list-group-item-warning:focus,a.list-group-item-warning:hover,button.list-group-item-warning:focus,button.list-group-item-warning:hover{color:#8a6d3b;background-color:#faf2cc}a.list-group-item-warning.active,a.list-group-item-warning.active:focus,a.list-group-item-warning.active:hover,button.list-group-item-warning.active,button.list-group-item-warning.active:focus,button.list-group-item-warning.active:hover{color:#fff;background-color:#8a6d3b;border-color:#8a6d3b}.list-group-item-danger{color:#a94442;background-color:#f2dede}a.list-group-item-danger,button.list-group-item-danger{color:#a94442}a.list-group-item-danger .list-group-item-heading,button.list-group-item-danger .list-group-item-heading{color:inherit}a.list-group-item-danger:focus,a.list-group-item-danger:hover,button.list-group-item-danger:focus,button.list-group-item-danger:hover{color:#a94442;background-color:#ebcccc}a.list-group-item-danger.active,a.list-group-item-danger.active:focus,a.list-group-item-danger.active:hover,button.list-group-item-danger.active,button.list-group-item-danger.active:focus,button.list-group-item-danger.active:hover{color:#fff;background-color:#a94442;border-color:#a94442}.list-group-item-heading{margin-top:0;margin-bottom:5px}.list-group-item-text{margin-bottom:0;line-height:1.3}.panel{margin-bottom:20px;background-color:#fff;border:1px solid transparent;border-radius:4px;-webkit-box-shadow:0 1px 1px rgba(0,0,0,.05);box-shadow:0 1px 1px rgba(0,0,0,.05)}.panel-body{padding:15px}.panel-heading{padding:10px 15px;border-bottom:1px solid transparent;border-top-left-radius:3px;border-top-right-radius:3px}.panel-heading>.dropdown .dropdown-toggle{color:inherit}.panel-title{margin-top:0;margin-bottom:0;font-size:16px;color:inherit}.panel-title>.small,.panel-title>.small>a,.panel-title>a,.panel-title>small,.panel-title>small>a{color:inherit}.panel-footer{padding:10px 15px;background-color:#f5f5f5;border-top:1px solid #ddd;border-bottom-right-radius:3px;border-bottom-left-radius:3px}.panel>.list-group,.panel>.panel-collapse>.list-group{margin-bottom:0}.panel>.list-group .list-group-item,.panel>.panel-collapse>.list-group .list-group-item{border-width:1px 0;border-radius:0}.panel>.list-group:first-child .list-group-item:first-child,.panel>.panel-collapse>.list-group:first-child .list-group-item:first-child{border-top:0;border-top-left-radius:3px;border-top-right-radius:3px}.panel>.list-group:last-child .list-group-item:last-child,.panel>.panel-collapse>.list-group:last-child .list-group-item:last-child{border-bottom:0;border-bottom-right-radius:3px;border-bottom-left-radius:3px}.panel>.panel-heading+.panel-collapse>.list-group .list-group-item:first-child{border-top-left-radius:0;border-top-right-radius:0}.panel-heading+.list-group .list-group-item:first-child{border-top-width:0}.list-group+.panel-footer{border-top-width:0}.panel>.panel-collapse>.table,.panel>.table,.panel>.table-responsive>.table{margin-bottom:0}.panel>.panel-collapse>.table caption,.panel>.table caption,.panel>.table-responsive>.table caption{padding-right:15px;padding-left:15px}.panel>.table-responsive:first-child>.table:first-child,.panel>.table:first-child{border-top-left-radius:3px;border-top-right-radius:3px}.panel>.table-responsive:first-child>.table:first-child>tbody:first-child>tr:first-child,.panel>.table-responsive:first-child>.table:first-child>thead:first-child>tr:first-child,.panel>.table:first-child>tbody:first-child>tr:first-child,.panel>.table:first-child>thead:first-child>tr:first-child{border-top-left-radius:3px;border-top-right-radius:3px}.panel>.table-responsive:first-child>.table:first-child>tbody:first-child>tr:first-child td:first-child,.panel>.table-responsive:first-child>.table:first-child>tbody:first-child>tr:first-child th:first-child,.panel>.table-responsive:first-child>.table:first-child>thead:first-child>tr:first-child td:first-child,.panel>.table-responsive:first-child>.table:first-child>thead:first-child>tr:first-child th:first-child,.panel>.table:first-child>tbody:first-child>tr:first-child td:first-child,.panel>.table:first-child>tbody:first-child>tr:first-child th:first-child,.panel>.table:first-child>thead:first-child>tr:first-child td:first-child,.panel>.table:first-child>thead:first-child>tr:first-child th:first-child{border-top-left-radius:3px}.panel>.table-responsive:first-child>.table:first-child>tbody:first-child>tr:first-child td:last-child,.panel>.table-responsive:first-child>.table:first-child>tbody:first-child>tr:first-child th:last-child,.panel>.table-responsive:first-child>.table:first-child>thead:first-child>tr:first-child td:last-child,.panel>.table-responsive:first-child>.table:first-child>thead:first-child>tr:first-child th:last-child,.panel>.table:first-child>tbody:first-child>tr:first-child td:last-child,.panel>.table:first-child>tbody:first-child>tr:first-child th:last-child,.panel>.table:first-child>thead:first-child>tr:first-child td:last-child,.panel>.table:first-child>thead:first-child>tr:first-child th:last-child{border-top-right-radius:3px}.panel>.table-responsive:last-child>.table:last-child,.panel>.table:last-child{border-bottom-right-radius:3px;border-bottom-left-radius:3px}.panel>.table-responsive:last-child>.table:last-child>tbody:last-child>tr:last-child,.panel>.table-responsive:last-child>.table:last-child>tfoot:last-child>tr:last-child,.panel>.table:last-child>tbody:last-child>tr:last-child,.panel>.table:last-child>tfoot:last-child>tr:last-child{border-bottom-right-radius:3px;border-bottom-left-radius:3px}.panel>.table-responsive:last-child>.table:last-child>tbody:last-child>tr:last-child td:first-child,.panel>.table-responsive:last-child>.table:last-child>tbody:last-child>tr:last-child th:first-child,.panel>.table-responsive:last-child>.table:last-child>tfoot:last-child>tr:last-child td:first-child,.panel>.table-responsive:last-child>.table:last-child>tfoot:last-child>tr:last-child th:first-child,.panel>.table:last-child>tbody:last-child>tr:last-child td:first-child,.panel>.table:last-child>tbody:last-child>tr:last-child th:first-child,.panel>.table:last-child>tfoot:last-child>tr:last-child td:first-child,.panel>.table:last-child>tfoot:last-child>tr:last-child th:first-child{border-bottom-left-radius:3px}.panel>.table-responsive:last-child>.table:last-child>tbody:last-child>tr:last-child td:last-child,.panel>.table-responsive:last-child>.table:last-child>tbody:last-child>tr:last-child th:last-child,.panel>.table-responsive:last-child>.table:last-child>tfoot:last-child>tr:last-child td:last-child,.panel>.table-responsive:last-child>.table:last-child>tfoot:last-child>tr:last-child th:last-child,.panel>.table:last-child>tbody:last-child>tr:last-child td:last-child,.panel>.table:last-child>tbody:last-child>tr:last-child th:last-child,.panel>.table:last-child>tfoot:last-child>tr:last-child td:last-child,.panel>.table:last-child>tfoot:last-child>tr:last-child th:last-child{border-bottom-right-radius:3px}.panel>.panel-body+.table,.panel>.panel-body+.table-responsive,.panel>.table+.panel-body,.panel>.table-responsive+.panel-body{border-top:1px solid #ddd}.panel>.table>tbody:first-child>tr:first-child td,.panel>.table>tbody:first-child>tr:first-child th{border-top:0}.panel>.table-bordered,.panel>.table-responsive>.table-bordered{border:0}.panel>.table-bordered>tbody>tr>td:first-child,.panel>.table-bordered>tbody>tr>th:first-child,.panel>.table-bordered>tfoot>tr>td:first-child,.panel>.table-bordered>tfoot>tr>th:first-child,.panel>.table-bordered>thead>tr>td:first-child,.panel>.table-bordered>thead>tr>th:first-child,.panel>.table-responsive>.table-bordered>tbody>tr>td:first-child,.panel>.table-responsive>.table-bordered>tbody>tr>th:first-child,.panel>.table-responsive>.table-bordered>tfoot>tr>td:first-child,.panel>.table-responsive>.table-bordered>tfoot>tr>th:first-child,.panel>.table-responsive>.table-bordered>thead>tr>td:first-child,.panel>.table-responsive>.table-bordered>thead>tr>th:first-child{border-left:0}.panel>.table-bordered>tbody>tr>td:last-child,.panel>.table-bordered>tbody>tr>th:last-child,.panel>.table-bordered>tfoot>tr>td:last-child,.panel>.table-bordered>tfoot>tr>th:last-child,.panel>.table-bordered>thead>tr>td:last-child,.panel>.table-bordered>thead>tr>th:last-child,.panel>.table-responsive>.table-bordered>tbody>tr>td:last-child,.panel>.table-responsive>.table-bordered>tbody>tr>th:last-child,.panel>.table-responsive>.table-bordered>tfoot>tr>td:last-child,.panel>.table-responsive>.table-bordered>tfoot>tr>th:last-child,.panel>.table-responsive>.table-bordered>thead>tr>td:last-child,.panel>.table-responsive>.table-bordered>thead>tr>th:last-child{border-right:0}.panel>.table-bordered>tbody>tr:first-child>td,.panel>.table-bordered>tbody>tr:first-child>th,.panel>.table-bordered>thead>tr:first-child>td,.panel>.table-bordered>thead>tr:first-child>th,.panel>.table-responsive>.table-bordered>tbody>tr:first-child>td,.panel>.table-responsive>.table-bordered>tbody>tr:first-child>th,.panel>.table-responsive>.table-bordered>thead>tr:first-child>td,.panel>.table-responsive>.table-bordered>thead>tr:first-child>th{border-bottom:0}.panel>.table-bordered>tbody>tr:last-child>td,.panel>.table-bordered>tbody>tr:last-child>th,.panel>.table-bordered>tfoot>tr:last-child>td,.panel>.table-bordered>tfoot>tr:last-child>th,.panel>.table-responsive>.table-bordered>tbody>tr:last-child>td,.panel>.table-responsive>.table-bordered>tbody>tr:last-child>th,.panel>.table-responsive>.table-bordered>tfoot>tr:last-child>td,.panel>.table-responsive>.table-bordered>tfoot>tr:last-child>th{border-bottom:0}.panel>.table-responsive{margin-bottom:0;border:0}.panel-group{margin-bottom:20px}.panel-group .panel{margin-bottom:0;border-radius:4px}.panel-group .panel+.panel{margin-top:5px}.panel-group .panel-heading{border-bottom:0}.panel-group .panel-heading+.panel-collapse>.list-group,.panel-group .panel-heading+.panel-collapse>.panel-body{border-top:1px solid #ddd}.panel-group .panel-footer{border-top:0}.panel-group .panel-footer+.panel-collapse .panel-body{border-bottom:1px solid #ddd}.panel-default{border-color:#ddd}.panel-default>.panel-heading{color:#333;background-color:#f5f5f5;border-color:#ddd}.panel-default>.panel-heading+.panel-collapse>.panel-body{border-top-color:#ddd}.panel-default>.panel-heading .badge{color:#f5f5f5;background-color:#333}.panel-default>.panel-footer+.panel-collapse>.panel-body{border-bottom-color:#ddd}.panel-primary{border-color:#337ab7}.panel-primary>.panel-heading{color:#fff;background-color:#337ab7;border-color:#337ab7}.panel-primary>.panel-heading+.panel-collapse>.panel-body{border-top-color:#337ab7}.panel-primary>.panel-heading .badge{color:#337ab7;background-color:#fff}.panel-primary>.panel-footer+.panel-collapse>.panel-body{border-bottom-color:#337ab7}.panel-success{border-color:#d6e9c6}.panel-success>.panel-heading{color:#3c763d;background-color:#dff0d8;border-color:#d6e9c6}.panel-success>.panel-heading+.panel-collapse>.panel-body{border-top-color:#d6e9c6}.panel-success>.panel-heading .badge{color:#dff0d8;background-color:#3c763d}.panel-success>.panel-footer+.panel-collapse>.panel-body{border-bottom-color:#d6e9c6}.panel-info{border-color:#bce8f1}.panel-info>.panel-heading{color:#31708f;background-color:#d9edf7;border-color:#bce8f1}.panel-info>.panel-heading+.panel-collapse>.panel-body{border-top-color:#bce8f1}.panel-info>.panel-heading .badge{color:#d9edf7;background-color:#31708f}.panel-info>.panel-footer+.panel-collapse>.panel-body{border-bottom-color:#bce8f1}.panel-warning{border-color:#faebcc}.panel-warning>.panel-heading{color:#8a6d3b;background-color:#fcf8e3;border-color:#faebcc}.panel-warning>.panel-heading+.panel-collapse>.panel-body{border-top-color:#faebcc}.panel-warning>.panel-heading .badge{color:#fcf8e3;background-color:#8a6d3b}.panel-warning>.panel-footer+.panel-collapse>.panel-body{border-bottom-color:#faebcc}.panel-danger{border-color:#ebccd1}.panel-danger>.panel-heading{color:#a94442;background-color:#f2dede;border-color:#ebccd1}.panel-danger>.panel-heading+.panel-collapse>.panel-body{border-top-color:#ebccd1}.panel-danger>.panel-heading .badge{color:#f2dede;background-color:#a94442}.panel-danger>.panel-footer+.panel-collapse>.panel-body{border-bottom-color:#ebccd1}.embed-responsive{position:relative;display:block;height:0;padding:0;overflow:hidden}.embed-responsive .embed-responsive-item,.embed-responsive embed,.embed-responsive iframe,.embed-responsive object,.embed-responsive video{position:absolute;top:0;bottom:0;left:0;width:100%;height:100%;border:0}.embed-responsive-16by9{padding-bottom:56.25%}.embed-responsive-4by3{padding-bottom:75%}.well{min-height:20px;padding:19px;margin-bottom:20px;background-color:#f5f5f5;border:1px solid #e3e3e3;border-radius:4px;-webkit-box-shadow:inset 0 1px 1px rgba(0,0,0,.05);box-shadow:inset 0 1px 1px rgba(0,0,0,.05)}.well blockquote{border-color:#ddd;border-color:rgba(0,0,0,.15)}.well-lg{padding:24px;border-radius:6px}.well-sm{padding:9px;border-radius:3px}.close{float:right;font-size:21px;font-weight:700;line-height:1;color:#000;text-shadow:0 1px 0 #fff;filter:alpha(opacity=20);opacity:.2}.close:focus,.close:hover{color:#000;text-decoration:none;cursor:pointer;filter:alpha(opacity=50);opacity:.5}button.close{-webkit-appearance:none;padding:0;cursor:pointer;background:0 0;border:0}.modal-open{overflow:hidden}.modal{position:fixed;top:0;right:0;bottom:0;left:0;z-index:1050;display:none;overflow:hidden;-webkit-overflow-scrolling:touch;outline:0}.modal.fade .modal-dialog{-webkit-transition:-webkit-transform .3s ease-out;-o-transition:-o-transform .3s ease-out;transition:transform .3s ease-out;-webkit-transform:translate(0,-25%);-ms-transform:translate(0,-25%);-o-transform:translate(0,-25%);transform:translate(0,-25%)}.modal.in .modal-dialog{-webkit-transform:translate(0,0);-ms-transform:translate(0,0);-o-transform:translate(0,0);transform:translate(0,0)}.modal-open .modal{overflow-x:hidden;overflow-y:auto}.modal-dialog{position:relative;width:auto;margin:10px}.modal-content{position:relative;background-color:#fff;-webkit-background-clip:padding-box;background-clip:padding-box;border:1px solid #999;border:1px solid rgba(0,0,0,.2);border-radius:6px;outline:0;-webkit-box-shadow:0 3px 9px rgba(0,0,0,.5);box-shadow:0 3px 9px rgba(0,0,0,.5)}.modal-backdrop{position:fixed;top:0;right:0;bottom:0;left:0;z-index:1040;background-color:#000}.modal-backdrop.fade{filter:alpha(opacity=0);opacity:0}.modal-backdrop.in{filter:alpha(opacity=50);opacity:.5}.modal-header{min-height:16.43px;padding:15px;border-bottom:1px solid #e5e5e5}.modal-header .close{margin-top:-2px}.modal-title{margin:0;line-height:1.42857143}.modal-body{position:relative;padding:15px}.modal-footer{padding:15px;text-align:right;border-top:1px solid #e5e5e5}.modal-footer .btn+.btn{margin-bottom:0;margin-left:5px}.modal-footer .btn-group .btn+.btn{margin-left:-1px}.modal-footer .btn-block+.btn-block{margin-left:0}.modal-scrollbar-measure{position:absolute;top:-9999px;width:50px;height:50px;overflow:scroll}@media (min-width:768px){.modal-dialog{width:600px;margin:30px auto}.modal-content{-webkit-box-shadow:0 5px 15px rgba(0,0,0,.5);box-shadow:0 5px 15px rgba(0,0,0,.5)}.modal-sm{width:300px}}@media (min-width:992px){.modal-lg{width:900px}}.tooltip{position:absolute;z-index:1070;display:block;font-family:\"Helvetica Neue\",Helvetica,Arial,sans-serif;font-size:12px;font-style:normal;font-weight:400;line-height:1.42857143;text-align:left;text-align:start;text-decoration:none;text-shadow:none;text-transform:none;letter-spacing:normal;word-break:normal;word-spacing:normal;word-wrap:normal;white-space:normal;filter:alpha(opacity=0);opacity:0;line-break:auto}.tooltip.in{filter:alpha(opacity=90);opacity:.9}.tooltip.top{padding:5px 0;margin-top:-3px}.tooltip.right{padding:0 5px;margin-left:3px}.tooltip.bottom{padding:5px 0;margin-top:3px}.tooltip.left{padding:0 5px;margin-left:-3px}.tooltip-inner{max-width:200px;padding:3px 8px;color:#fff;text-align:center;background-color:#000;border-radius:4px}.tooltip-arrow{position:absolute;width:0;height:0;border-color:transparent;border-style:solid}.tooltip.top .tooltip-arrow{bottom:0;left:50%;margin-left:-5px;border-width:5px 5px 0;border-top-color:#000}.tooltip.top-left .tooltip-arrow{right:5px;bottom:0;margin-bottom:-5px;border-width:5px 5px 0;border-top-color:#000}.tooltip.top-right .tooltip-arrow{bottom:0;left:5px;margin-bottom:-5px;border-width:5px 5px 0;border-top-color:#000}.tooltip.right .tooltip-arrow{top:50%;left:0;margin-top:-5px;border-width:5px 5px 5px 0;border-right-color:#000}.tooltip.left .tooltip-arrow{top:50%;right:0;margin-top:-5px;border-width:5px 0 5px 5px;border-left-color:#000}.tooltip.bottom .tooltip-arrow{top:0;left:50%;margin-left:-5px;border-width:0 5px 5px;border-bottom-color:#000}.tooltip.bottom-left .tooltip-arrow{top:0;right:5px;margin-top:-5px;border-width:0 5px 5px;border-bottom-color:#000}.tooltip.bottom-right .tooltip-arrow{top:0;left:5px;margin-top:-5px;border-width:0 5px 5px;border-bottom-color:#000}.popover{position:absolute;top:0;left:0;z-index:1060;display:none;max-width:276px;padding:1px;font-family:\"Helvetica Neue\",Helvetica,Arial,sans-serif;font-size:14px;font-style:normal;font-weight:400;line-height:1.42857143;text-align:left;text-align:start;text-decoration:none;text-shadow:none;text-transform:none;letter-spacing:normal;word-break:normal;word-spacing:normal;word-wrap:normal;white-space:normal;background-color:#fff;-webkit-background-clip:padding-box;background-clip:padding-box;border:1px solid #ccc;border:1px solid rgba(0,0,0,.2);border-radius:6px;-webkit-box-shadow:0 5px 10px rgba(0,0,0,.2);box-shadow:0 5px 10px rgba(0,0,0,.2);line-break:auto}.popover.top{margin-top:-10px}.popover.right{margin-left:10px}.popover.bottom{margin-top:10px}.popover.left{margin-left:-10px}.popover-title{padding:8px 14px;margin:0;font-size:14px;background-color:#f7f7f7;border-bottom:1px solid #ebebeb;border-radius:5px 5px 0 0}.popover-content{padding:9px 14px}.popover>.arrow,.popover>.arrow:after{position:absolute;display:block;width:0;height:0;border-color:transparent;border-style:solid}.popover>.arrow{border-width:11px}.popover>.arrow:after{content:\"\";border-width:10px}.popover.top>.arrow{bottom:-11px;left:50%;margin-left:-11px;border-top-color:#999;border-top-color:rgba(0,0,0,.25);border-bottom-width:0}.popover.top>.arrow:after{bottom:1px;margin-left:-10px;content:\" \";border-top-color:#fff;border-bottom-width:0}.popover.right>.arrow{top:50%;left:-11px;margin-top:-11px;border-right-color:#999;border-right-color:rgba(0,0,0,.25);border-left-width:0}.popover.right>.arrow:after{bottom:-10px;left:1px;content:\" \";border-right-color:#fff;border-left-width:0}.popover.bottom>.arrow{top:-11px;left:50%;margin-left:-11px;border-top-width:0;border-bottom-color:#999;border-bottom-color:rgba(0,0,0,.25)}.popover.bottom>.arrow:after{top:1px;margin-left:-10px;content:\" \";border-top-width:0;border-bottom-color:#fff}.popover.left>.arrow{top:50%;right:-11px;margin-top:-11px;border-right-width:0;border-left-color:#999;border-left-color:rgba(0,0,0,.25)}.popover.left>.arrow:after{right:1px;bottom:-10px;content:\" \";border-right-width:0;border-left-color:#fff}.carousel{position:relative}.carousel-inner{position:relative;width:100%;overflow:hidden}.carousel-inner>.item{position:relative;display:none;-webkit-transition:.6s ease-in-out left;-o-transition:.6s ease-in-out left;transition:.6s ease-in-out left}.carousel-inner>.item>a>img,.carousel-inner>.item>img{line-height:1}@media all and (transform-3d),(-webkit-transform-3d){.carousel-inner>.item{-webkit-transition:-webkit-transform .6s ease-in-out;-o-transition:-o-transform .6s ease-in-out;transition:transform .6s ease-in-out;-webkit-backface-visibility:hidden;backface-visibility:hidden;-webkit-perspective:1000px;perspective:1000px}.carousel-inner>.item.active.right,.carousel-inner>.item.next{left:0;-webkit-transform:translate3d(100%,0,0);transform:translate3d(100%,0,0)}.carousel-inner>.item.active.left,.carousel-inner>.item.prev{left:0;-webkit-transform:translate3d(-100%,0,0);transform:translate3d(-100%,0,0)}.carousel-inner>.item.active,.carousel-inner>.item.next.left,.carousel-inner>.item.prev.right{left:0;-webkit-transform:translate3d(0,0,0);transform:translate3d(0,0,0)}}.carousel-inner>.active,.carousel-inner>.next,.carousel-inner>.prev{display:block}.carousel-inner>.active{left:0}.carousel-inner>.next,.carousel-inner>.prev{position:absolute;top:0;width:100%}.carousel-inner>.next{left:100%}.carousel-inner>.prev{left:-100%}.carousel-inner>.next.left,.carousel-inner>.prev.right{left:0}.carousel-inner>.active.left{left:-100%}.carousel-inner>.active.right{left:100%}.carousel-control{position:absolute;top:0;bottom:0;left:0;width:15%;font-size:20px;color:#fff;text-align:center;text-shadow:0 1px 2px rgba(0,0,0,.6);filter:alpha(opacity=50);opacity:.5}.carousel-control.left{background-image:-webkit-linear-gradient(left,rgba(0,0,0,.5) 0,rgba(0,0,0,.0001) 100%);background-image:-o-linear-gradient(left,rgba(0,0,0,.5) 0,rgba(0,0,0,.0001) 100%);background-image:-webkit-gradient(linear,left top,right top,from(rgba(0,0,0,.5)),to(rgba(0,0,0,.0001)));background-image:linear-gradient(to right,rgba(0,0,0,.5) 0,rgba(0,0,0,.0001) 100%);filter:progid:DXImageTransform.Microsoft.gradient(startColorstr='#80000000', endColorstr='#00000000', GradientType=1);background-repeat:repeat-x}.carousel-control.right{right:0;left:auto;background-image:-webkit-linear-gradient(left,rgba(0,0,0,.0001) 0,rgba(0,0,0,.5) 100%);background-image:-o-linear-gradient(left,rgba(0,0,0,.0001) 0,rgba(0,0,0,.5) 100%);background-image:-webkit-gradient(linear,left top,right top,from(rgba(0,0,0,.0001)),to(rgba(0,0,0,.5)));background-image:linear-gradient(to right,rgba(0,0,0,.0001) 0,rgba(0,0,0,.5) 100%);filter:progid:DXImageTransform.Microsoft.gradient(startColorstr='#00000000', endColorstr='#80000000', GradientType=1);background-repeat:repeat-x}.carousel-control:focus,.carousel-control:hover{color:#fff;text-decoration:none;filter:alpha(opacity=90);outline:0;opacity:.9}.carousel-control .glyphicon-chevron-left,.carousel-control .glyphicon-chevron-right,.carousel-control .icon-next,.carousel-control .icon-prev{position:absolute;top:50%;z-index:5;display:inline-block;margin-top:-10px}.carousel-control .glyphicon-chevron-left,.carousel-control .icon-prev{left:50%;margin-left:-10px}.carousel-control .glyphicon-chevron-right,.carousel-control .icon-next{right:50%;margin-right:-10px}.carousel-control .icon-next,.carousel-control .icon-prev{width:20px;height:20px;font-family:serif;line-height:1}.carousel-control .icon-prev:before{content:'\\2039'}.carousel-control .icon-next:before{content:'\\203a'}.carousel-indicators{position:absolute;bottom:10px;left:50%;z-index:15;width:60%;padding-left:0;margin-left:-30%;text-align:center;list-style:none}.carousel-indicators li{display:inline-block;width:10px;height:10px;margin:1px;text-indent:-999px;cursor:pointer;background-color:#000\\9;background-color:transparent;border:1px solid #fff;border-radius:10px}.carousel-indicators .active{width:12px;height:12px;margin:0;background-color:#fff}.carousel-caption{position:absolute;right:15%;bottom:20px;left:15%;z-index:10;padding-top:20px;padding-bottom:20px;color:#fff;text-align:center;text-shadow:0 1px 2px rgba(0,0,0,.6)}.carousel-caption .btn{text-shadow:none}@media screen and (min-width:768px){.carousel-control .glyphicon-chevron-left,.carousel-control .glyphicon-chevron-right,.carousel-control .icon-next,.carousel-control .icon-prev{width:30px;height:30px;margin-top:-15px;font-size:30px}.carousel-control .glyphicon-chevron-left,.carousel-control .icon-prev{margin-left:-15px}.carousel-control .glyphicon-chevron-right,.carousel-control .icon-next{margin-right:-15px}.carousel-caption{right:20%;left:20%;padding-bottom:30px}.carousel-indicators{bottom:20px}}.btn-group-vertical>.btn-group:after,.btn-group-vertical>.btn-group:before,.btn-toolbar:after,.btn-toolbar:before,.clearfix:after,.clearfix:before,.container-fluid:after,.container-fluid:before,.container:after,.container:before,.dl-horizontal dd:after,.dl-horizontal dd:before,.form-horizontal .form-group:after,.form-horizontal .form-group:before,.modal-footer:after,.modal-footer:before,.nav:after,.nav:before,.navbar-collapse:after,.navbar-collapse:before,.navbar-header:after,.navbar-header:before,.navbar:after,.navbar:before,.pager:after,.pager:before,.panel-body:after,.panel-body:before,.row:after,.row:before{display:table;content:\" \"}.btn-group-vertical>.btn-group:after,.btn-toolbar:after,.clearfix:after,.container-fluid:after,.container:after,.dl-horizontal dd:after,.form-horizontal .form-group:after,.modal-footer:after,.nav:after,.navbar-collapse:after,.navbar-header:after,.navbar:after,.pager:after,.panel-body:after,.row:after{clear:both}.center-block{display:block;margin-right:auto;margin-left:auto}.pull-right{float:right!important}.pull-left{float:left!important}.hide{display:none!important}.show{display:block!important}.invisible{visibility:hidden}.text-hide{font:0/0 a;color:transparent;text-shadow:none;background-color:transparent;border:0}.hidden{display:none!important}.affix{position:fixed}@-ms-viewport{width:device-width}.visible-lg,.visible-md,.visible-sm,.visible-xs{display:none!important}.visible-lg-block,.visible-lg-inline,.visible-lg-inline-block,.visible-md-block,.visible-md-inline,.visible-md-inline-block,.visible-sm-block,.visible-sm-inline,.visible-sm-inline-block,.visible-xs-block,.visible-xs-inline,.visible-xs-inline-block{display:none!important}@media (max-width:767px){.visible-xs{display:block!important}table.visible-xs{display:table!important}tr.visible-xs{display:table-row!important}td.visible-xs,th.visible-xs{display:table-cell!important}}@media (max-width:767px){.visible-xs-block{display:block!important}}@media (max-width:767px){.visible-xs-inline{display:inline!important}}@media (max-width:767px){.visible-xs-inline-block{display:inline-block!important}}@media (min-width:768px) and (max-width:991px){.visible-sm{display:block!important}table.visible-sm{display:table!important}tr.visible-sm{display:table-row!important}td.visible-sm,th.visible-sm{display:table-cell!important}}@media (min-width:768px) and (max-width:991px){.visible-sm-block{display:block!important}}@media (min-width:768px) and (max-width:991px){.visible-sm-inline{display:inline!important}}@media (min-width:768px) and (max-width:991px){.visible-sm-inline-block{display:inline-block!important}}@media (min-width:992px) and (max-width:1199px){.visible-md{display:block!important}table.visible-md{display:table!important}tr.visible-md{display:table-row!important}td.visible-md,th.visible-md{display:table-cell!important}}@media (min-width:992px) and (max-width:1199px){.visible-md-block{display:block!important}}@media (min-width:992px) and (max-width:1199px){.visible-md-inline{display:inline!important}}@media (min-width:992px) and (max-width:1199px){.visible-md-inline-block{display:inline-block!important}}@media (min-width:1200px){.visible-lg{display:block!important}table.visible-lg{display:table!important}tr.visible-lg{display:table-row!important}td.visible-lg,th.visible-lg{display:table-cell!important}}@media (min-width:1200px){.visible-lg-block{display:block!important}}@media (min-width:1200px){.visible-lg-inline{display:inline!important}}@media (min-width:1200px){.visible-lg-inline-block{display:inline-block!important}}@media (max-width:767px){.hidden-xs{display:none!important}}@media (min-width:768px) and (max-width:991px){.hidden-sm{display:none!important}}@media (min-width:992px) and (max-width:1199px){.hidden-md{display:none!important}}@media (min-width:1200px){.hidden-lg{display:none!important}}.visible-print{display:none!important}@media print{.visible-print{display:block!important}table.visible-print{display:table!important}tr.visible-print{display:table-row!important}td.visible-print,th.visible-print{display:table-cell!important}}.visible-print-block{display:none!important}@media print{.visible-print-block{display:block!important}}.visible-print-inline{display:none!important}@media print{.visible-print-inline{display:inline!important}}.visible-print-inline-block{display:none!important}@media print{.visible-print-inline-block{display:inline-block!important}}@media print{.hidden-print{display:none!important}}.leaflet-image-layer,.leaflet-layer,.leaflet-map-pane,.leaflet-marker-icon,.leaflet-marker-pane,.leaflet-marker-shadow,.leaflet-overlay-pane,.leaflet-overlay-pane svg,.leaflet-popup-pane,.leaflet-shadow-pane,.leaflet-tile,.leaflet-tile-container,.leaflet-tile-pane,.leaflet-zoom-box{position:absolute;left:0;top:0}.leaflet-container{overflow:hidden;-ms-touch-action:none;touch-action:none}.leaflet-marker-icon,.leaflet-marker-shadow,.leaflet-tile{-webkit-user-select:none;-moz-user-select:none;user-select:none;-webkit-user-drag:none}.leaflet-marker-icon,.leaflet-marker-shadow{display:block}.leaflet-container img{max-width:none!important}.leaflet-container img.leaflet-image-layer{max-width:15000px!important}.leaflet-tile{filter:inherit;visibility:hidden}.leaflet-tile-loaded{visibility:inherit}.leaflet-zoom-box{width:0;height:0}.leaflet-overlay-pane svg{-moz-user-select:none}.leaflet-tile-pane{z-index:2}.leaflet-objects-pane{z-index:3}.leaflet-overlay-pane{z-index:4}.leaflet-shadow-pane{z-index:5}.leaflet-marker-pane{z-index:6}.leaflet-popup-pane{z-index:7}.leaflet-vml-shape{width:1px;height:1px}.lvml{behavior:url(#default#VML);display:inline-block;position:absolute}.leaflet-control{position:relative;z-index:7;pointer-events:auto}.leaflet-bottom,.leaflet-top{position:absolute;z-index:1000;pointer-events:none}.leaflet-top{top:0}.leaflet-right{right:0}.leaflet-bottom{bottom:0}.leaflet-left{left:0}.leaflet-control{float:left;clear:both}.leaflet-right .leaflet-control{float:right}.leaflet-top .leaflet-control{margin-top:10px}.leaflet-bottom .leaflet-control{margin-bottom:10px}.leaflet-left .leaflet-control{margin-left:10px}.leaflet-right .leaflet-control{margin-right:10px}.leaflet-fade-anim .leaflet-popup,.leaflet-fade-anim .leaflet-tile{opacity:0;-webkit-transition:opacity .2s linear;-moz-transition:opacity .2s linear;-o-transition:opacity .2s linear;transition:opacity .2s linear}.leaflet-fade-anim .leaflet-map-pane .leaflet-popup,.leaflet-fade-anim .leaflet-tile-loaded{opacity:1}.leaflet-zoom-anim .leaflet-zoom-animated{-webkit-transition:-webkit-transform .25s cubic-bezier(0,0,.25,1);-moz-transition:-moz-transform .25s cubic-bezier(0,0,.25,1);-o-transition:-o-transform .25s cubic-bezier(0,0,.25,1);transition:transform .25s cubic-bezier(0,0,.25,1)}.leaflet-pan-anim .leaflet-tile,.leaflet-touching .leaflet-zoom-animated,.leaflet-zoom-anim .leaflet-tile{-webkit-transition:none;-moz-transition:none;-o-transition:none;transition:none}.leaflet-zoom-anim .leaflet-zoom-hide{visibility:hidden}.leaflet-clickable{cursor:pointer}.leaflet-container{cursor:-webkit-grab;cursor:-moz-grab}.leaflet-control,.leaflet-popup-pane{cursor:auto}.leaflet-dragging .leaflet-clickable,.leaflet-dragging .leaflet-container{cursor:move;cursor:-webkit-grabbing;cursor:-moz-grabbing}.leaflet-container{background:#ddd;outline:0}.leaflet-container a{color:#0078A8}.leaflet-container a.leaflet-active{outline:2px solid orange}.leaflet-zoom-box{border:2px dotted #38f;background:rgba(255,255,255,.5)}.leaflet-container{font:12px/1.5 \"Helvetica Neue\",Arial,Helvetica,sans-serif}.leaflet-bar{box-shadow:0 1px 5px rgba(0,0,0,.65);border-radius:4px}.leaflet-bar a,.leaflet-bar a:hover{background-color:#fff;border-bottom:1px solid #ccc;width:26px;height:26px;line-height:26px;display:block;text-align:center;text-decoration:none;color:#000}.leaflet-bar a,.leaflet-control-layers-toggle{background-position:50% 50%;background-repeat:no-repeat;display:block}.leaflet-bar a:hover{background-color:#f4f4f4}.leaflet-bar a:first-child{border-top-left-radius:4px;border-top-right-radius:4px}.leaflet-bar a:last-child{border-bottom-left-radius:4px;border-bottom-right-radius:4px;border-bottom:none}.leaflet-bar a.leaflet-disabled{cursor:default;background-color:#f4f4f4;color:#bbb}.leaflet-touch .leaflet-bar a{width:30px;height:30px;line-height:30px}.leaflet-control-zoom-in,.leaflet-control-zoom-out{font:700 18px 'Lucida Console',Monaco,monospace;text-indent:1px}.leaflet-control-zoom-out{font-size:20px}.leaflet-touch .leaflet-control-zoom-in{font-size:22px}.leaflet-touch .leaflet-control-zoom-out{font-size:24px}.leaflet-control-layers{box-shadow:0 1px 5px rgba(0,0,0,.4);background:#fff;border-radius:5px}.leaflet-control-layers-toggle{background-image:url(jspm_packages/github/Leaflet/Leaflet@0.7.7/dist/images/layers.png);width:36px;height:36px}.leaflet-retina .leaflet-control-layers-toggle{background-image:url(jspm_packages/github/Leaflet/Leaflet@0.7.7/dist/images/layers-2x.png);background-size:26px 26px}.leaflet-touch .leaflet-control-layers-toggle{width:44px;height:44px}.leaflet-control-layers .leaflet-control-layers-list,.leaflet-control-layers-expanded .leaflet-control-layers-toggle{display:none}.leaflet-control-layers-expanded .leaflet-control-layers-list{display:block;position:relative}.leaflet-control-layers-expanded{padding:6px 10px 6px 6px;color:#333;background:#fff}.leaflet-control-layers-selector{margin-top:2px;position:relative;top:1px}.leaflet-control-layers label{display:block}.leaflet-control-layers-separator{height:0;border-top:1px solid #ddd;margin:5px -10px 5px -6px}.leaflet-container .leaflet-control-attribution{background:#fff;background:rgba(255,255,255,.7);margin:0}.leaflet-control-attribution,.leaflet-control-scale-line{padding:0 5px;color:#333}.leaflet-control-attribution a{text-decoration:none}.leaflet-control-attribution a:hover{text-decoration:underline}.leaflet-container .leaflet-control-attribution,.leaflet-container .leaflet-control-scale{font-size:11px}.leaflet-left .leaflet-control-scale{margin-left:5px}.leaflet-bottom .leaflet-control-scale{margin-bottom:5px}.leaflet-control-scale-line{border:2px solid #777;border-top:none;line-height:1.1;padding:2px 5px 1px;font-size:11px;white-space:nowrap;overflow:hidden;-moz-box-sizing:content-box;box-sizing:content-box;background:#fff;background:rgba(255,255,255,.5)}.leaflet-control-scale-line:not(:first-child){border-top:2px solid #777;border-bottom:none;margin-top:-2px}.leaflet-control-scale-line:not(:first-child):not(:last-child){border-bottom:2px solid #777}.leaflet-touch .leaflet-bar,.leaflet-touch .leaflet-control-attribution,.leaflet-touch .leaflet-control-layers{box-shadow:none}.leaflet-touch .leaflet-bar,.leaflet-touch .leaflet-control-layers{border:2px solid rgba(0,0,0,.2);background-clip:padding-box}.leaflet-popup{position:absolute;text-align:center}.leaflet-popup-content-wrapper{padding:1px;text-align:left;border-radius:12px}.leaflet-popup-content{margin:13px 19px;line-height:1.4}.leaflet-popup-content p{margin:18px 0}.leaflet-popup-tip-container{margin:0 auto;width:40px;height:20px;position:relative;overflow:hidden}.leaflet-popup-tip{width:17px;height:17px;padding:1px;margin:-10px auto 0;-webkit-transform:rotate(45deg);-moz-transform:rotate(45deg);-ms-transform:rotate(45deg);-o-transform:rotate(45deg);transform:rotate(45deg)}.leaflet-popup-content-wrapper,.leaflet-popup-tip{background:#fff;box-shadow:0 3px 14px rgba(0,0,0,.4)}.leaflet-container a.leaflet-popup-close-button{position:absolute;top:0;right:0;padding:4px 4px 0 0;text-align:center;width:18px;height:14px;font:16px/14px Tahoma,Verdana,sans-serif;color:#c3c3c3;text-decoration:none;font-weight:700;background:0 0}.leaflet-container a.leaflet-popup-close-button:hover{color:#999}.leaflet-popup-scrolled{overflow:auto;border-bottom:1px solid #ddd;border-top:1px solid #ddd}.leaflet-oldie .leaflet-popup-content-wrapper{zoom:1}.leaflet-oldie .leaflet-popup-tip{width:24px;margin:0 auto;-ms-filter:\"progid:DXImageTransform.Microsoft.Matrix(M11=0.70710678, M12=0.70710678, M21=-0.70710678, M22=0.70710678)\";filter:progid:DXImageTransform.Microsoft.Matrix(M11=.70710678, M12=.70710678, M21=-.70710678, M22=.70710678)}.leaflet-oldie .leaflet-popup-tip-container{margin-top:-1px}.leaflet-oldie .leaflet-control-layers,.leaflet-oldie .leaflet-control-zoom,.leaflet-oldie .leaflet-popup-content-wrapper,.leaflet-oldie .leaflet-popup-tip{border:1px solid #999}.leaflet-div-icon{background:#fff;border:1px solid #666}.leaflet-control-loading:empty{background-image:url(data:image/gif;base64,R0lGODlhEAAQAPQAAP///wAAAPDw8IqKiuDg4EZGRnp6egAAAFhYWCQkJKysrL6+vhQUFJycnAQEBDY2NmhoaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACH+GkNyZWF0ZWQgd2l0aCBhamF4bG9hZC5pbmZvACH5BAAKAAAAIf8LTkVUU0NBUEUyLjADAQAAACwAAAAAEAAQAAAFdyAgAgIJIeWoAkRCCMdBkKtIHIngyMKsErPBYbADpkSCwhDmQCBethRB6Vj4kFCkQPG4IlWDgrNRIwnO4UKBXDufzQvDMaoSDBgFb886MiQadgNABAokfCwzBA8LCg0Egl8jAggGAA1kBIA1BAYzlyILczULC2UhACH5BAAKAAEALAAAAAAQABAAAAV2ICACAmlAZTmOREEIyUEQjLKKxPHADhEvqxlgcGgkGI1DYSVAIAWMx+lwSKkICJ0QsHi9RgKBwnVTiRQQgwF4I4UFDQQEwi6/3YSGWRRmjhEETAJfIgMFCnAKM0KDV4EEEAQLiF18TAYNXDaSe3x6mjidN1s3IQAh+QQACgACACwAAAAAEAAQAAAFeCAgAgLZDGU5jgRECEUiCI+yioSDwDJyLKsXoHFQxBSHAoAAFBhqtMJg8DgQBgfrEsJAEAg4YhZIEiwgKtHiMBgtpg3wbUZXGO7kOb1MUKRFMysCChAoggJCIg0GC2aNe4gqQldfL4l/Ag1AXySJgn5LcoE3QXI3IQAh+QQACgADACwAAAAAEAAQAAAFdiAgAgLZNGU5joQhCEjxIssqEo8bC9BRjy9Ag7GILQ4QEoE0gBAEBcOpcBA0DoxSK/e8LRIHn+i1cK0IyKdg0VAoljYIg+GgnRrwVS/8IAkICyosBIQpBAMoKy9dImxPhS+GKkFrkX+TigtLlIyKXUF+NjagNiEAIfkEAAoABAAsAAAAABAAEAAABWwgIAICaRhlOY4EIgjH8R7LKhKHGwsMvb4AAy3WODBIBBKCsYA9TjuhDNDKEVSERezQEL0WrhXucRUQGuik7bFlngzqVW9LMl9XWvLdjFaJtDFqZ1cEZUB0dUgvL3dgP4WJZn4jkomWNpSTIyEAIfkEAAoABQAsAAAAABAAEAAABX4gIAICuSxlOY6CIgiD8RrEKgqGOwxwUrMlAoSwIzAGpJpgoSDAGifDY5kopBYDlEpAQBwevxfBtRIUGi8xwWkDNBCIwmC9Vq0aiQQDQuK+VgQPDXV9hCJjBwcFYU5pLwwHXQcMKSmNLQcIAExlbH8JBwttaX0ABAcNbWVbKyEAIfkEAAoABgAsAAAAABAAEAAABXkgIAICSRBlOY7CIghN8zbEKsKoIjdFzZaEgUBHKChMJtRwcWpAWoWnifm6ESAMhO8lQK0EEAV3rFopIBCEcGwDKAqPh4HUrY4ICHH1dSoTFgcHUiZjBhAJB2AHDykpKAwHAwdzf19KkASIPl9cDgcnDkdtNwiMJCshACH5BAAKAAcALAAAAAAQABAAAAV3ICACAkkQZTmOAiosiyAoxCq+KPxCNVsSMRgBsiClWrLTSWFoIQZHl6pleBh6suxKMIhlvzbAwkBWfFWrBQTxNLq2RG2yhSUkDs2b63AYDAoJXAcFRwADeAkJDX0AQCsEfAQMDAIPBz0rCgcxky0JRWE1AmwpKyEAIfkEAAoACAAsAAAAABAAEAAABXkgIAICKZzkqJ4nQZxLqZKv4NqNLKK2/Q4Ek4lFXChsg5ypJjs1II3gEDUSRInEGYAw6B6zM4JhrDAtEosVkLUtHA7RHaHAGJQEjsODcEg0FBAFVgkQJQ1pAwcDDw8KcFtSInwJAowCCA6RIwqZAgkPNgVpWndjdyohACH5BAAKAAkALAAAAAAQABAAAAV5ICACAimc5KieLEuUKvm2xAKLqDCfC2GaO9eL0LABWTiBYmA06W6kHgvCqEJiAIJiu3gcvgUsscHUERm+kaCxyxa+zRPk0SgJEgfIvbAdIAQLCAYlCj4DBw0IBQsMCjIqBAcPAooCBg9pKgsJLwUFOhCZKyQDA3YqIQAh+QQACgAKACwAAAAAEAAQAAAFdSAgAgIpnOSonmxbqiThCrJKEHFbo8JxDDOZYFFb+A41E4H4OhkOipXwBElYITDAckFEOBgMQ3arkMkUBdxIUGZpEb7kaQBRlASPg0FQQHAbEEMGDSVEAA1QBhAED1E0NgwFAooCDWljaQIQCE5qMHcNhCkjIQAh+QQACgALACwAAAAAEAAQAAAFeSAgAgIpnOSoLgxxvqgKLEcCC65KEAByKK8cSpA4DAiHQ/DkKhGKh4ZCtCyZGo6F6iYYPAqFgYy02xkSaLEMV34tELyRYNEsCQyHlvWkGCzsPgMCEAY7Cg04Uk48LAsDhRA8MVQPEF0GAgqYYwSRlycNcWskCkApIyEAOwAAAAAAAAAAAA==);background-repeat:no-repeat}.leaflet-control-loading,.leaflet-control-zoom a.leaflet-control-loading,.leaflet-control-zoomslider a.leaflet-control-loading{display:none}.leaflet-control-loading.is-loading,.leaflet-control-zoom a.leaflet-control-loading.is-loading,.leaflet-control-zoomslider a.leaflet-control-loading.is-loading{display:block}.leaflet-bar-part-bottom{border-bottom:medium none;border-bottom-left-radius:4px;border-bottom-right-radius:4px}.sidebar{position:absolute;top:0;bottom:0;width:100%;overflow:hidden;z-index:2000}.sidebar.collapsed{width:40px}@media (min-width:768px){.sidebar{top:10px;bottom:10px;transition:width .5s}}@media (min-width:768px) and (max-width:991px){.sidebar{width:305px}}@media (min-width:992px) and (max-width:1199px){.sidebar{width:390px}}@media (min-width:1200px){.sidebar{width:460px}}.sidebar-left{left:0}@media (min-width:768px){.sidebar-left{left:10px}}.sidebar-right{right:0}@media (min-width:768px){.sidebar-right{right:10px}}.sidebar-tabs{top:0;bottom:0;height:100%;background-color:#fff}.sidebar-left .sidebar-tabs{left:0}.sidebar-right .sidebar-tabs{right:0}.sidebar-tabs,.sidebar-tabs>ul{position:absolute;width:40px;margin:0;padding:0}.sidebar-tabs>li,.sidebar-tabs>ul>li{width:100%;height:40px;color:#333;font-size:12pt;overflow:hidden;transition:all 80ms}.sidebar-tabs>li:hover,.sidebar-tabs>ul>li:hover{color:#000;background-color:#eee}.sidebar-tabs>li.active,.sidebar-tabs>ul>li.active{color:#fff;background-color:#0074d9}.sidebar-tabs>li.disabled,.sidebar-tabs>ul>li.disabled{color:rgba(51,51,51,.4)}.sidebar-tabs>li.disabled:hover,.sidebar-tabs>ul>li.disabled:hover{background:0 0}.sidebar-tabs>li.disabled>a,.sidebar-tabs>ul>li.disabled>a{cursor:default}.sidebar-tabs>li>a,.sidebar-tabs>ul>li>a{display:block;width:100%;height:100%;line-height:40px;color:inherit;text-decoration:none;text-align:center}.sidebar-tabs>ul+ul{bottom:0}.sidebar-content{position:absolute;top:0;bottom:0;background-color:rgba(255,255,255,.95);overflow-x:hidden;overflow-y:auto}.sidebar-left .sidebar-content{left:40px;right:0}.sidebar-right .sidebar-content{left:0;right:40px}.sidebar.collapsed>.sidebar-content{overflow-y:hidden}.sidebar-pane{display:none;left:0;right:0;box-sizing:border-box;padding:10px 20px}.sidebar-pane.active{display:block}@media (min-width:768px) and (max-width:991px){.sidebar-pane{min-width:265px}}@media (min-width:992px) and (max-width:1199px){.sidebar-pane{min-width:350px}}@media (min-width:1200px){.sidebar-pane{min-width:420px}}.sidebar-header{margin:-10px -20px 0;height:40px;padding:0 20px;line-height:40px;font-size:14.4pt;color:#fff;background-color:#0074d9}.sidebar-right .sidebar-header{padding-left:40px}.sidebar-close{position:absolute;top:0;width:40px;height:40px;text-align:center;cursor:pointer}.sidebar-left .sidebar-close{right:0}.sidebar-right .sidebar-close{left:0}.sidebar-left~.sidebar-map{margin-left:40px}@media (min-width:768px){.sidebar-left~.sidebar-map{margin-left:0}}.sidebar-right~.sidebar-map{margin-right:40px}@media (min-width:768px){.sidebar-right~.sidebar-map{margin-right:0}}.sidebar{box-shadow:0 1px 5px rgba(0,0,0,.65)}.sidebar.leaflet-touch{box-shadow:none;border-right:2px solid rgba(0,0,0,.2)}@media (min-width:768px){.sidebar{border-radius:4px}.sidebar.leaflet-touch{border:2px solid rgba(0,0,0,.2)}}@media (min-width:768px){.sidebar-left~.sidebar-map .leaflet-left{transition:left .5s}}@media (min-width:768px) and (max-width:991px){.sidebar-left~.sidebar-map .leaflet-left{left:315px}}@media (min-width:992px) and (max-width:1199px){.sidebar-left~.sidebar-map .leaflet-left{left:400px}}@media (min-width:1200px){.sidebar-left~.sidebar-map .leaflet-left{left:470px}}@media (min-width:768px){.sidebar-left.collapsed~.sidebar-map .leaflet-left{left:50px}}@media (min-width:768px){.sidebar-right~.sidebar-map .leaflet-right{transition:right .5s}}@media (min-width:768px) and (max-width:991px){.sidebar-right~.sidebar-map .leaflet-right{right:315px}}@media (min-width:992px) and (max-width:1199px){.sidebar-right~.sidebar-map .leaflet-right{right:400px}}@media (min-width:1200px){.sidebar-right~.sidebar-map .leaflet-right{right:470px}}@media (min-width:768px){.sidebar-right.collapsed~.sidebar-map .leaflet-right{right:50px}}body,html{height:100%;margin:0}#map{height:100%}.info{padding:6px 8px;font:14px/16px Arial,Helvetica,sans-serif;background:#fff;background:rgba(255,255,255,.8);box-shadow:0 0 15px rgba(0,0,0,.2);border-radius:5px}.external{background-image:linear-gradient(transparent,transparent),url(data:image/svg+xml,%3C%3Fxml%20version%3D%221.0%22%20encoding%3D%22UTF-8%22%3F%3E%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2210%22%3E%3Cg%20transform%3D%22translate%28-826.429%20-698.791%29%22%3E%3Crect%20width%3D%225.982%22%20height%3D%225.982%22%20x%3D%22826.929%22%20y%3D%22702.309%22%20fill%3D%22%23fff%22%20stroke%3D%22%2306c%22%2F%3E%3Cg%3E%3Cpath%20d%3D%22M831.194%20698.791h5.234v5.391l-1.571%201.545-1.31-1.31-2.725%202.725-2.689-2.689%202.808-2.808-1.311-1.311z%22%20fill%3D%22%2306f%22%2F%3E%3Cpath%20d%3D%22M835.424%20699.795l.022%204.885-1.817-1.817-2.881%202.881-1.228-1.228%202.881-2.881-1.851-1.851z%22%20fill%3D%22%23fff%22%2F%3E%3C%2Fg%3E%3C%2Fg%3E%3C%2Fsvg%3E);background-position:right center;background-repeat:no-repeat;padding-right:13px}.dataset-spatial-minimap{height:120px}.code-nowrap{word-wrap:normal;white-space:pre}.ac-container{width:auto;margin:10px auto 10px auto;text-align:left;overflow-y:auto;overflow-x:hidden;height:auto}.ac-container label{font-family:BebasNeueRegular,'Arial Narrow',Arial,sans-serif;padding:5px 20px;position:relative;z-index:20;display:block;cursor:pointer;color:#777;text-shadow:1px 1px 1px rgba(255,255,255,.8);line-height:30px;font-size:17px;background:#fff;background:-moz-linear-gradient(top,#fff 1%,#eaeaea 100%);background:-webkit-gradient(linear,left top,left bottom,color-stop(1%,#fff),color-stop(100%,#eaeaea));background:-webkit-linear-gradient(top,#fff 1%,#eaeaea 100%);background:-o-linear-gradient(top,#fff 1%,#eaeaea 100%);background:-ms-linear-gradient(top,#fff 1%,#eaeaea 100%);background:linear-gradient(top,#fff 1%,#eaeaea 100%);filter:progid:DXImageTransform.Microsoft.gradient( startColorstr='#ffffff', endColorstr='#eaeaea', GradientType=0 );box-shadow:0 0 0 1px rgba(155,155,155,.3),1px 0 0 0 rgba(255,255,255,.9) inset,0 2px 2px rgba(0,0,0,.1);box-sizing:content-box;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.ac-container label:hover{background:#fff}.ac-container input.menu:checked+label,.ac-container input.menu:checked+label:hover{background:#c6e1ec;color:#3d7489;text-shadow:0 1px 1px rgba(255,255,255,.6);box-shadow:0 0 0 1px rgba(155,155,155,.3),0 2px 2px rgba(0,0,0,.1)}.ac-container input.menu:checked+label:hover:after,.ac-container label:hover:after{content:'';position:absolute;width:24px;height:24px;right:13px;top:7px;background:transparent url(app/css/styledLayerControl/images/arrow_down.png) no-repeat center center}.ac-container input.menu:checked+label:hover:after{background-image:url(app/css/styledLayerControl/images/arrow_up.png)}.ac-container input.menu{display:none}.ac-container article{background:rgba(255,255,255,.5);margin-top:-1px;overflow:hidden;height:0;position:relative;z-index:10;-webkit-transition:height .3s ease-in-out,box-shadow .6s linear;-moz-transition:height .3s ease-in-out,box-shadow .6s linear;-o-transition:height .3s ease-in-out,box-shadow .6s linear;-ms-transition:height .3s ease-in-out,box-shadow .6s linear;transition:height .3s ease-in-out,box-shadow .6s linear}.ac-container input.menu:checked~article{-webkit-transition:height .5s ease-in-out,box-shadow .1s linear;-moz-transition:height .5s ease-in-out,box-shadow .1s linear;-o-transition:height .5s ease-in-out,box-shadow .1s linear;-ms-transition:height .5s ease-in-out,box-shadow .1s linear;transition:height .5s ease-in-out,box-shadow .1s linear;box-shadow:0 0 0 1px rgba(155,155,155,.3)}.ac-container input.menu:checked~article.ac-large{height:auto;max-height:200px;padding-top:5px;overflow-y:auto}.menu-item-radio{font-family:Ubuntu-Regular,Arial,sans-serif;font-size:13px}.menu-item-checkbox{font-family:Ubuntu-Regular,Arial,sans-serif;font-size:13px}.bt_delete{position:relative;float:right;background-image:url(app/css/styledLayerControl/images/delete.png);background-color:transparent;background-repeat:no-repeat;background-position:0 0;border:none;cursor:pointer;height:16px;width:16px;vertical-align:middle}.leaflet-control-layers{box-shadow:0 1px 5px rgba(0,0,0,.4);background:#e0e3ec url(app/css/styledLayerControl/images/bgnoise_lg.jpg) repeat top left;border-radius:5px}input[type=checkbox].leaflet-control-layers-selector,input[type=radio].leaflet-control-layers-selector{margin:3px 3px 0 5px}");
})
(function(factory) {
  factory();
});