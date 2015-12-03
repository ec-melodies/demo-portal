import {promises as jsonld} from 'jsonld'

const MEDIA_TYPE = 'application/ld+json'

export default class JSONLDLoader {
  supports (mediaType) {
    return mediaType && mediaType.startsWith(MEDIA_TYPE) // can have parameters
  }
  
  /**
   * @param urlOrObject Either a URL or a GeoJSON object.
   * @returns {Object} An object with metadata.
   */
  loadMetadata (urlOrObject) {
    return jsonld.compact(urlOrObject, {}).then(data => this._extractMetadata(data))
  }
  
  _extractMetadata (data) {
    // TODO check if we have a more specialized loader for the root type
    // TODO are we supporting cases where there is no single root after compaction?
    return {
      loader: this,
      format: 'JSON-LD',
      type: data['@type']
    }
  }
}