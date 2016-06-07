import 'core-js/fn/string/starts-with.js'
import 'core-js/fn/string/ends-with.js'
import 'core-js/fn/array/find.js'
import 'core-js/es6/promise.js'

import {stringQs} from 'qs-hash'

import 'bootstrap/css/bootstrap.css!'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css!'
import 'leaflet-providers'
import 'leaflet-loading'
import 'leaflet-loading/src/Control.Loading.css!'

import DraggableValuePopup from 'leaflet-coverage/popups/DraggableValuePopup.js'

import {i18n, DefaultMap, MELODIES_DCAT_CATALOG_URL} from './util.js'
import App from './App.js'
import Sidebar from './sidebar/Sidebar.js'
import './css/style.css!'

import './styledLayerControl.js'
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
let year = new Date().getFullYear()
if (new Date(year + '-12-22') <= new Date() && new Date() <= new Date(year + '-01-03'))
  letItSnow()
// end of Xmas magic

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

/**
 * Proxy around StyledLayerControl that keeps track of groups and layers
 * to allow some added features:
 * - once a group has no layers anymore, it gets removed
 * - allow renaming of groups by re-adding them under the new name
 */
class SmartLayerControl {
  constructor(styledLayerControl) {
    this._control = styledLayerControl
    this._groups = new DefaultMap(() => [])
    this._layers = new Map()
  }
  addOverlay (layer, name, options) {
    let groupName = options.groupName
    this._groups.get(groupName).push({layer, name})
    this._layers.set(layer, groupName)
    this._control.addOverlay(layer, name, options)
  }
  removeLayer (layer) {
    this._control.removeLayer(layer)
    let groupName = this._layers.get(layer)
    this._layers.delete(layer)
    let group = this._groups.get(groupName)
    let newGroup = group.filter(obj => obj.layer !== layer)
    this._groups.set(groupName, newGroup)
    if (newGroup.length === 0) {
      this._control.removeGroup(groupName)
      this._groups.delete(groupName)
    }
  }
  renameGroup (oldName, newName) {
    for (let {layer, name} of this._groups.get(oldName).slice()) {
      this.removeLayer(layer)
      this.addOverlay(layer, name, {groupName: newName, expanded: true})
    }
  }
  getLayers () {
    return [...this._layers.keys()]
  }
}
map.layerControl = new SmartLayerControl(layerControl)

map.on('click', e => {
  new DraggableValuePopup({
    layers: map.layerControl.getLayers(),
    className: 'leaflet-popup-draggable'
  }).setLatLng(e.latlng).openOn(map)
})


let app = new App(map)
app.on('dataLoading', () => map.fire('dataloading'))
app.on('dataLoad', () => map.fire('dataload'))
app.workspace.on('titleChange', ({oldTitle, newTitle}) => {
  // by convention, group names are dataset titles
  map.layerControl.renameGroup(i18n(oldTitle), i18n(newTitle))
})

// Sidebar setup
let catalogUrl

function handleHash (first) {
  if (window.location.hash) {
    let hash = window.location.hash.substr(1)
    let params = stringQs(hash)
    if (params.url) {
      if (params.url.toLowerCase().startsWith('http://') || params.url.toLowerCase().startsWith('https://')) {
        if (app.catalogue.url !== params.url) {
          catalogUrl = params.url
          if (!first) {
            app.catalogue.loadFromDCAT(catalogUrl) 
          }
        }
      }
    }
    if (params.map) {
      let [zoom,lat,lon] = params.map.split('/').map(parseFloat)
      map.setView([lat, lon], zoom)
    }
  }
}
handleHash(true)

window.addEventListener('hashchange', () => handleHash(false), false)

if (!catalogUrl) {
  catalogUrl = MELODIES_DCAT_CATALOG_URL
}

let sidebar = new Sidebar(map, {app, layerControl})
app.catalogue.loadFromDCAT(catalogUrl).then(() => {
  sidebar.open(sidebar.panes.Search)
}).catch(() => {
  sidebar.open(sidebar.panes.Search)
})

window.api = {map}
