import 'core-js/fn/string/starts-with.js'
import 'core-js/fn/string/ends-with.js'
import 'core-js/fn/array/find.js'
import 'core-js/es6/promise.js'

import 'bootstrap/css/bootstrap.css!'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css!'
import 'leaflet-providers'
import 'leaflet-loading'
import 'leaflet-loading/src/Control.Loading.css!'
import 'leaflet-styledlayercontrol'

import App from './App.js'
import Sidebar from './sidebar/Sidebar.js'
import './css/style.css!'
import './css/styledLayerControl/styledLayerControl.css!'

// Xmas magic
import {$,HTML} from 'minified'
import './css/snow.css!'
$('body').add(HTML(`
  <div id="snow1" class="snow"></div>
  <div id="snow2" class="snow"></div>
  <div id="snow3" class="snow"></div>
`))
function letItSnow() {
  for (let node of document.querySelectorAll('.snow')) {
    if (node.style.opacity === '1') setTimeout(() => node.style.display = 'none', 3500)
    else node.style.display = 'block'
    setTimeout(() => node.style.opacity = node.style.opacity === '1' ? '0' : '1', 100)      
  }
}
document.getElementById('map').addEventListener('keypress', e => {
  if (String.fromCharCode(e.charCode) == 's') letItSnow()
}, false);
if (new Date('2015-12-22') <= new Date() && new Date() <= new Date('2016-01-03'))
  letItSnow()
// end of Xmas magic
  
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
baseLayers[baseLayerLabels['MapQuestOpen.Aerial']].addTo(map)

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
// probably not the best idea
map.layerControl = layerControl

let app = new App(map)
app.on('dataLoading', () => map.fire('dataloading'))
app.on('dataLoad', () => map.fire('dataload'))

// Sidebar setup
let catalogUrl
if (window.location.hash) {
  let url = window.location.hash.substr(1)
  if (url.toLowerCase().startsWith('http://') || url.toLowerCase().startsWith('https://')) {
    catalogUrl = url
  }
}
if (!catalogUrl) {
  catalogUrl = MELODIES_DCAT_CATALOG_URL
}

let sidebar = new Sidebar(map, {app, layerControl})
app.catalogue.loadFromDCAT(catalogUrl).then(() => {
  sidebar.open(sidebar.panes.Search)
}).catch(() => {
  sidebar.open(sidebar.panes.Search)
})
