import {$} from 'minified'

export function i18n (prop) {
  if (!prop) return
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

export function fromTemplate (id) {
  return document.importNode($('#' + id)[0].content, true).children[0]
}

// https://github.com/github/fetch#handling-http-error-statuses
export function checkStatus (response) {
  if (response.ok) { // status 2xx
    return response
  } else {
    let error = new Error(response.statusText)
    error.response = response
    throw error
  }
}