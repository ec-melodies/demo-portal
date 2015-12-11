import 'fetch'

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