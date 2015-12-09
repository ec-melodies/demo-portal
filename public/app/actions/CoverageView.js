import LayerFactory from 'leaflet-coverage'
import CoverageLegend from 'leaflet-coverage/controls/Legend.js'

import {default as Action, VIEW} from './Action.js'
import {i18n} from '../util.js'

export default class CoverageView extends Action {
  constructor (data) {
    super()
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
    
    let map = this.context.map
    
    let dataset = this.context.dataset
    let datasetTitle = i18n(dataset.title)
    // TODO support collections
    
    let cov = this.cov
    let firstDisplayed = false
    // each parameter becomes a layer
    for (let key of cov.parameters.keys()) {
      let opts = {keys: [key]}
      let layer = LayerFactory()(cov, opts)
        .on('add', e => {
          let covLayer = e.target
          map.fitBounds(covLayer.getBounds())
          
          if (covLayer.palette) {
            CoverageLegend(layer, {
              position: 'bottomright'
            }).addTo(map)
          }
        })
        .on('dataLoading', () => this.fire('loading'))
        .on('dataLoad', () => this.fire('load'))
      if (!firstDisplayed) {
        firstDisplayed = true
        layer.addTo(map)
      }
      let layerName = i18n(cov.parameters.get(key).observedProperty.label)
      map.layerControl.addOverlay(layer, '<span class="label label-success">CovJSON</span> ' + layerName, {groupName: datasetTitle, expanded: true})
      this.layers.push(layer)
    }
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

CoverageView.type = VIEW
