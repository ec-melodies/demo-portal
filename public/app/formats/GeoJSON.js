import Format from './Format.js'
import {loadJSON} from './util.js'

export default class GeoJSON extends Format {
  constructor (actionFactories) {
    super(actionFactories)
    this.label = 'GeoJSON'
    this.shortLabel = this.label
    this.mediaTypes = ['application/vnd.geo+json']
  }
    
  /**
   * @param urlOrObject Either a URL or a GeoJSON object.
   * @returns {Promise}
   */
  doLoad (urlOrObject) {
    return loadJSON(urlOrObject, this.mediaTypes)
  }
  
  getMetadata (geojson) {
    return {
      format: this.label,
      content: geojson.type
    }
  }
  
}
