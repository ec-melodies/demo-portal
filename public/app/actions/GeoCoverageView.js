import LayerFactory from 'leaflet-coverage'
import {getLayerClass} from 'leaflet-coverage'
import CoverageLegend from 'leaflet-coverage/controls/Legend.js'
import TimeAxis from 'leaflet-coverage/controls/TimeAxis.js'
import ProfilePlot from 'leaflet-coverage/popups/VerticalProfilePlot.js'

import {default as Action, VIEW} from './Action.js'
import {i18n} from '../util.js'
import SelectControl from './SelectControl.js'

/**
 * Displays geospatial coverages on a map.
 */
export default class GeoCoverageView extends Action {
  constructor (data, context) {
    super(context)
    this.cov = data
    
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
    // TODO support collections
    if (this.cov.coverages && this.cov.coverages.length > 1) {
      return false
    }
    let cov = this.cov
    if (cov.coverages) {
      cov = cov.coverages[0]
    }
    if (!getLayerClass(cov)) {
      return false
    }

    return true
  }
  
  run () {    
    let map = this.context.map
    
    let dataset = this.context.dataset
    let datasetTitle = i18n(dataset.title)
    
    if (this.visible) {
      this.remove()
      this._setHidden()
      return
    }
    
    this._setVisible()

    // TODO support collections
    
    let cov = this.cov
    if (cov.coverages) {
      cov = cov.coverages[0]
    }
    
    let firstDisplayed = false
    // each parameter becomes a layer
    for (let key of cov.parameters.keys()) {
      let opts = {keys: [key]}
      let layer = LayerFactory()(cov, opts)
        .on('add', e => {
          let covLayer = e.target
          //map.fitBounds(covLayer.getBounds())
          
          if (covLayer.palette) {
            CoverageLegend(layer, {
              position: 'bottomright'
            }).addTo(map)
          }
          
          if (covLayer.time !== null) {
            new TimeAxis(covLayer).addTo(map)
          }
          
          if (covLayer.vertical !== null) {
            let choices = covLayer.verticalSlices.map(val => ({
              value: val,
              label: val
            }))
            new SelectControl(covLayer, choices, {title: 'Vertical axis'})
              .on('change', event => {
                let vertical = parseFloat(event.value)
                covLayer.vertical = vertical
              })
              .addTo(map)
          }
         
        })
        .on('dataLoading', () => this.fire('loading'))
        .on('dataLoad', () => this.fire('load'))
        
      // TODO use full URI
      if (cov.domainProfiles.some(p => p.endsWith('VerticalProfile'))) {
        // we do that outside of the above 'add' handler since we want to register only once,
        // not every time the layer is added to the map
        layer.on('click', () => new ProfilePlot(cov, opts).addTo(map))
      }
        
      if (!firstDisplayed) {
        firstDisplayed = true
        map.addLayer(layer)
      }
      let layerName = i18n(cov.parameters.get(key).observedProperty.label)
      let formatLabel = this.context.distribution.formatImpl.shortLabel
      let fullLayerName = '<span class="label label-success">' + formatLabel + '</span> ' + layerName
      map.layerControl.addOverlay(
          layer, fullLayerName, {groupName: datasetTitle, expanded: true})
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

GeoCoverageView.type = VIEW
