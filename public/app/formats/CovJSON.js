import * as CovJSONReader from 'covjson-reader'
import CoverageData from './CoverageData.js'

const MEDIA_TYPES = ['application/prs.coverage+json', 'application/prs.coverage+cbor']

export default class CovJSON extends CoverageData {
  /**
   * @param {Array} actionFactories Array of action class factories
   */
  constructor (actionFactories) {
    super(actionFactories)
    this.label = 'CoverageJSON'
    this.shortLabel = 'CovJSON'
  }
  
  supports (mediaType) {
    return MEDIA_TYPES.indexOf(mediaType) !== -1 
  }
  
  /**
   * @param urlOrObject Either a URL, a CovJSON object, or a Coverage API object.
   * @returns {Promise} succeeds with a Coverage or Coverage Collection API object
   */
  doLoad (urlOrObject) {
    if (typeof urlOrObject === 'object' && urlOrObject.loadDomain) {
      return Promise.resolve(urlOrObject)
    } else {
      return CovJSONReader.read(urlOrObject)
    }
  }
  
}