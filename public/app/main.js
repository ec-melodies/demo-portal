import 'bootstrap/css/bootstrap.css!'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css!'
import 'leaflet-providers'
import 'leaflet-loading'
import 'leaflet-loading/src/Control.Loading.css!'
import 'leaflet-styledlayercontrol'

import Sidebar from './sidebar.js'
import './css/style.css!'
import './css/styledLayerControl/styledLayerControl.css!'

const MELODIES_DCAT_CATALOG_URL = 'http://ckan-demo.melodiesproject.eu'

let map = L.map('map', {
  loadingControl: true,
  // initial center and zoom has to be set before layers can be added
  center: [10, 0],
  zoom: 2
})

// Layer control and base layer setup
var baseLayerLabels = {
  'Hydda.Base': 'Hydda',
  'OpenStreetMap': 'OpenStreetMap',
  'OpenStreetMap.BlackAndWhite': 'OpenStreetMap (B/W)',
  'OpenTopoMap': 'OpenTopoMap',
  'MapQuestOpen.Aerial': 'MapQuestOpen Aerial'  
}

var baseLayers = {}
for (let id in baseLayerLabels) {
  let layer = L.tileLayer.provider(id)
  baseLayers[baseLayerLabels[id]] = layer
}
baseLayers[baseLayerLabels['OpenStreetMap']].addTo(map)

let baseMaps = [{
  groupName: 'Base Maps',
  expanded: true,
  layers: baseLayers
}]

let layerControl = L.Control.styledLayerControl(baseMaps, [], {
  container_width     : "300px",
  container_maxHeight : "500px",
  collapsed: false
})
map.addControl(layerControl)

// Sidebar setup
let catalogUrl
if (window.location.hash) {
  catalogUrl = window.location.hash.substr(1)
} else {
  catalogUrl = MELODIES_DCAT_CATALOG_URL
}

let sidebar = new Sidebar(map, {layerControl})
sidebar.loadCatalog(catalogUrl).then(() => {
  sidebar.open('datasets')
})
