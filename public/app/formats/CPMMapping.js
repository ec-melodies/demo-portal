import Format from './Format.js'
import {loadJSON} from './util.js'

export default class CPMMapping extends Format {
  constructor (actionFactories) {
    super(actionFactories)
    this.label = 'Complex Property Model Mapping in JSON-LD'
    this.shortLabel = 'CPM-Mapping'
    this.mediaTypes = ['application/ld+json;profile="http://purl.org/voc/cpm_mapping"']
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
      type: '1 Mapping'
    }
  }
}