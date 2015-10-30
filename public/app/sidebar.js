import L from 'leaflet'
import 'sidebar-v2/js/leaflet-sidebar.js'
import 'sidebar-v2/css/leaflet-sidebar.css!'
import 'bootstrap/css/bootstrap.css!'
import {$, HTML} from 'minified'

import * as CovJSON from 'covjson-reader'
import LayerFactory from 'leaflet-coverage'
import CoverageLegend from 'leaflet-coverage/controls/Legend.js'

import * as wms from './wms.js'
import ImageLegend from './ImageLegend.js'

const MediaTypes = {
    CovJSON: 'application/prs.coverage+json',
    netCDF: 'application/x-netcdf'
}
/** Formats we can visualize on a map */
const MappableFormats = new Set(['WMS', 'GeoJSON', MediaTypes.CovJSON])

/** Formats we can do data processing on */
const DataFormats = new Set(['GeoJSON', MediaTypes.CovJSON])

/** Short label for media types that CKAN doesn't know (otherwise we can use .format) */
function getFormatLabel (formatOrMediaType) {
  for (let key in MediaTypes) {
    if (MediaTypes[key] === formatOrMediaType) {
      return key
    }
  }
  return formatOrMediaType
}

let templatesHtml = `
<template id="template-dataset-list-item">
  <li class="list-group-item">
    <h4 class="list-group-item-heading dataset-title"></h4>
    <p class="dataset-publisher"></p>
    <p class="dataset-distribution-labels"></p>
    <p class="dataset-description"></p>
    <p class="dataset-temporal"><i class="glyphicon glyphicon-time"></i> <span class="dataset-temporal-text"></span></p>
    <p class="dataset-spatial-geometry"><i class="glyphicon glyphicon-globe"></i> <span class="dataset-spatial-geometry-text"></span></p>
    <div class="dataset-spatial-minimap"></div>
    <button type="button" class="btn btn-success dataset-analyse-button" style="display:none">
      <span class="glyphicon glyphicon-flash" aria-hidden="true"></span> Analyse
    </button>
  </li>
</template
`
$('body').add(HTML(templatesHtml))

let sidebarHtml = id => `
<div id="${id}" class="sidebar collapsed">
  <!-- Nav tabs -->
  <div class="sidebar-tabs">
      <ul role="tablist">
          <li><a href="#datasets" role="tab"><i class="glyphicon glyphicon-align-justify"></i></a></li>
          <li><a href="#analyse" role="tab"><i class="glyphicon glyphicon-flash"></i></a></li>
      </ul>
  </div>
  
  <!-- Tab panes -->
  <div class="sidebar-content">
      <div class="sidebar-pane" id="datasets">
          <h1 class="sidebar-header">Datasets<div class="sidebar-close"><i class="glyphicon glyphicon-menu-left"></i></div></h1>
  
          <ul class="list-group dataset-list"></ul>
      </div>
      <div class="sidebar-pane" id="analyse">
          <h1 class="sidebar-header">Analyse<div class="sidebar-close"><i class="glyphicon glyphicon-menu-left"></i></div></h1>
    
          
      </div>
  </div>
</div>
`

export default class Sidebar {
  constructor (map, {id='sidebar', layerControl=null}={}) {
    this.map = map
    this.id = id
    this.layerControl = layerControl
    // has to come before the map div, otherwise it overlays zoom controls
    $('body').addFront(HTML(sidebarHtml(id)))
    
    $('#' + map.getContainer().id).set('+sidebar-map')
    this.control = L.control.sidebar(id).addTo(map)
  }
  
  addDatasets (datasets, sortKey='title') {
    datasets = sortByKey(datasets, sortKey)
    for (let dataset of datasets) {
      this.addDataset(dataset)
    }
  }
  
