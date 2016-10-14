import {$, HTML} from 'minified'
import L from 'leaflet'
import parseWKT from 'wellknown'
import Modal from 'bootstrap-native/lib/modal-native.js'
import Tab from 'bootstrap-native/lib/tab-native.js'

import {PROCESS} from '../actions/Action.js'
import {i18n, sortByKey, MELODIES_DCAT_CATALOG_URL} from '../util.js'
import {loadDCATCatalog} from '../dcat.js'

const TEMPLATES = {
  'dataset-list-item': `
  <li class="list-group-item">
    <h4 class="list-group-item-heading dataset-title"></h4>
    <p class="dataset-publisher"></p>
    <p class="dataset-distribution-labels"></p>
    <p class="dataset-description"></p>
    <p class="dataset-temporal"><i class="glyphicon glyphicon-time"></i> <span class="dataset-temporal-text"></span></p>
    <p class="dataset-spatial-geometry"><i class="glyphicon glyphicon-globe"></i> <span class="dataset-spatial-geometry-text"></span></p>
    <div class="dataset-spatial-minimap"></div>
    <button type="button" class="btn btn-success dataset-analyse-button" style="display:none">
      <span class="glyphicon glyphicon-flash" aria-hidden="true"></span> Add to Workspace
    </button>
  </li>
  `,
  'dataset-error': `
  <li class="list-group-item list-group-item-danger error-item">
    <h4 class="list-group-item-heading dataset-title">Problem while loading catalogue</h4>
    <p>Error: <em class="error-message"></em></p>
    <p>Details:</p>
    <small><pre class="error-details"></pre></small>
  </li>
  `
}
let html = `
<div class="modal fade" id="dcatSourceModal" tabindex="-1" role="dialog" aria-labelledby="dcatSourceModalLabel">
  <div class="modal-dialog modal-lg" role="document">
    <div class="modal-content">
      <div class="modal-header">
        <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
        <h4 class="modal-title" id="dcatSourceModalLabel">DCAT Source View</h4>
      </div>
      <div class="modal-body">
        <!-- Nav tabs -->
        <ul class="nav nav-tabs" role="tablist">
          <li role="presentation" class="active"><a href="#dcat-original" role="tab" data-toggle="tab">Original</a></li>
          <li role="presentation"><a href="#dcat-framed" role="tab" data-toggle="tab">Framed</a></li>
          <li role="presentation"><a href="#dcat-frame" role="tab" data-toggle="tab">Frame</a></li>
        </ul>
  
        <!-- Tab panes -->
        <div class="tab-content">
          <div role="tabpanel" class="tab-pane active" id="dcat-original">
            <pre><code class="dcat-original"></code></pre>
          </div>
          <div role="tabpanel" class="tab-pane" id="dcat-framed">
            <pre><code class="dcat-framed"></code></pre>
          </div>
          <div role="tabpanel" class="tab-pane" id="dcat-frame">
            <pre><code class="dcat-frame"></code></pre>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>
      </div>
    </div>
  </div>
</div>

<style>
.catalog-url-panel {
  margin-top: 20px;
}
.dataset-spatial-minimap {
  margin-bottom: 10px;
}
.catalog-load-default {
  padding-top: 0;
}
</style>
`
$('body').add(HTML(html))

let paneHtml = () => `
<h1 class="sidebar-header">Search<div class="sidebar-close"><i class="glyphicon glyphicon-menu-left"></i></div></h1>

<div class="panel panel-default catalog-url-panel">
  <div class="panel-heading">
    <h3 class="panel-title">
      <a href="http://json-ld.org/" title="JSON-LD Data"><img width="32" src="http://json-ld.org/images/json-ld-data-32.png" alt="JSON-LD-logo-32"></a>
      <span style="vertical-align:middle">
        <a href="http://www.w3.org/TR/vocab-dcat/">DCAT</a> Catalogue
      </span>
      <button type="button" class="btn btn-primary pull-right jsonld-view-button"><i class="glyphicon glyphicon-eye-open"></i> JSON-LD</button>
    </h3>
  </div>
  <div class="panel-body catalog-url-info">
    <a href="#" class="catalog-url-edit"><i class="glyphicon glyphicon-pencil"></i></a>
    <a class="catalog-url"></a>
  </div>
  <div class="panel-body catalog-load-default" style="display:none">
    <button type="button" name="load-default" class="btn btn-primary">Load MELODIES Catalogue</button>
  </div>
  <div class="panel-body catalog-url-form" style="display:none">
    <form>
      <div class="form-group">
        <input type="text" class="form-control" placeholder="http://">
      </div>
      <button type="submit" class="btn btn-default">Load</button>
      <button type="button" name="cancel" class="btn btn-default">Cancel</button>
    </form>
  </div>
</div>

<ul class="list-group dataset-list"></ul>
`

