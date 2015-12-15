export function i18n (prop) {
  if (!prop) return
  if (!(prop instanceof Map)) {
    let map = new Map()
    for (let key in prop) {
      map.set(key, prop[key])
    }
    prop = map
  }
  // TODO be clever and select proper language
  if (prop.has('en')) {
    return prop.get('en')
  } else {
    // random
    return prop.values().next().value
  }
}

export function stringifyMapReplacer (key, value) {
  // don't ask
  // see https://github.com/DavidBruant/Map-Set.prototype.toJSON/issues/8
  // and https://github.com/zloirock/core-js/issues/148
  if (value instanceof Map || ((key === 'label' || key === 'description') && Array.isArray(value))) {
    let obj = {}
    for (let [k,v] of value) {
      obj[k] = v
    }
    return obj
  }
  return value
}

export function parseLanguageMapReviver (key, value) {
  if (key === 'label' || key === 'description') {
    if (typeof value !== 'object') return value
    return toLanguageMap(value)
  }
  return value
}

export function toLanguageMap (obj) {
  return new Map(Object.keys(obj).map(lang => [lang, obj[lang]]))
}

export function sortByKey (array, keyFn) {
  return array.sort((a, b) => {
    let x = keyFn(a)
    let y = keyFn(b)
    return ((x < y) ? -1 : ((x > y) ? 1 : 0))
  })
}
