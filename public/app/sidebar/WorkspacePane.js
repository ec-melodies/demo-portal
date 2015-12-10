import {$, HTML} from 'minified'
import Modal from 'bootstrap-native/lib/modal-native.js'

import {i18n} from '../util.js'
import Eventable from '../Eventable.js'

let paneHtml = () => `
<h1 class="sidebar-header">Workspace<div class="sidebar-close"><i class="glyphicon glyphicon-menu-left"></i></div></h1>

<p style="margin-top: 20px">
  <button type="button" class="btn btn-primary create-dataset-button">Load Data</button>
</p>

<div class="workspace-dataset-list">
  <p class="user-hint">Click on "Add to Workspace" in the search tab to add datasets.</p>
</div>
`

let bodyHtml = `
<div class="modal fade" id="formatSelectModal" tabindex="-1" role="dialog" aria-labelledby="formatSelectModalLabel">
  <div class="modal-dialog" role="document">
    <div class="modal-content">
      <div class="modal-header">
        <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
        <h4 class="modal-title" id="formatSelectModalLabel">Select a format</h4>
      </div>
      <div class="modal-body">      
        <span class="format-list"></span>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>
      </div>
    </div>
  </div>
</div>

<div class="modal fade" id="dataCreateLoadModal" tabindex="-1" role="dialog" aria-labelledby="dataCreateLoadModalLabel">
<div class="modal-dialog" role="document">
  <div class="modal-content">
    <div class="modal-header">
      <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
      <h4 class="modal-title" id="dataCreateLoadModalLabel">Input your data</h4>
    </div>
    <div class="modal-body">      
      <div class="form-group">
        <label for="formDatasetTitle">Give your new dataset a name:</label>
        <input class="form-control dataset-title" type="text" id="formDatasetTitle" placeholder="My new dataset">
      </div>
    
      <span class="data-input-methods"></span>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>
    </div>
  </div>
</div>
</div>
`
$('body').add(HTML(bodyHtml))

const TEMPLATES = {
  // Important: No whitespace at beginning as this introduces text nodes and we just get the first node!
  'workspace-dataset': 
  `<div class="panel workspace-dataset">
    <div class="panel-heading">
      <h4>
        <span class="dataset-title"></span>
        <button type="button" class="close" aria-label="Close"><span aria-hidden="true">&times;</span></button>
      </h4>
    </div>
    <div class="panel-body" style="text-align: center">
      <div class="throbber-loader loader">Loading...</div>
    </div>
  
    <ul class="list-group workspace-dataset-distribution-list"></ul>
  </div>`,
  
  'workspace-dataset-distribution':
  `<li class="list-group-item workspace-dataset-distribution">
    <p>Title: <em class="distribution-title"></em></p>
    <p>Type: <span class="distribution-format"></span></p>
    <p>Content: <span class="distribution-metadata"></span></p>
    <div class="distribution-actions"></div>
  </li>`,
  
  'workspace-dataset-distribution-action': 
  `<span class="workspace-dataset-distribution-action">
    <button type="button" class="btn btn-primary"></button>
  </span>`,
  
  'workspace-dataset-distribution-error': 
  `<li class="list-group-item list-group-item-danger workspace-dataset-distribution error-item">
    <p>Type: <span class="distribution-format"></span></p>
    <p>Error: <em class="error-message"></em></p>
    <span class="error-details-section">
      <p>Details:</p>
      <small><pre class="error-details"></pre></small>
    </span>
  </li>`,
  
  'format-button-item':
  `<span><button type="button" class="btn btn-primary format-button" data-dismiss="modal"></button></span> `,
  
  'url-input-panel':
  `<div class="panel panel-primary">
    <div class="panel-heading">
      <h4>By URL</h4>
    </div>
    <div class="panel-body">
      <div class="input-group">
        <input type="text" class="form-control data-url" placeholder="http://..." />
        <span class="input-group-btn">
          <button class="btn btn-primary load-url-button" type="button" data-dismiss="modal">Load</button>
        </span>
      </div>
    </div>
  </div>`,
  
  'file-input-panel':
  `<div class="panel panel-primary">
    <div class="panel-heading">
      <h4>By Local File</h4>
    </div>
    <div class="panel-body">
      <div class="input-group">
        <input type="file" class="form-control data-file" />
        <span class="input-group-btn">
          <button class="btn btn-primary load-file-button" type="button" data-dismiss="modal">Load</button>
        </span>
      </div>
    </div>
  </div>`,
  
  'text-input-panel':
  `<div class="panel panel-primary">
    <div class="panel-heading">
      <h4>By Direct Input</h4>
    </div>
    <div class="panel-body">
      <textarea class="form-control data-textarea" rows="10"></textarea>
      <button class="btn btn-primary load-text-button" type="button" data-dismiss="modal">Load</button>
    </div>
  </div>`
}

