import {$, HTML} from 'minified'
import L from 'leaflet'

import * as CovJSON from 'covjson-reader'
import LayerFactory from 'leaflet-coverage'
import CoverageLegend from 'leaflet-coverage/controls/Legend.js'

import {i18n, fromTemplate, sortByKey} from '../util.js'
import * as wms from '../wms.js'
import ImageLegend from '../ImageLegend.js'

import {getDistFormat, MappableFormats, DataFormats} from './common.js'

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
</template>

<style>
.catalog-url-panel {
  margin-top: 20px;
}
.dataset-spatial-minimap {
  margin-bottom: 10px;
}
</style>
`
$('body').add(HTML(templatesHtml))

let paneHtml = () => `
<h1 class="sidebar-header">Datasets<div class="sidebar-close"><i class="glyphicon glyphicon-menu-left"></i></div></h1>

<div class="panel panel-default catalog-url-panel">
  <div class="panel-heading">
    <h3 class="panel-title">
      <a href="http://json-ld.org/" title="JSON-LD Data"><img width="32" src="http://json-ld.org/images/json-ld-data-32.png" alt="JSON-LD-logo-32"></a>
      <span style="vertical-align:middle">
        <a href="http://www.w3.org/TR/vocab-dcat/">DCAT</a> Catalogue
      </span>
    </h3>
  </div>
  <div class="panel-body catalog-url-info">
    <a href="#" class="catalog-url-edit"><i class="glyphicon glyphicon-pencil"></i></a>
    <a class="catalog-url"></a>
  </div>
  <div class="panel-body catalog-url-form" style="display:none">
    <form>
      <div class="form-group">
        <input type="text" class="form-control" placeholder="http://">
      </div>
      <button type="submit" class="btn btn-default">Load</button>
      <button type="button" name="cancel" class="btn btn-default">Cancel</button>
    </form>
  </div>
</div>

