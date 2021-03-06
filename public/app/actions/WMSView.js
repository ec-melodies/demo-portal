import L from 'leaflet'

import {i18n} from '../util.js'
import ImageLegend from '../ImageLegend.js'
import {default as Action, VIEW} from './Action.js'

export default class WMSView extends Action {
  constructor (data, context) {
    super(context)
    this.data = data
    
    this._setHidden()
        
    this.layers = []
  }
  
  _setVisible () {
    this.visible = true
    this.label = 'Hide'
    this.icon = '<span class="glyphicon glyphicon-eye-close"></span>'
    this.fire('labelChange')
  }
  
  _setHidden () {
    this.visible = false
    this.label = 'View'
    this.icon = '<span class="glyphicon glyphicon-eye-open"></span>'
    this.fire('labelChange')
  }
  
  get isSupported () {
    return true
  }
  
  run () {
    if (this.visible) {
      this.remove()
      this._setHidden()
      return
    }
    
    this._setVisible()
    
    let map = this.context.map
    
    let wmsLayers = this.data.layers
    // FIXME this is not necessarily the endpoint url
    //      -> read the endpoint url directly from the GetCapabilities document
    let url = this.data.url
    
    let datasetTitle = i18n(this.context.dataset.title)
    
    let firstDisplayed = false
    for (let wmsLayer of wmsLayers) {
      let layer = L.tileLayer.wms(url, {
        layers: wmsLayer.name,
        format: 'image/png',
        transparent: true
      }).on('loading', () => this.fire('loading'))
        .on('load', () => this.fire('load'))
      
      // In leaflet 1.0 every layer will have add/remove events, this is a workaround
      map.on('layeradd', e => {
        if (e.layer !== layer) return
        let legendUrl = getLegendUrl(url, wmsLayer.name)
        new ImageLegend(legendUrl, {layer: e.layer, title: wmsLayer.title}).addTo(map)
      })
      if (!firstDisplayed) {
        firstDisplayed = true
        layer.addTo(map)
      }
      map.layerControl.addOverlay(layer, '<span class="label label-success">WMS</span> ' + wmsLayer.title, {groupName: datasetTitle, expanded: true})
      this.layers.push(layer)
    }
  }
  
  remove () {
    let map = this.context.map
    
    for (let layer of this.layers) {
      if (map.hasLayer(layer)) {
        map.removeLayer(layer)
      }
      map.layerControl.removeLayer(layer)
    }
    this.layers = []
  }
}

WMSView.type = VIEW

function getLegendUrl (wmsEndpoint, layer) {
  return wmsEndpoint + '?service=wms&version=1.1.1&request=GetLegendGraphic&format=image/png&transparent=true&layer=' + layer
}
