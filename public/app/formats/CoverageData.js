import Format from './Format.js'

// pseudo media type for our internal Coverage objects (https://github.com/Reading-eScience-Centre/coverage-jsapi)
const MEDIA_TYPE = 'coveragedata'

/**
 * An object-only format that is used for derived data.
 */
export default class CoverageData extends Format {
  /**
   * @param {Array} actionFactories Array of action class factories
   */
  constructor (actionFactories) {
    super(actionFactories)
    this.label = 'Coverage data'
    this.shortLabel = 'Coverage data'
  }
  
  supports (mediaType) {
    return MEDIA_TYPE === mediaType 
  }
  
  /**
   * @param object Either a URL, a CovJSON object, or a Coverage API object.
   * @returns {Promise} succeeds with a Coverage or Coverage Collection API object
   */
  doLoad (object) {
    return Promise.resolve(object)
  }
  
  getMetadata (cov) {
    return {
      format: this.label,
      type: cov.type
    }
  }
}