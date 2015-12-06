import 'fetch'
import {checkStatus} from '../util.js'
import Format from './Format.js'

const MEDIA_TYPE = 'application/vnd.geo+json'

export default class GeoJSON extends Format {
  constructor (actionFactories) {
    super(actionFactories)
    this.label = 'GeoJSON'
    this.shortLabel = this.label
  }
  
  supports (mediaType) {
    return mediaType === MEDIA_TYPE
  }
  
  /**
   * @param urlOrObject Either a URL or a GeoJSON object.
   * @returns {Object} An object with metadata.
   */
  doLoad (urlOrObject) {
    if (typeof urlOrObject === 'string') {
      return fetch(urlOrObject, {
        headers: new Headers({
          Accept: MEDIA_TYPE + '; q=1.0,application/json; q=0.5'
        })
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
  
  getMetadata (geojson) {
    return {
      format: this.label,
      type: geojson.type
    }
  }
  
}
