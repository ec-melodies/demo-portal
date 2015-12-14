import L from 'leaflet'

import {i18n} from '../util.js'
import {default as Action, VIEW} from './Action.js'

export default class GeoJSONView extends Action {
  constructor (data) {
    super()
    this.data = data
    
    this.label = 'View'
    this.icon = '<span class="glyphicon glyphicon-eye-open"></span>'
      
    this.layers = []
  }
  
  get isSupported () {
    return true
  }
  
  run () {
    if (this.hasRun) return
    this.hasRun = true
    
    let map = this.context.map
    
    let layer = L.geoJson(this.data, {
      pointToLayer: (feature, latlng) => L.circleMarker(latlng),
      onEachFeature: (feature, layer) => {
        layer.bindPopup(
            '<pre><code class="code-nowrap">' + JSON.stringify(feature.properties, null, 4) + '</code></pre>',
            { maxWidth: 400, maxHeight: 300 })
      }
    }).addTo(map)
    
    let datasetTitle = i18n(this.context.dataset.title)
    let distTitle = i18n(this.context.distribution.title)

    map.layerControl.addOverlay(layer, '<span class="label label-success">GeoJSON</span> ' + distTitle, {groupName: datasetTitle, expanded: true})
    map.fitBounds(layer.getBounds())
    this.layers.push(layer)
  }
  
  remove () {
    let map = this.context.map
    
    let datasetTitle = i18n(this.context.dataset.title)
    map.layerControl.removeGroup(datasetTitle)
    for (let layer of this.layers) {
      map.removeLayer(layer)
    }
  }
}

GeoJSONView.type = VIEW
