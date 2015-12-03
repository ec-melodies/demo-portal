import * as CovJSON from 'covjson-reader'

const MEDIA_TYPES = ['application/prs.coverage+json', 'application/prs.coverage+cbor']

export default class CovJSONLoader {
  supports (mediaType) {
    return MEDIA_TYPES.indexOf(mediaType) !== -1 
  }
  
  /**
   * @param urlOrObject Either a URL or a CovJSON object.
   * @returns {Object} An object with metadata.
   */
  loadMetadata (urlOrObject) {
    return CovJSON.read(urlOrObject).then(cov => this._extractMetadata(cov))
  }
  
  _extractMetadata (cov) {
    return {
      loader: this,
      format: 'CovJSON',
      type: cov.type
    }
  }
}