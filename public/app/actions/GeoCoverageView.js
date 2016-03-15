import LayerFactory from 'leaflet-coverage'
import {getLayerClass} from 'leaflet-coverage'
import ParameterSync from 'leaflet-coverage/layers/ParameterSync.js'
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
    let cov = this.cov
    // TODO for collections, parameters have to be defined at collection level
    // see https://github.com/Reading-eScience-Centre/coveragejson/issues/55
    
    // check if leaflet-coverage can directly visualize it
    if (getLayerClass(cov)) {
      return true
    }
    // otherwise, if it's a 1-element collection, check if the single coverage can be visualized
    if (cov.coverages && cov.coverages.length === 1) {
      if (getLayerClass(cov.coverages[0])) {
        return true
      }
    }
    return false
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
    
    let cov = this.cov
    if (!getLayerClass(cov)) {
      if (cov.coverages && cov.coverages.length === 1) {
        cov = cov.coverages[0]
      }
    }
    
    let formatLabel = this.context.distribution.formatImpl.shortLabel
    let layerNamePrefix = '<span class="label label-success">' + formatLabel + '</span> '
    
    // TODO param sync not needed anymore as we use the built-in collection layer classes of leaflet-coverage
    //  -> will this be needed later maybe?
    this.paramSync = new ParameterSync({
      syncProperties: {
        palette: (p1, p2) => p1,
        paletteExtent: (e1, e2) => e1 && e2 ? [Math.min(e1[0], e2[0]), Math.max(e1[1], e2[1])] : null
      }
    }).on('parameterAdd', e => {
        // The virtual sync layer proxies the synced palette, paletteExtent, and parameter.
        // The sync layer will fire a 'remove' event if all real layers for that parameter were removed.
        let layer = e.syncLayer
        if (layer.palette) {
          CoverageLegend(layer, {
            position: 'bottomright'
          }).addTo(map)
        }
      })
    
    // each parameter becomes a layer
    for (let key of cov.parameters.keys()) {
      let opts = {keys: [key]}
      let layerName = i18n(cov.parameters.get(key).observedProperty.label)
      let fullLayerName = layerNamePrefix + layerName
      let layer = this._createLayer(cov, opts)
      map.layerControl.addOverlay(layer, fullLayerName, {groupName: datasetTitle, expanded: true})
      this.layers.push(layer) 
    }
    
    // display the first layer
    let firstLayer = this.layers[0]
    map.addLayer(firstLayer)
  }
  
  _createLayer (cov, opts) {
    let isCollection = cov.coverages
    
    let map = this.context.map
    let layer = LayerFactory()(cov, opts)
      .on('add', e => {
        let covLayer = e.target
        
        // This registers the layer with the sync manager.
        // By doing that, the palette and extent get unified (if existing)
        // and an event gets fired if a new parameter was added.
        // See the code above where ParameterSync gets instantiated.
        this.paramSync.addLayer(covLayer)
        
        if (isCollection) {
          // we could display a time range control for filtering the displayed collection items
          // same for vertical axis where in addition a target value could be chosen
        } else {
          if (covLayer.timeSlices) {
            let timeAxis = new TimeAxis(covLayer)
            timeAxis.addTo(map)
          }
          
          if (covLayer.verticalSlices) {
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
        }
      })
      .on('dataLoading', () => this.fire('loading'))
      .on('dataLoad', () => this.fire('load'))
    

    // we do that outside of the above 'add' handler since we want to register only once,
    // not every time the layer is added to the map
    layer.on('click', ({coverage}) => {
      // TODO use full URI
      if (coverage.domainProfiles.some(p => p.endsWith('VerticalProfile'))) {
        new ProfilePlot(coverage, opts).addTo(map)
      }
    })

    return layer
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
