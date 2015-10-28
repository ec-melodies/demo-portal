import L from 'leaflet'
import 'sidebar-v2/js/leaflet-sidebar.js'
import 'sidebar-v2/css/leaflet-sidebar.css!'
import 'bootstrap/css/bootstrap.css!'

import {$, HTML} from 'minified'

let templatesHtml = `
<template id="template-dataset-list-item">
  <li class="list-group-item">
    <h4 class="list-group-item-heading"><a target="_new" class="external dataset-title"></a></h4>
    <p class="dataset-description"></p>
    <p><i class="glyphicon glyphicon-time"></i> <span class="dataset-temporal"></span></p>
    <p class="dataset-spatial-geometry"><i class="glyphicon glyphicon-globe"></i> <span class="dataset-spatial-geometry-text"></span></p>
    <div class="dataset-spatial-minimap"></div>
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
      </ul>
  </div>
  
  <!-- Tab panes -->
  <div class="sidebar-content">
      <div class="sidebar-pane" id="datasets">
          <h1 class="sidebar-header">Datasets<div class="sidebar-close"><i class="glyphicon glyphicon-menu-left"></i></div></h1>
  
          <ul class="list-group dataset-list"></ul>
      </div>
  </div>
</div>
`

export default class Sidebar {
  constructor (map, id='sidebar') {
    this.id = id
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
    $('.dataset-title', el).fill(dataset.title)
    $('.dataset-title', el).set('@href', dataset['@id'])
    $('.dataset-description', el).fill(dataset.description)
    
    let temporal
    if (dataset.temporal) {
      temporal = dataset.temporal.startDate.substr(0,10) + ' to ' + dataset.temporal.endDate.substr(0,10)
    } else {
      temporal = 'unknown'
    }
    $('.dataset-temporal', el).fill(temporal)
    
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
      $('.dataset-spatial-geometry-text', el).fill(isGlobal ? 'global' : 'unknown')
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