  addDataset (dataset) {
    let el = fromTemplate('template-dataset-list-item')
    $('.dataset-list', '#' + this.id).add(el)

    // TODO switch to .landingPage once https://github.com/ckan/ckanext-dcat/issues/50 is fixed
    //let landingPage = dataset.landingPage
    let landingPage = dataset['dcat:landingPage']
    if (landingPage) {
      $('.dataset-title', el).fill(HTML(`<a href="${landingPage}" target="_new" class="external dataset-title">${dataset.title}</a>`))
    } else {
      $('.dataset-title', el).fill(dataset.title)
    }
    
    $('.dataset-description', el).fill(dataset.description)
    
    if (dataset.publisher) {
      // TODO switch to .homepage once https://github.com/ckan/ckanext-dcat/issues/50 is fixed
      //let homepage = dataset.publisher.homepage
      let homepage = dataset.publisher['foaf:homepage']
      if (homepage) {
        $('.dataset-publisher', el).fill(HTML(`<a class="external" href="${homepage}"><em>${dataset.publisher.name}</em></a>`))
      } else {
        $('.dataset-publisher', el).fill(HTML(`<em>${dataset.publisher.name}</em>`))
      }
    } else {
      $('.dataset-publisher', el).hide()
    }
    
    if (dataset.temporal) {
      let temporal = dataset.temporal.startDate.substr(0,10) + ' to ' + dataset.temporal.endDate.substr(0,10)
      $('.dataset-temporal-text', el).fill(temporal)
    } else {
      $('.dataset-temporal', el).hide()
    }
    
    let isGlobal
    let geom = dataset.spatial ? JSON.parse(dataset.spatial.geometry) : null
    // check if global bounding box and don't display map in that case
    if (geom) {
      let geomLayer = L.geoJson(geom)
      isGlobal = geomLayer.getBounds().equals([[-90, -180], [90, 180]])
    }
    
    if (dataset.spatial && !isGlobal) {
      $('.dataset-spatial-geometry', el).hide()
      
      let map = L.map($('.dataset-spatial-minimap', el)[0], {
        touchZoom: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        zoomControl: false,
        attributionControl: false
      }).on('load', () => {
        L.tileLayer('http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map)
      })
      
      setTimeout(() => {
        let geomLayer = L.geoJson(geom, {
          style: () => ({color: "#ff7800", weight: 1, clickable: false})
        })
        map.fitBounds(geomLayer.getBounds(), {reset: true})
        geomLayer.addTo(map)
      }, 1000)

    } else {
      $('.dataset-spatial-minimap', el).hide()
      if (isGlobal) {
        $('.dataset-spatial-geometry-text', el).fill('global')
      } else {
        $('.dataset-spatial-geometry', el).hide()
      }
    }
    
    if (dataset.distributions) {
      let types = new Set(dataset.distributions.map(dist => dist.format ? dist.format : dist.mediaType))
      types = [...types]
      types.sort((a, b) => getFormatLabel(a).toLowerCase().localeCompare(getFormatLabel(b).toLowerCase()))
      
      for (let type of types) {
        if (!type) continue
        let color = MappableFormats.has(type) ? 'success' : 'default'
        let glyph = DataFormats.has(type) ? ' <span class="glyphicon glyphicon-flash"></span>' : ''
        let html
        if (MappableFormats.has(type)) {
          html = HTML(`<a href="#"><span class="label label-success">${getFormatLabel(type)}${glyph}</span></a> `)
          
          // hacky, see https://github.com/timjansen/minified.js/issues/68
          $(html[0]).on('click', () => {
            if (type === 'WMS') {
              this._displayWMS(dataset)
            } else if (type === 'GeoJSON') {
              this._displayGeoJSON(dataset)
            } else if (type === MediaTypes.CovJSON) {
              this._displayCovJSON(dataset)
            } else {
              throw new Error('should not happen')
            }
          })
        } else {
          html = HTML(`<span class="label label-${color}">${getFormatLabel(type)}</span> `)
        }
        $('.dataset-distribution-labels', el).add(html)
      }
      
      if (types.some(t => DataFormats.has(t))) {
        $('.dataset-analyse-button', el).show()
      }
    }
    
  }
  
  // TODO the display code should not be directly in the sidebar module
  _displayWMS (dataset) {
    for (let dist of dataset.distributions.filter(dist => dist.format === 'WMS')) {
      // TODO remove dcat: once ckanext-dcat is fixed
      let url = dist['dcat:accessURL']
      this.map.fire('dataloading')
      wms.readLayers(url).then(wmsLayers => {
        for (let wmsLayer of wmsLayers) {
          let layer = L.tileLayer.wms(url, {
            layers: wmsLayer.name,
            format: 'image/png',
            transparent: true
          })
          // In leaflet 1.0 every layer will have add/remove events, this is a workaround
          this.map.on('layeradd', e => {
            if (e.layer !== layer) return
            let legendUrl = wms.getLegendUrl(url, wmsLayer.name)
            new ImageLegend(legendUrl, {layer: e.layer, title: wmsLayer.title}).addTo(this.map)
          })
          this.layerControl.addOverlay(layer, 'WMS: ' + wmsLayer.title, {groupName: dataset.title, expanded: true})
        }
        this.map.fire('dataload')
      })
    }
  }
  
  _displayGeoJSON (dataset) {
    let bounds = []
    for (let dist of dataset.distributions.filter(dist => dist.format === 'GeoJSON')) {
      // TODO remove dcat: once ckanext-dcat is fixed
      let url = dist['dcat:accessURL'] || dist['dcat:downloadURL']
      this.map.fire('dataloading')
      $.request('get', url).then(json => {
        let layer = L.geoJson(JSON.parse(json), {
          onEachFeature: (feature, layer) => {
            layer.bindPopup(
                '<pre><code class="code-nowrap">' + JSON.stringify(feature.properties, null, 4) + '</code></pre>',
                { maxWidth: 400, maxHeight: 300 })
          }
        })
        bounds.push(layer.getBounds())
        layer.addTo(this.map)
        this.layerControl.addOverlay(layer, 'GeoJSON: ' + dist.title, {groupName: dataset.title, expanded: true})
        this.map.fitBounds(bounds)
        this.map.fire('dataload')
      })
    }
  }
  
  _displayCovJSON (dataset) {
    for (let dist of dataset.distributions.filter(dist => dist.mediaType === MediaTypes.CovJSON)) {
      // TODO remove dcat: once ckanext-dcat is fixed
      let url = dist['dcat:downloadURL']
      this.map.fire('dataloading')
      CovJSON.read(url).then(cov => {
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
          let layername = cov.parameters.get(key).observedProperty.label.get('en')
          this.layerControl.addOverlay(layer, 'CovJSON: ' + layername, {groupName: dataset.title, expanded: true})
        }
        this.map.fire('dataload')
      })
    }
  }
  
  open (tabId) {
    this.control.open(tabId)
  }
}

function fromTemplate (id) {
  return document.importNode($('#' + id)[0].content, true).children[0]
}

function sortByKey(array, key) {
  return array.sort((a, b) => {
    let x = a[key]
    let y = b[key]
    return ((x < y) ? -1 : ((x > y) ? 1 : 0))
  })
}
