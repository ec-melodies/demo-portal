import L from 'leaflet'
import 'leaflet/dist/leaflet.css!'
import 'leaflet-loading'
import 'leaflet-loading/src/Control.Loading.css!'
import 'bootstrap/css/bootstrap.css!'
import {promises as jsonld} from 'jsonld'

import Sidebar from './sidebar.js'
import './style.css!'

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

let baseLayers = {
  'OSM':
    L.tileLayer('http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
       attribution: 'Map data &copy; <a href="http://www.osm.org">OpenStreetMap</a>'
    })
}
baseLayers['OSM'].addTo(map)

let sidebar = new Sidebar(map)

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