export default class SearchPane {
  constructor (sidebar, paneId) {
    this.sidebar = sidebar
    this.id = paneId
    this.map = this.sidebar.map
    this.layerControl = this.sidebar.layerControl
    
    $('#' + paneId).fill(HTML(paneHtml()))
    
    this.catalogue = sidebar.catalogue
    this.workspace = sidebar.workspace
    
    this._registerUIListeners()
    this._registerModelListeners()
  }
  
  _registerUIListeners () {
    let el = $('#' + this.id)
    let input = $('input', $('.catalog-url-form', el))
    $('.catalog-url-edit', el).on('click', () => {
      $('.catalog-url-info', el).hide()
      $('.catalog-url-form', el).show()
      input.set('value', this.url)
    })
    $('form', $('.catalog-url-form', el)).on('submit', () => {
      this.catalogue.loadFromDCAT(input.get('value')).then(() => {
        $('.catalog-url-info', el).show()
        $('.catalog-url-form', el).hide()
      })
    })
    $('button', $('.catalog-url-form', el)).filter(b => b.name === 'cancel').on('click', () => {
      $('.catalog-url-info', el).show()
      $('.catalog-url-form', el).hide()
    })
    $('button', $('.catalog-load-default', el)).on('click', () => {
      this.catalogue.loadFromDCAT(MELODIES_DCAT_CATALOG_URL)
    })
    $('.jsonld-view-button', el).on('click', () => {
      this._showDCATInfoModal()
    })
    
    // work-around as bootstrap.native only scans for tabs once, but we add the modal HTML later
    var tabs = document.querySelectorAll("#dcatSourceModal [data-toggle='tab']")
    for (let tab of tabs) {
      new Tab(tab)
    }
  }
  
  _showDCATInfoModal () {
    let modalEl = $('#dcatSourceModal')
    new Modal(modalEl[0]).open()
    
    let asJSON = obj => JSON.stringify(obj, null, 2)
    loadDCATCatalog(this.catalogue.url)
      .then(({raw, compacted, frame}) => {    
        $('.dcat-original', modalEl).fill(asJSON(raw))
        $('.dcat-framed', modalEl).fill(asJSON(compacted))
        $('.dcat-frame', modalEl).fill(asJSON(frame))
      })
  }
  
  _registerModelListeners () {
    this.catalogue.on('load', ({url}) => {
      this._clearList()      
      this._addDatasets(this.catalogue.datasets)
      this._setCatalogueUrl(url)
      
      let btnDiv = $('.catalog-load-default', $('#' + this.id))
      if (url !== MELODIES_DCAT_CATALOG_URL) {
        btnDiv.show()
      } else {
        btnDiv.hide()
      }
    })
    this.catalogue.on('loadError', ({url, error}) => {
      this._clearList()
      this._setCatalogueUrl(url)
      let el = HTML(TEMPLATES['dataset-error'])
      $('.error-message', el).fill(error.message)
      let json = JSON.stringify(error, null, 1)
      $('.error-details', el).fill(json)
      $('.dataset-list', '#' + this.id).fill(el)
      console.log(error)
    })
  }
  
  _clearList () {
    $('.dataset-list', '#' + this.id).fill()
  }
  
  _setCatalogueUrl (url) {
    this.url = url
    $('.catalog-url', '#' + this.id)
      .set('@href', url)
      .fill(url)
  }
  
  _addDatasets (datasets, sortKey='title') {
    datasets = sortByKey(datasets, d => i18n(d[sortKey]))
    for (let dataset of datasets) {
      this._addDataset(dataset)
    }
  }
  
