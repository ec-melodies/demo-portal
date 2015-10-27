import L from 'leaflet'
import 'leaflet/dist/leaflet.css!'
import 'leaflet-loading'
import 'leaflet-loading/src/Control.Loading.css!'
import {$} from 'minified'

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