import 'fetch'

export {getLanguageString as i18n} from 'covutils'

export const MELODIES_DCAT_CATALOG_URL = 'https://ec-melodies.github.io/wp02-dcat/feed.jsonld'

/**
 * A Map which returns a default value for get(key) if key does not exist.
 */
export class DefaultMap {
  constructor (defaultFactory, iterable) {
    this._map = new Map(iterable)
    this.defaultFactory = defaultFactory
  }
  get (key) {
    if (!this._map.has(key)) {
      this._map.set(key, this.defaultFactory())
    }
    return this._map.get(key)
  }
  set (key, val) {
    this._map.set(key, val)
  }
  delete (key) {
    this._map.delete(key)
  }
}

export function sortByKey (array, keyFn) {
  return array.sort((a, b) => {
    let x = keyFn(a)
    let y = keyFn(b)
    return ((x < y) ? -1 : ((x > y) ? 1 : 0))
  })
}

export function loadJSON (urlOrObject, additionalMediaTypes) {
  if (typeof urlOrObject === 'string') {
    let mt = additionalMediaTypes.map(m => m + '; q=1.0')
    mt.push('application/json; q=0.5')
    mt = mt.join(',')
    return fetch(urlOrObject, {
      headers: new Headers({Accept: mt})
    })
    .catch(e => {
      // we only get a response object if there was no network/CORS error, fall-back
      e.response = {url: urlOrObject}
      throw e
    })
    .then(checkStatus)
    .then(response => response.json())
  } else {
    return Promise.resolve(urlOrObject)
  }
}

//https://github.com/github/fetch#handling-http-error-statuses
export function checkStatus (response) {
  if (response.ok) { // status 2xx
    return response
  } else {
    let error = new Error(response.statusText)
    error.response = response
    throw error
  }
}
