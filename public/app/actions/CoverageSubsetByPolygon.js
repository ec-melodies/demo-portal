import L from 'leaflet'
import {$,$$, HTML} from 'minified'
import Modal from 'bootstrap-native/lib/modal-native.js'

import * as transformUtil from 'leaflet-coverage/util/transform.js'
import * as referencingUtil from 'leaflet-coverage/util/referencing.js'
import {COVJSON_GRID} from 'leaflet-coverage/util/constants.js'

import {i18n} from '../util.js'
import GeoJSON from '../formats/GeoJSON.js'
import {default as Action, PROCESS} from './Action.js'

let html = `
<div class="modal fade" id="geojsonSelectModal" tabindex="-1" role="dialog" aria-labelledby="geojsonSelectModalLabel">
  <div class="modal-dialog" role="document">
    <div class="modal-content">
      <div class="modal-header">
        <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
        <h4 class="modal-title" id="geojsonSelectModalLabel">Select a GeoJSON resource</h4>
      </div>
      <div class="modal-body">
        <div class="panel panel-primary remap-remapping-distributions">
          <div class="panel-heading">
            <h4>Select the GeoJSON resource containing the subsetting polygon</h4>
          </div>
          <div class="panel-body">
            <p>
              Only those GeoJSON resources are shown which contain at least one (multi)polygon.
              After selecting a GeoJSON resource, all polygons will be displayed on the map
              and you can pick the one that should be used for subsetting.
            </p>
            <div class="alert alert-info geojson-distribution-list-empty" role="alert"><strong>None found.</strong></div>
          </div>
          <ul class="list-group geojson-distribution-list"></ul>
        </div>
               
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>
      </div>
    </div>
  </div>
</div>
`
$('body').add(HTML(html))

const TEMPLATES = {
  'geojson-distribution-item': `
  <li class="list-group-item">
    <h4 class="list-group-item-heading dataset-title"></h4>
    <p>Distribution: <span class="distribution-title"></span></p>
    <p>Polygons: <span class="polygon-count"></span></p>
    
    <button type="button" class="btn btn-primary select-button" data-dismiss="modal">
      Select
    </button>
  </li>
  `
}

export default class CoverageSubsetByPolygon extends Action {
  constructor (data, context) {
    super(context)
    
    if (this._isSingleCoverage(data)) {
      this.cov = this._getSingleCoverage(data)
    } else {
      this.cov = data
    }
    
    this.label = 'Polygon Subset'
    this.icon = '<span class="glyphicon glyphicon-scissors"></span>'
  }
  
  // TODO code duplication with CoverageRemapCategories.js
  get isSupported () {
    // data is single grid coverage
    if (this._isSingleCoverage(this.cov) && this.cov.domainProfiles.indexOf(COVJSON_GRID) !== -1) {
      return true
    }
    return false
  }
  
  _isSingleCoverage (cov) {
    try {
      this._getSingleCoverage(cov)
      return true
    } catch (e) {
      return false
    }
  }
  
  _getSingleCoverage (cov) {
    if (!cov.coverages) {
      return cov
    } else if (cov.coverages.length === 1) {
      return cov.coverages[0]
    } else {
      throw new Error('not a single coverage')
    }
  }
  
  run () {
    // Step 1: display modal for selecting a GeoJSON distribution
    // Step 2: let user select one of the contained polygon features
    //         (or skip if only a single feature)
    
    let modalEl = $('#geojsonSelectModal')
    let geojsonDists = this._findGeoJSONDistributions()
    
    $('.geojson-distribution-list', modalEl).fill()
    for (let {distribution,dataset} of geojsonDists) {
      let el = $(HTML(TEMPLATES['geojson-distribution-item']))
      
      $('.dataset-title', el).fill(i18n(dataset.title))
      $('.distribution-title', el).fill(i18n(distribution.title))
      
      let polygonCount = getPolygonFeatures(distribution.data).length
      $('.polygon-count', el).fill(polygonCount)
      
      $('.select-button', el).on('|click', () => {
        this._displayPolygons(distribution)
      })
            
      $('.geojson-distribution-list', modalEl).add(el)
    }
    
    $$('.geojson-distribution-list-empty', modalEl).style.display = geojsonDists.length > 0 ? 'none' : 'block'
    
    new Modal(modalEl[0]).open()
  }
  
  _displayPolygons (distribution) {
    let features = {
        type: 'FeatureCollection',
        features: getPolygonFeatures(distribution.data)
    }
    let map = this.context.map
    
    // copied from GeoJSONView
    let color = '#CC2222'
    let defaultStyle = {
      color: color,
      weight: 2,
      opacity: 0.6,
      fillOpacity: 0,
      fillColor: color
    }
    
    let highlightStyle = {
      color: color, 
      weight: 3,
      opacity: 0.6,
      fillOpacity: 0.65,
      fillColor: color
    }
    
    let mouseoverFn = e => {
      e.target.setStyle(highlightStyle)
    }
    
    let mouseoutFn = e => {
      e.target.setStyle(defaultStyle)
    }
    
    var featuresLayer = L.geoJson(features, {
      onEachFeature: (feature, layer) => {
        layer.setStyle(defaultStyle)
        layer.on('mouseover', mouseoverFn)
        layer.on('mouseout', mouseoutFn)
        layer.on('click', () => {
          this._applySubsetAndCreateVirtualDataset(feature)
          map.removeLayer(featuresLayer)
        })
      }
    }).addTo(map)
    map.fitBounds(featuresLayer.getBounds())
    
  }
  
  _applySubsetAndCreateVirtualDataset (feature) {
    let appendTitle = ' [subsetted by polygon]'
    
    this.fire('loading')
    let bbox = L.geoJson(feature).getBounds()
    transformUtil.subsetByBbox(this.cov, [bbox.getWest(), bbox.getSouth(), bbox.getEast(), bbox.getNorth()]).then(bboxSubsetCov => {
      transformUtil.maskByPolygon(bboxSubsetCov, feature.geometry).then(polySubsetCov => {
        let virtualDataset = {
          title: { en: i18n(this.context.dataset.title) + appendTitle },
          virtual: true,
          distributions: [{
            title: { en: i18n(this.context.distribution.title) + appendTitle },
            mediaType: 'coveragedata',
            data: polySubsetCov
          }]
        }
        let workspace = this.context.workspace
                
        workspace.addDataset(virtualDataset, this.context.dataset)
        workspace.requestFocus(virtualDataset)
        
        this.fire('load')
      })
    })
  }
  
  _findGeoJSONDistributions () {
    return this.context.workspace.filterDistributions(dist => {
      if (!(dist.formatImpl instanceof GeoJSON)) return false
      return getPolygonFeatures(dist.data).length > 0
    })
  }
  
}

function getPolygonFeatures (geojson) {
  let features = [] // array of GeoJSON feature objects with (Multi)Polygon geometries 
  switch (geojson.type) {
  case 'Polygon':
  case 'MultiPolygon':
    features.push({
      type: 'Feature',
      geometry: geojson
    })
    break
  case 'Feature':
    switch (geojson.geometry.type) {
    case 'Polygon':
    case 'MultiPolygon':
      features.push(geojson)
      break
    }
    break
  case 'FeatureCollection':
    for (let feature of geojson.features) {
      switch (feature.geometry.type) {
      case 'Polygon':
      case 'MultiPolygon':
        features.push(feature)
        break
      }
    }
  }
  return features
}

CoverageSubsetByPolygon.type = PROCESS
