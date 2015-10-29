import 'bootstrap/css/bootstrap.css!'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css!'
import 'leaflet-loading'
import 'leaflet-loading/src/Control.Loading.css!'
import 'leaflet-styledlayercontrol'
import {promises as jsonld} from 'jsonld'

import Sidebar from './sidebar.js'
import './css/style.css!'
import './css/styledLayerControl/styledLayerControl.css!'

const DCAT_CATALOG_URL = 'http://ckan-demo.melodiesproject.eu'
const DCAT_CATALOG_FRAME = {
  "@context": [
    "https://rawgit.com/ec-melodies/wp02-dcat/master/context.jsonld",
    { // override since we want the GeoJSON geometry, not the WKT one
      "geometry": { 
        "@id": "locn:geometry", 
        "@type": "https://www.iana.org/assignments/media-types/application/vnd.geo+json"
      }
    }
  ],
  "@type": "Catalog"
}

let map = L.map('map', {
  loadingControl: true,
  // initial center and zoom has to be set before layers can be added
  center: [10, 0],
  zoom: 2
})

// Layer control and base layer setup
let osm = L.tileLayer('http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: 'Map data &copy; <a href="http://www.osm.org">OpenStreetMap</a>'
})
osm.addTo(map)

let baseMaps = [{
  groupName: 'Base Maps',
  expanded: true,
  layers: {
    'OpenStreetMap': osm
  }
}]

let layerControl = L.Control.styledLayerControl(baseMaps, [], {
  container_width     : "300px",
  container_maxHeight : "500px",
  collapsed: false
})
map.addControl(layerControl)

// Sidebar setup
let sidebar = new Sidebar(map, {layerControl})

jsonld.frame(DCAT_CATALOG_URL, DCAT_CATALOG_FRAME)
.then(framed => jsonld.compact(framed, framed['@context']))
.then(compacted => {
  let datasets = compacted.datasets
  console.log(datasets)
  sidebar.addDatasets(datasets)
  sidebar.open('datasets')
}).catch(e => {
  alert('Error: ' + e)
})
