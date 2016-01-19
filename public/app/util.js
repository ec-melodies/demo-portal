export function i18n (prop) {
  if (!prop) return
  // TODO be clever and select proper language
  if (prop.en) {
    return prop.en
  } else {
    // random
    return prop[Object.keys(prop)[0]]
  }
}

export function sortByKey (array, keyFn) {
  return array.sort((a, b) => {
    let x = keyFn(a)
    let y = keyFn(b)
    return ((x < y) ? -1 : ((x > y) ? 1 : 0))
  })
}