let css = `
<style>
.workspace-dataset-list, .load-input-button {
  margin-top: 20px;
}
@keyframes flash-icon {
  0%   {color: black}
  50%  {color: red}
  100% {color: black}
}
.highlight-anim {
  animation-name: flash-icon;
  animation-duration: 0.8s;
  animation-iteration-count: 4;
  animation-timing-function: ease-in-out;
}
/* http://www.css-spinners.com/spinner/throbber */
@keyframes throbber-loader {
  0%  { background: #dde2e7 }
  10% { background: #6b9dc8 }
  40% { background: #dde2e7 }
}
/* :not(:required) hides these rules from IE9 and below */
.throbber-loader:not(:required) {
  animation: throbber-loader 2000ms 300ms infinite ease-out;
  background: #dde2e7;
  display: inline-block;
  position: relative;
  text-indent: -9999px;
  width: 0.9em;
  height: 1.5em;
  margin: 0 1.6em;
}
.throbber-loader:not(:required):before, .throbber-loader:not(:required):after {
  background: #dde2e7;
  content: '\x200B';
  display: inline-block;
  width: 0.9em;
  height: 1.5em;
  position: absolute;
  top: 0;
}
.throbber-loader:not(:required):before {
  animation: throbber-loader 2000ms 150ms infinite ease-out;
  left: -1.6em;
}
.throbber-loader:not(:required):after {
  animation: throbber-loader 2000ms 450ms infinite ease-out;
  right: -1.6em;
}
</style>
`
$('head').add(HTML(css))

export default class WorkspacePane extends Eventable {
  constructor (sidebar, paneId) {
    super()
    this.sidebar = sidebar
    this.id = paneId
    
    $('#' + paneId).fill(HTML(paneHtml()))
    
    this.workspace = sidebar.workspace
    this.app = sidebar.app
    
    this._registerUIListeners()
    this._registerModelListeners()
  }
  
  _registerUIListeners() {
    $('.create-dataset-button', '#' + this.id).on('click', () => this._createDatasetWorkflow())
  }
  
  _createDatasetWorkflow () {
    // Step 1: show first modal and let user select the format
    // Step 2: show second modal and display URL field, text area (if media type json or xml), and local file field
    // Step 3: create virtual dataset
    
    let formatModal = () => {
      let modalEl = $('#formatSelectModal')
      
      // iterate over all formats and skip the ones without a proper mimetype (not in the form */*)
      // (these are not real file formats and exist only internally for derived object-only data (e.g. "CoverageData"))
      
      $('.format-list', modalEl).fill()
      for (let format of this.app.formats) {
        if (format.mediaTypes.some(mt => mt.indexOf('/') !== -1)) {
          let el = $(HTML(TEMPLATES['format-button-item']))
          $('.format-button', el).fill(format.label).on('|click', () => {
            setTimeout(() => dataModal(format), 100)
          })
          
          $('.format-list', modalEl).add(el)
        }
      }
      
      new Modal(modalEl[0]).open()
    }
    
    let dataModal = format => {
      let modalEl = $('#dataCreateLoadModal')
      
      let methods = $('.data-input-methods', modalEl)
      methods.fill()
      methods.add(HTML(TEMPLATES['url-input-panel']))
      methods.add(HTML(TEMPLATES['file-input-panel']))
            
      $('.load-url-button', modalEl).on('|click', () => {
        let datasetTitle = $('.dataset-title', modalEl).get('value') || '(No title)'
        let url = $('.data-url', modalEl).get('value')
        let virtualDataset = {
          title: new Map([['en', datasetTitle]]),
          virtual: true,
          distributions: [{
            title: new Map([['en', 'Data']]),
            mediaType: format.mediaTypes[0],
            url 
          }]
        }
        
        this.workspace.addDataset(virtualDataset)
        this.workspace.requestFocus(virtualDataset)        
      })
      
      $('.load-file-button', modalEl).on('|click', () => {
        
      })
      
      // check if the format has a text media type, if yes: show text area
      if (format.mediaTypes.some(mt => mt.indexOf('json') !== -1 || mt.indexOf('xml') !== -1)) {
        methods.add(HTML(TEMPLATES['text-input-panel']))
        
        $('.load-text-button', modalEl).on('|click', () => {
        
        })
      }
      
      new Modal(modalEl[0]).open()
    }
    
    formatModal()
  }
  
