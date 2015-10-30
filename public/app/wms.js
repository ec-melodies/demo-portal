import {$} from 'minified'

export function readLayers (wmsEndpoint) {
  return readCapabilities(wmsEndpoint).then(getLayers)
}

export function readCapabilities (wmsEndpoint) {
  // not using minified.js here since it doesn't support overrideMimeType()
  // see https://github.com/timjansen/minified.js/issues/65
  
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

export function getLayers (xml) {
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

export function getLegendUrl (wmsEndpoint, layer) {
  return wmsEndpoint + '?service=wms&version=1.1.1&request=GetLegendGraphic&format=image/png&layer=' + layer
}