import L from 'leaflet'

import {i18n} from '../util.js'
import ImageLegend from '../ImageLegend.js'
import Action from './Action.js'

export default function factory (map) {
  return data => new WMSView(data, map)
} 

export class WMSView extends Action {
  constructor (data, map) {
    super()
    this.data = data
    this.map = map
    
    this.label = 'View'
    this.layers = []
  }
  
  get isSupported () {
    return true
  }
  
  run () {
    let wmsLayers = this.data.layers
    let url = this.data.url
    
    let datasetTitle = i18n(this.context.dataset.title)
    
    let firstDisplayed = false
    for (let wmsLayer of wmsLayers) {
      let layer = L.tileLayer.wms(url, {
        layers: wmsLayer.name,
        format: 'image/png',
        transparent: true
      })
      // In leaflet 1.0 every layer will have add/remove events, this is a workaround
      this.map.on('layeradd', e => {
        if (e.layer !== layer) return
        let legendUrl = getLegendUrl(url, wmsLayer.name)
        new ImageLegend(legendUrl, {layer: e.layer, title: wmsLayer.title}).addTo(this.map)
      })
      if (!firstDisplayed) {
        firstDisplayed = true
        layer.addTo(this.map)
      }
      this.map.layerControl.addOverlay(layer, '<span class="label label-success">WMS</span> ' + wmsLayer.title, {groupName: datasetTitle, expanded: true})
      this.layers.push(layer)
    }
  }
  
  remove () {
    let datasetTitle = i18n(this.context.dataset.title)
    this.map.layerControl.removeGroup(datasetTitle)
    for (let layer of this.layers) {
      this.map.removeLayer(layer)
    }
  }
}

function getLegendUrl (wmsEndpoint, layer) {
  return wmsEndpoint + '?service=wms&version=1.1.1&request=GetLegendGraphic&format=image/png&transparent=true&layer=' + layer
}