import * as CovJSONReader from 'covjson-reader'
import Format from './Format.js'

const MEDIA_TYPES = ['application/prs.coverage+json', 'application/prs.coverage+cbor']

export default class CovJSON extends Format {
  /**
   * @param {Array} actionFactories Array of action class factories
   */
  constructor (actionFactories) {
    super(actionFactories)
  }
  
  supports (mediaType) {
    return MEDIA_TYPES.indexOf(mediaType) !== -1 
  }
  
  /**
   * @param urlOrObject Either a URL or a CovJSON object.
   * @returns {Promise} succeeds with a Coverage or Coverage Collection API object
   */
  load (urlOrObject) {
    return CovJSONReader.read(urlOrObject)
  }
  
  getMetadata (cov) {
    return {
      format: 'CoverageJSON',
      type: cov.type
    }
  }
}