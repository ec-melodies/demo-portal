import L from 'leaflet'

import {i18n} from '../util.js'
import Action from './Action.js'

export default function factory (map) {
  return data => new GeoJSONView(data, map)
} 

export class GeoJSONView extends Action {
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
    let layer = L.geoJson(this.data, {
      pointToLayer: (feature, latlng) => L.circleMarker(latlng),
      onEachFeature: (feature, layer) => {
        layer.bindPopup(
            '<pre><code class="code-nowrap">' + JSON.stringify(feature.properties, null, 4) + '</code></pre>',
            { maxWidth: 400, maxHeight: 300 })
      }
    }).addTo(this.map)
    
    let datasetTitle = i18n(this.context.dataset.title)
    let distTitle = i18n(this.context.distribution.title)

    this.map.layerControl.addOverlay(layer, '<span class="label label-success">GeoJSON</span> ' + distTitle, {groupName: datasetTitle, expanded: true})
    this.map.fitBounds(layer.getBounds())
    this.layers.push(layer)
  }
  
  remove () {
    let datasetTitle = i18n(this.context.dataset.title)
    this.map.layerControl.removeGroup(datasetTitle)
    for (let layer of this.layers) {
      this.map.removeLayer(layer)
    }
  }
}