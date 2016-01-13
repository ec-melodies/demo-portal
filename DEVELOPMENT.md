After the initial set up with `npm install`, the file public/config.js has to be changed:

From:
```js
  babelOptions: {
    "optional": [
      "runtime",
      "optimisation.modules.system"
    ]
  },
```

To:
```js
  babelOptions: {
    "optional": [
      "optimisation.modules.system"
    ]
  },
```

This will not be necessary from JSPM 0.17 on.