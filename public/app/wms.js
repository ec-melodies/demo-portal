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
  // not using minified.js here since it has problems with external xml documents
  // see https://github.com/timjansen/minified.js/issues/66
  let layers = []
  let layerNodes = xml.getElementsByTagName('Layer')
  for (let layerNode of layerNodes) {
    if (layerNode.getAttribute('queryable') !== '1') continue
    let children = [].slice.call(layerNode.children)
    let nameEl = children.find(el => el.tagName === 'Name')
    let titleEl = children.find(el => el.tagName === 'Title')
    if (nameEl) {
      let name = nameEl.textContent
      layers.push({name: name, title: titleEl.textContent})
    }
  }
  return layers
}
