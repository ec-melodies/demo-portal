import 'sidebar-v2/js/leaflet-sidebar.js'
import 'sidebar-v2/css/leaflet-sidebar.css!'
import 'font-awesome'

import {$} from 'minified'
import {inject} from './util.js'

let html = `
<div id="sidebar" class="sidebar collapsed">
<!-- Nav tabs -->
<div class="sidebar-tabs">
    <ul role="tablist">
        <li><a href="#home" role="tab"><i class="fa fa-bars"></i></a></li>
        <li><a href="#profile" role="tab"><i class="fa fa-user"></i></a></li>
        <li><a href="#settings" role="tab"><i class="fa fa-gear"></i></a></li>
    </ul>
</div>

<!-- Tab panes -->
<div class="sidebar-content">
    <div class="sidebar-pane" id="home">
        <h1 class="sidebar-header">sidebar-v2<div class="sidebar-close"><i class="fa fa-caret-left"></i></div></h1>

        <p>content</p>

    </div>

    <div class="sidebar-pane" id="profile">
        <h1 class="sidebar-header">Profile<div class="sidebar-close"><i class="fa fa-caret-left"></i></div></h1>
    </div>

    <div class="sidebar-pane" id="messages">
        <h1 class="sidebar-header">Messages<div class="sidebar-close"><i class="fa fa-caret-left"></i></div></h1>
    </div>

    <div class="sidebar-pane" id="settings">
        <h1 class="sidebar-header">Settings<div class="sidebar-close"><i class="fa fa-caret-left"></i></div></h1>
    </div>
</div>
</div>
`

// has to come before the map div, otherwise it overlays zoom controls
inject(html, 'prepend')

$('#map').set('+sidebar-map')
