import {$} from 'minified'
import Format from './Format.js'

export default class WMS extends Format {
  /**
   * @param {Array} actionFactories Array of action class factories
   */
  constructor (actionFactories) {
    super(actionFactories)
    this.label = 'Web Map Service'
    this.shortLabel = 'WMS'
    // see dcat.js, this media type does not actually exist!
    this.mediaTypes = ['application/wms+xml']
  }
    
  /**
   * @param url A WMS endpoint URL.
   * @returns {Promise} succeeds with layers metadata.
   */
  doLoad (url) {
    return readLayers(url).then(layers => ({layers, url}))
  }
  
  getMetadata (data) {
    return {
      format: this.label,
      content: data.layers.length + ' layers'
    }
  }
}

function readLayers (wmsEndpoint) {
  return readCapabilities(wmsEndpoint).then(getLayers)
}

function readCapabilities (wmsEndpoint) { 
  // TODO rewrite with fetch
  var uriParts = document.createElement('a')
  uriParts.href = wmsEndpoint
  let user = uriParts.username
  let pass = uriParts.password
  if (user) {
    // remove user and pass from URL and send as Auth header instead
    let parts = /^(https?:\/\/)(.*)@(.*)/.exec(wmsEndpoint)
    wmsEndpoint = parts[1] + parts[3]
  }
  return new Promise((resolve, reject) => {
    let req = new XMLHttpRequest()
    req.open('GET', wmsEndpoint + '?service=wms&version=1.1.1&request=GetCapabilities')
    req.overrideMimeType('text/xml')
    
    if (user) {
      let cred = user + ':' + pass
      req.setRequestHeader('Authorization', 'Basic ' + btoa(cred)) 
    }
    
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
