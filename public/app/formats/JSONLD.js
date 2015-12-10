import {promises as jsonld} from 'jsonld'
import Format from './Format.js'

export default class JSONLD extends Format {
  constructor (actionFactories) {
    super(actionFactories)
    this.label = 'JSON-LD'
    this.shortLabel = 'JSON-LD'
    this.mediaTypes = ['application/ld+json']
  }
    
  /**
   * @param urlOrObject Either a URL or a JSON-LD object.
   * @returns {Promise} succeeds with JSON-LD object
   */
  doLoad (urlOrObject) {
    return jsonld.compact(urlOrObject, {})
  }
  
  getMetadata (data) {
    // TODO check if we have a more specialized loader for the root type
    // TODO are we supporting cases where there is no single root after compaction?
    return {
      format: this.label,
      type: data['@type']
    }
  }
}