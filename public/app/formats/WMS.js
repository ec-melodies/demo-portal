import {$} from 'minified'
import Format from './Format.js'

// see dcat.js, this media type does not actually exist!
const MEDIA_TYPE = 'application/wms+xml'

export default class WMS extends Format {
  /**
   * @param {Array} actionFactories Array of action class factories
   */
  constructor (actionFactories) {
    super(actionFactories)
    this.label = 'Web Map Service'
    this.shortLabel = 'WMS'
  }
  
  supports (mediaType) {
    return mediaType && mediaType.toLowerCase() === MEDIA_TYPE 
  }
  
  /**
   * @param url A WMS endpoint URL.
   * @returns {Promise} succeeds with layers metadata.
   */
  load (url) {
    return readLayers(url).then(layers => {
      return {layers, url}
    })
  }
  
  getMetadata (data) {
    return {
      format: this.label,
      type: data.layers.length + ' layers'
    }
  }
}

function readLayers (wmsEndpoint) {
  return readCapabilities(wmsEndpoint).then(getLayers)
}

function readCapabilities (wmsEndpoint) { 
  // TODO rewrite with fetch
  return new Promise((resolve, reject) => {
    let req = new XMLHttpRequest()
    req.open('GET', wmsEndpoint + '?service=wms&version=1.1.1&request=GetCapabilities')
    req.overrideMimeType('text/xml')
    
    req.addEventListener('load', () => {
      let xml = req.responseXML
      resolve(xml)
    })
    
    req.addEventListener('error', () => {
      reject(new Error('Network error loading resource at ' + wmsEndpoint))
    })
    
    req.send()
  })
}

function getLayers (xml) {
  xml = xml.documentElement
  let layers = []
  $('Layer', xml).each(layerNode => {
    if ($(layerNode).get('@queryable') !== '1') return
    let name = $('Name', layerNode, true).text()
    let title = $('Title', layerNode, true).text()
    layers.push({name, title})
  })
  return layers
}
