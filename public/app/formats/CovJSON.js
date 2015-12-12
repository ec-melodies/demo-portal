import * as CovJSONReader from 'covjson-reader'
import * as RestAPI from 'coverage-rest-client'
import CoverageData from './CoverageData.js'

export default class CovJSON extends CoverageData {
  /**
   * @param {Array} actionFactories Array of action class factories
   */
  constructor (actionFactories) {
    super(actionFactories)
    this.label = 'CoverageJSON'
    this.shortLabel = 'CovJSON'
    this.mediaTypes = ['application/prs.coverage+json']
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
        .then(data => RestAPI.wrap(data, {
          loader: CovJSONReader.read
        }))
    }
  }
  
}