  _addDataset (dataset) {
    let el = HTML(TEMPLATES['dataset-list-item'])
    $('.dataset-list', '#' + this.id).add(el)

    let title = i18n(dataset.title)
    let description = dataset.description ? i18n(dataset.description) : ''
    
    // TODO switch to .landingPage once https://github.com/ckan/ckanext-dcat/issues/50 is fixed
    //let landingPage = dataset.landingPage
    let landingPage = dataset['dcat:landingPage'] || dataset['landingPage']
    if (landingPage) {
      $('.dataset-title', el).fill(HTML(`<a href="${landingPage}" target="_new" class="external dataset-title">${title}</a>`))
    } else {
      $('.dataset-title', el).fill(title)
    }
    
    $('.dataset-description', el).fill(description)
    
    if (dataset.publisher) {
      // TODO switch to .homepage once https://github.com/ckan/ckanext-dcat/issues/50 is fixed
      //let homepage = dataset.publisher.homepage
      let homepage = dataset.publisher['foaf:homepage'] || dataset.publisher.homepage
      if (homepage) {
        $('.dataset-publisher', el).fill(HTML(`<a class="external" href="${homepage}"><em>${dataset.publisher.name}</em></a>`))
      } else {
        $('.dataset-publisher', el).fill(HTML(`<em>${dataset.publisher.name}</em>`))
      }
    } else {
      $('.dataset-publisher', el).hide()
    }
    
    if (dataset.temporal) {
      let temporal = dataset.temporal.startDate.substr(0,10) + ' to ' + dataset.temporal.endDate.substr(0,10)
      $('.dataset-temporal-text', el).fill(temporal)
    } else {
      $('.dataset-temporal', el).hide()
    }
    
    let isGlobal
    let geom = dataset.spatial && dataset.spatial.geometry ? parseWKT(dataset.spatial.geometry) : null
    // check if global bounding box and don't display map in that case
    if (geom) {
      let geomLayer = L.geoJson(geom)
      isGlobal = geomLayer.getBounds().equals([[-90, -180], [90, 180]])
    }
    
    if (geom && !isGlobal) {
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
      if (isGlobal) {
        $('.dataset-spatial-geometry-text', el).fill('global')
      } else {
        $('.dataset-spatial-geometry', el).hide()
      }
    }
    
    if (dataset.distributions) {
      let formats = dataset.distributions.map(d => ({
        label: getDistFormatLabel(d),
        mediaType: d.mediaType
      }))
      formats.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()))
      
      let seen = new Set()
      let hasProcessableDistributions = false
      for (let format of formats) {
        if (seen.has(format.label)) continue
        seen.add(format.label)
        let formatImpl = this._findFormatImpl(format.mediaType)
        if (formatImpl) {
          hasProcessableDistributions = true
        }
        let label = formatImpl ? formatImpl.shortLabel : format.label
        
        let color = formatImpl ? 'success' : 'default'
        let glyph = formatImpl && formatImpl.actionClasses.some(cl => cl.type === PROCESS) ? '<span class="glyphicon glyphicon-flash"></span> ' : ''
        let html
        if (formatImpl) {
          html = HTML(`<span class="label label-success">${glyph}${label}</span> `)
        } else {
          html = HTML(`<span class="label label-${color}">${label}</span> `)
        }
        $('.dataset-distribution-labels', el).add(html)
      }
      
      if (hasProcessableDistributions) {
        $('.dataset-analyse-button', el).show()
        $('.dataset-analyse-button', el).on('click', () => {
          this.workspace.addDataset(dataset)
        })
      }
    }
    
  }
  
  _findFormatImpl (mediaType) {
    // TODO formats should be directly injected
    for (let format of this.sidebar.app.formats) {
      if (format.supports(mediaType)) {
        return format
      }
    }
  }
  
}

/** Short label for media types that CKAN doesn't know (otherwise we can use .format) */
function getDistFormatLabel (dist) {
  let label = dist.format
  if (!label && dist.mediaType in MediaTypeLabels) {
    label = MediaTypeLabels[dist.mediaType]
  }
  if (!label) {
    label = dist.mediaType || 'unknown'
  }
  return label
}

// maps media types we don't support in analysis/display to short format labels
const MediaTypeLabels = {
  'application/x-netcdf': 'netCDF'
}