  _registerModelListeners () {
    this.workspace.on('add', ({dataset}) => {
      let tab = $('a.sidebar-tab', '#' + this.sidebar.id).filter(t => $(t).get('@href') === '#' + this.id)
      tab.set('-highlight-anim')
      setTimeout(() => { // doesn't work without small delay
        tab.set('+highlight-anim')
      }, 100)
      
      this._addDataset(dataset)

      $('.user-hint', '#' + this.id).remove()
    })
    
    this.workspace.on('remove', ({dataset}) => {
      $(dataset.domEl).remove()
    })
    
    this.workspace.on('distributionsLoading', ({dataset}) => {
      $('.panel-body', dataset.domEl).show()
    })
    
    this.workspace.on('distributionsLoad', ({dataset}) => {
      $('.panel-body', dataset.domEl).hide()
    })
    
    this.workspace.on('distributionLoad', ({dataset, distribution}) => {
      this._addDistribution(dataset, distribution)
    })
    
    this.workspace.on('distributionLoadError', ({dataset, distribution, error}) => {
      this._addDistributionLoadError(dataset, distribution, error)
    })
    
    this.workspace.on('requestFocus', ({dataset}) => {
      // not added to dom yet, defer
      if (!dataset.domEl) {
        var fn = data => {
          if (data.dataset === dataset) {
            dataset.domEl.scrollIntoView()
            this.off('add', fn)
          }
        }
        this.on('add', fn)
      } else {
        dataset.domEl.scrollIntoView()
      }
    })
  }
  
  _addDataset (dataset) {
    let el = HTML(TEMPLATES['workspace-dataset'])[0] // the outer div
    $('.workspace-dataset-list', '#' + this.id).add(el)
    dataset.domEl = el
    
    if (dataset.virtual) {
      $(el).set('+panel-info')
    } else {
      $(el).set('+panel-default')
    }
    $('.dataset-title', el).fill(i18n(dataset.title))
    
    $('.close', el).on('click', () => {
      this.workspace.removeDataset(dataset)
    })
    this.fire('add', {dataset})
  }
  
  _addDistribution (dataset, distribution) {
    let el = HTML(TEMPLATES['workspace-dataset-distribution'])
    $('.workspace-dataset-distribution-list', dataset.domEl).add(el)
    distribution.domEl = el
    let meta = distribution.metadata
    
    $('.distribution-title', el).fill(i18n(distribution.title))
    $('.distribution-format', el).fill(meta.format)
    $('.distribution-metadata', el).fill(meta.type)
    
    if (distribution.actions) {
      for (let action of distribution.actions) {
        let actionEl = HTML(TEMPLATES['workspace-dataset-distribution-action'])
        $('button', actionEl).fill(action.label).on('click', () => {
          action.run()
        })
        $('.distribution-actions', el).add(actionEl)
      }
    }
  }
  
  _addDistributionLoadError (dataset, distribution, error) {
    let el = HTML(TEMPLATES['workspace-dataset-distribution-error'])
    $('.workspace-dataset-distribution-list', dataset.domEl).add(el)
    distribution.domEl = el
    
    $('.distribution-format', el).fill(distribution.formatImpl.label)
    $('.error-message', el).fill(error.message)
    if (Object.keys(error).length > 0) {
      $('.error-details', el).fill(JSON.stringify(error, null, 1))
    } else {
      $('.error-details-section', el).remove()
    }
  }
  
}
