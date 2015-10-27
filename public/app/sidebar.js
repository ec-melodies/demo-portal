import 'sidebar-v2/js/leaflet-sidebar.js'
import 'sidebar-v2/css/leaflet-sidebar.css!'
import 'font-awesome'

import {$} from 'minified'
import {inject} from './util.js'

const html = `
<div id="sidebar" class="sidebar collapsed">
<!-- Nav tabs -->
<div class="sidebar-tabs">
    <ul role="tablist">
        <li><a href="#datasets" role="tab"><i class="fa fa-bars"></i></a></li>
    </ul>
</div>

<!-- Tab panes -->
<div class="sidebar-content">
    <div class="sidebar-pane" id="datasets">
        <h1 class="sidebar-header">Datasets<div class="sidebar-close"><i class="fa fa-caret-left"></i></div></h1>

        <span id="datasets-list"></span>

    </div>
</div>
</div>
`

// has to come before the map div, otherwise it overlays zoom controls
inject(html, 'prepend')

$('#map').set('+sidebar-map')
