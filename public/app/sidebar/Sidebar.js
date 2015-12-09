import L from 'leaflet'
import 'sidebar-v2/js/leaflet-sidebar.js'
import 'sidebar-v2/css/leaflet-sidebar.css!'
import 'bootstrap/css/bootstrap.css!'
import {$, HTML} from 'minified'

import DatasetsPane from './DatasetsPane.js'
import AnalysePane from './AnalysePane.js'

let sidebarHtml = (sidebarId, datasetsPaneId, analysePaneId) => `
<div id="${sidebarId}" class="sidebar collapsed">
  <!-- Nav tabs -->
  <div class="sidebar-tabs">
      <ul role="tablist">
          <li><a href="#${datasetsPaneId}" role="tab" class="sidebar-tab"><i class="glyphicon glyphicon-align-justify"></i></a></li>
          <li><a href="#${analysePaneId}" role="tab" class="sidebar-tab"><i class="glyphicon glyphicon-flash"></i></a></li>
      </ul>
  </div>
  
  <!-- Tab panes -->
  <div class="sidebar-content">
      <div class="sidebar-pane" id="${datasetsPaneId}"></div>
      <div class="sidebar-pane" id="${analysePaneId}"></div>
  </div>
</div>
<style>
.error-item {
  word-wrap: break-word;
}
`

export default class Sidebar {
  constructor (map, {app, sidebarId='sidebar', datasetsPaneId='datasets', analysePaneId='analyse', layerControl=null}={}) {
    this.map = map
    this.app = app
    this.catalogue = app.catalogue
    this.workspace = app.workspace
    this.id = sidebarId
    this.layerControl = layerControl
    // has to come before the map div, otherwise it overlays zoom controls
    $('body').addFront(HTML(sidebarHtml(sidebarId, datasetsPaneId, analysePaneId)))
    
    $('#' + map.getContainer().id).set('+sidebar-map')
    this.control = L.control.sidebar(sidebarId).addTo(map)
        
    this.panes = {
      Datasets: new DatasetsPane(this, datasetsPaneId),
      Analyse: new AnalysePane(this, analysePaneId)
    }
  }
  
  open (tabId) {
    this.control.open(tabId)
  }
}


