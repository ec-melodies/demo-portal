import LayerFactory from 'leaflet-coverage'
import CoverageLegend from 'leaflet-coverage/controls/Legend.js'

import Action from './Action.js'
import {i18n} from '../util.js'

export default function factory (map) {
  return data => new CovJSONView(data, map)
} 

export class CovJSONView extends Action {
  constructor (data, map) {
    super()
    this.map = map
    this.cov = data
    
    this.label = 'View'
    this.layers = []
  }
  
  get isSupported () {
    return true
  }
  
  run () {
    if (this.hasRun) return
    this.hasRun = true
    
    let dataset = this.context.dataset
    let datasetTitle = i18n(dataset.title)
    // TODO support collections
    
    let cov = this.cov
    let firstDisplayed = false
    // each parameter becomes a layer
    for (let key of cov.parameters.keys()) {
      let opts = {keys: [key]}
      let layer = LayerFactory()(cov, opts).on('add', e => {
        let covLayer = e.target
        this.map.fitBounds(covLayer.getBounds())
        
        if (covLayer.palette) {
          CoverageLegend(layer, {
            position: 'bottomright'
          }).addTo(this.map)
        }
      })
      if (!firstDisplayed) {
        firstDisplayed = true
        layer.addTo(this.map)
      }
      let layerName = i18n(cov.parameters.get(key).observedProperty.label)
      this.map.layerControl.addOverlay(layer, '<span class="label label-success">CovJSON</span> ' + layerName, {groupName: datasetTitle, expanded: true})
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
