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

export function sortByKey (array, keyFn) {
  return array.sort((a, b) => {
    let x = keyFn(a)
    let y = keyFn(b)
    return ((x < y) ? -1 : ((x > y) ? 1 : 0))
  })
}