<ul class="list-group dataset-list"></ul>
`

export default class DatasetsPane {
  constructor (sidebar, paneId) {
    this.sidebar = sidebar
    this.id = paneId
    this.map = this.sidebar.map
    this.layerControl = this.sidebar.layerControl
    
    $('#' + paneId).fill(HTML(paneHtml()))
    
    this.catalogue = sidebar.catalogue
    this.analysisCatalogue = sidebar.analysisCatalogue
    
    this._registerUIListeners()
    this._registerModelListeners()
  }
  
  _registerUIListeners () {
    let el = $('#' + this.id)
    let input = $('input', $('.catalog-url-form', el))
    $('.catalog-url-edit', el).on('click', () => {
      $('.catalog-url-info', el).hide()
      $('.catalog-url-form', el).show()
      input.set('value', this.url)
    })
    $('form', $('.catalog-url-form', el)).on('submit', () => {
      this.catalogue.loadFromDCAT(input.get('value')).then(() => {
        $('.catalog-url-info', el).show()
        $('.catalog-url-form', el).hide()
      }).catch(e => {
        console.log(e)
        alert(e)
      })
    })
    $('button', $('.catalog-url-form', el)).filter(b => b.name === 'cancel').on('click', () => {
      $('.catalog-url-info', el).show()
      $('.catalog-url-form', el).hide()
    })
  }
  
  _registerModelListeners () {
    this.catalogue.on('load', ({url}) => {
      $('.dataset-list', '#' + this.id).fill()
      
      this._addDatasets(this.catalogue.datasets)
      
      this.url = url
      $('.catalog-url', '#' + this.id)
        .set('@href', url)
        .fill(url)
    })
  }
  
  _addDatasets (datasets, sortKey='title') {
    datasets = sortByKey(datasets, d => i18n(d[sortKey]))
    for (let dataset of datasets) {
      this._addDataset(dataset)
    }
  }
  
  _addDataset (dataset) {
    let el = fromTemplate('template-dataset-list-item')
    $('.dataset-list', '#' + this.id).add(el)

    let title = i18n(dataset.title)
    let description = i18n(dataset.description)
    
    // TODO switch to .landingPage once https://github.com/ckan/ckanext-dcat/issues/50 is fixed
    //let landingPage = dataset.landingPage
    let landingPage = dataset['dcat:landingPage'] || dataset['landingPage']
    if (landingPage) {
      $('.dataset-title', el).fill(HTML(`<a href="${landingPage}" target="_new" class="external dataset-title">${title}</a>`))
    } else {
      $('.dataset-title', el).fill(title)
    }
    
    $('.dataset-description', el).fill(description)
    
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
    let geom = dataset.spatial && dataset.spatial.geometry ? JSON.parse(dataset.spatial.geometry) : null
    // check if global bounding box and don't display map in that case
    if (geom) {
      let geomLayer = L.geoJson(geom)
      isGlobal = geomLayer.getBounds().equals([[-90, -180], [90, 180]])
    }
    
    if (geom && !isGlobal) {
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
      let formats = new Set(dataset.distributions.map(getDistFormat))
      formats = [...formats]
      formats.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      
      for (let format of formats) {
        if (!format) continue
        let color = MappableFormats.has(format) ? 'success' : 'default'
        let glyph = DataFormats.has(format) ? '<span class="glyphicon glyphicon-flash"></span> ' : ''
        let html
        if (MappableFormats.has(format)) {
          html = HTML(`<a href="#"><span class="label label-success">${glyph}${format}</span></a> `)
          
          // hacky, see https://github.com/timjansen/minified.js/issues/68
          $(html[0]).on('click', () => {
            if (format === 'WMS') {
              this._displayWMS(dataset)
            } else if (format === 'GeoJSON') {
              this._displayGeoJSON(dataset)
            } else if (format === 'CovJSON') {
              this._displayCovJSON(dataset)
            } else {
              throw new Error('should not happen')
            }
          })
        } else {
          html = HTML(`<span class="label label-${color}">${format}</span> `)
        }
        $('.dataset-distribution-labels', el).add(html)
      }
      
      if (formats.some(t => DataFormats.has(t))) {
        $('.dataset-analyse-button', el).show()
        $('.dataset-analyse-button', el).on('click', () => {
          this.analysisCatalogue.addDataset(dataset)
        })
      }
    }
    
  }
  
  // TODO the display code should not be directly in the sidebar module
  _displayWMS (dataset) {
    for (let dist of dataset.distributions.filter(dist => getDistFormat(dist) === 'WMS')) {
      let url = dist['accessURL']
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
          let datasetTitle = i18n(dataset.title)
          this.layerControl.addOverlay(layer, '<span class="label label-success">WMS</span> ' + wmsLayer.title, {groupName: datasetTitle, expanded: true})
        }
        this.map.fire('dataload')
      })
    }
  }
  
  _displayGeoJSON (dataset) {
    let bounds = []
    for (let dist of dataset.distributions.filter(dist => getDistFormat(dist) === 'GeoJSON')) {
      let url = dist['downloadURL'] || dist['accessURL']
      this.map.fire('dataloading')
      $.request('get', url, null, {headers: {
        Accept: 'application/vnd.geo+json; q=1.0,application/json; q=0.5'}})
      .then(json => {
        let layer = L.geoJson(JSON.parse(json), {
          pointToLayer: (feature, latlng) => L.circleMarker(latlng),
          onEachFeature: (feature, layer) => {
            layer.bindPopup(
                '<pre><code class="code-nowrap">' + JSON.stringify(feature.properties, null, 4) + '</code></pre>',
                { maxWidth: 400, maxHeight: 300 })
          }
        })
        bounds.push(layer.getBounds())
        layer.addTo(this.map)
        let distTitle = i18n(dist.title)
        let datasetTitle = i18n(dataset.title)
        this.layerControl.addOverlay(layer, '<span class="label label-success">GeoJSON</span> ' + distTitle, {groupName: datasetTitle, expanded: true})
        this.map.fitBounds(bounds)
        this.map.fire('dataload')
      })
    }
  }
  
  _displayCovJSON (dataset) {
    // TODO check if both CovJSON and CovCBOR exist and prefer CovCBOR in that case (ignore the other)
    for (let dist of dataset.distributions.filter(dist => getDistFormat(dist) === 'CovJSON')) {
      let url = dist['downloadURL'] || dist['accessURL']
      this.map.fire('dataloading')
      // FIXME handle collections
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
          let layerName = i18n(cov.parameters.get(key).observedProperty.label)
          let datasetTitle = i18n(dataset.title)
          this.layerControl.addOverlay(layer, '<span class="label label-success">CovJSON</span> ' + layerName, {groupName: datasetTitle, expanded: true})
        }
        this.map.fire('dataload')
      })
    }
  }
  
}