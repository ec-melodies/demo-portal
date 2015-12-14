import Format from './Format.js'
import {loadJSON} from './util.js'

export default class CatRemap extends Format {
  constructor (actionFactories) {
    super(actionFactories)
    this.label = 'Category Remapping Definition in JSON-LD'
    this.shortLabel = 'CatRemap'
    this.mediaTypes = ['application/ld+json;profile="http://purl.org/voc/cpm_catremap"']
  }
    
  /**
   * @param urlOrObject Either a URL or an object.
   * @returns {Promise} succeeds with JSON-LD object
   */
  doLoad (urlOrObject) {
    return loadJSON(urlOrObject, this.mediaTypes)
  }
  
  getMetadata (data) {
    return {
      format: this.label,
      content: '1 Mapping'
    }
  }
}