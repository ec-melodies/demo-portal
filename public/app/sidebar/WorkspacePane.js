import {$, $$, HTML} from 'minified'
import Modal from 'bootstrap-native/lib/modal-native.js'

import {i18n} from '../util.js'
import Eventable from '../Eventable.js'
import {EXTERNAL_LINK} from '../actions/Action.js'

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
        <div class="alert alert-info" role="alert">
          The data you add here is not uploaded to a server. It stays within your browser and is gone when you reload the page.
        </div>
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
    <div class="panel-heading dataset-title-heading">
      <h4>
        <span class="dataset-title"></span>
        <small><a href="#" class="dataset-title-edit"><i class="glyphicon glyphicon-pencil"></i></a></small>
        <button type="button" class="close" aria-label="Close"><span aria-hidden="true">&times;</span></button>
      </h4>
    </div>
    <div class="panel-heading dataset-title-edit-form" style="display:none">
      <form>
        <div class="form-group">
          <input type="text" class="form-control">
        </div>
        <button type="submit" class="btn btn-default">Rename</button>
        <button type="button" name="cancel" class="btn btn-default">Cancel</button>
      </form>
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
    <p>Content: <span class="distribution-content"></span></p>
    <div class="distribution-actions"></div>
  </li>`,
  
  'workspace-dataset-distribution-action': 
  `<span class="workspace-dataset-distribution-action">
    <button type="button" class="btn btn-primary"><span class="action-icon"></span> <span class="action-label"></span></button>
  </span>`,
  
  'workspace-dataset-distribution-action-external-link': 
  `<span class="workspace-dataset-distribution-action">
    <a target="_new" class="btn btn-primary"><span class="action-icon"></span> <span class="action-label"></span></a>
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
      <div class="alert alert-danger json-parse-error" style="display:none" role="alert"></div>
    </div>
  </div>`
}

let css = `
<style>
.virtual-dataset > .panel-heading {
  background: repeating-linear-gradient( -45deg, #d9edf7, #d9edf7 10px, #CCE8F4 10px, #CCE8F4 20px );
}
.workspace-dataset-list, .load-input-button, .json-parse-error {
  margin-top: 20px;
}
.format-button {
  margin-bottom: 15px;
}
.virtual-dataset {
  overflow: hidden;
  max-height: 0;
  transition: max-height 20s;
}
.blind-in {
  max-height: 10000px;
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

      let createVirtualDataset = (url) => {
        let datasetTitle = $('.dataset-title', modalEl).get('value') || '(No title)'
        let virtualDataset = {
          title: {en: datasetTitle},
          virtual: true,
          distributions: [{
            title: {en: 'Data'},
            mediaType: format.mediaTypes[0],
            url
          }]
        }
        return virtualDataset
      }
      let addVirtualDataset = virtualDataset => {
        this.workspace.addDataset(virtualDataset)
        this.workspace.requestFocus(virtualDataset)
      }
      
      $('.load-url-button', modalEl).on('|click', () => {
        let url = $('.data-url', modalEl).get('value')
        addVirtualDataset(createVirtualDataset(url))
      })
      
      let addBlobDataset = content => {
        let blob = new Blob([content], {type: format.mediaTypes[0]})
        let url = URL.createObjectURL(blob)
        let virtualDataset = createVirtualDataset(url)
        
        var fn = ({dataset}) => {
          if (dataset === virtualDataset) {
            URL.revokeObjectURL(url)
            delete dataset.distributions[0].url
            this.workspace.off('distributionsLoad', fn)
          }
        }
        this.workspace.on('distributionsLoad', fn)
        
        addVirtualDataset(virtualDataset)
      } 
      
      $('.load-file-button', modalEl).on('|click', () => {
        let file = $('.data-file', modalEl)[0].files[0]
        addBlobDataset(file)
      })
      
      // check if the format has a text media type, if yes: show text area
      if (format.mediaTypes.some(mt => mt.indexOf('json') !== -1 || mt.indexOf('xml') !== -1)) {
        methods.add(HTML(TEMPLATES['text-input-panel']))
        
        $('.load-text-button', modalEl).on('|click', event => {
          let text = $('.data-textarea', modalEl).get('value')
          if (format.mediaTypes.some(mt => mt.indexOf('json') !== -1)) {
            try {
              JSON.parse(text)
            } catch (e) {
              $('.json-parse-error', modalEl).show().fill(e.message)
              event.stopPropagation() // prevent closing of modal
              return
            }
          }
          addBlobDataset(text)
        })
      }
      
      new Modal(modalEl[0]).open()
    }
    
    formatModal()
  }
  
  _registerModelListeners () {
    this.workspace.on('add', ({dataset, parent}) => {
      let tab = $('a.sidebar-tab', '#' + this.sidebar.id).filter(t => $(t).get('@href') === '#' + this.id)
      tab.set('-highlight-anim')
      setTimeout(() => { // doesn't work without small delay
        tab.set('+highlight-anim')
      }, 100)
      
      this._addDataset(dataset, parent)

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
      let opts = {behavior: 'smooth'}
      if (!dataset.domEl) {
        var fn = data => {
          if (data.dataset === dataset) {
            dataset.domEl.scrollIntoView(opts)
            this.off('add', fn)
          }
        }
        this.on('add', fn)
      } else {
        dataset.domEl.scrollIntoView(opts)
      }
    })
    
    this.workspace.on('titleChange', ({dataset}) => {
      $('.dataset-title', dataset.domEl).fill(i18n(dataset.title))
    })
  }
  
  _addDataset (dataset, parent) {
    let el = HTML(TEMPLATES['workspace-dataset'])[0] // the outer div
    let list = $('.workspace-dataset-list', '#' + this.id)
    
    if (parent && this.workspace.datasets.indexOf(parent) !== -1) {
      $(parent.domEl).addAfter(el)
    } else {
      list.add(el)
    }
    dataset.domEl = el
    
    if (dataset.virtual) {
      $(el).set('+panel-info +virtual-dataset')
      setTimeout(() => $(el).set('+blind-in'), 100)
    } else {
      $(el).set('+panel-default')
    }
    $('.dataset-title', el).fill(i18n(dataset.title))
    
    $('.close', el).on('click', () => {
      this.workspace.removeDataset(dataset)
    })
    
    let titleInput = $$('input', $('.dataset-title-edit-form', el))
    $('.dataset-title-edit', el).on('click', () => {
      $('.dataset-title-heading', el).hide()
      $('.dataset-title-edit-form', el).show()
      titleInput.value = i18n(dataset.title)
    }) 
    $('form', $('.dataset-title-edit-form', el)).on('submit', () => {
      this.workspace.setDatasetTitle(dataset, titleInput.value)
      
      $('.dataset-title-heading', el).show()
      $('.dataset-title-edit-form', el).hide()
    })
    $('button', $('.dataset-title-edit-form', el)).filter(b => b.name === 'cancel').on('click', () => {
      $('.dataset-title-heading', el).show()
      $('.dataset-title-edit-form', el).hide()
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
    $('.distribution-content', el).fill(meta.content)
    
    if (distribution.actions) {
      for (let action of distribution.actions) {
        let actionEl
        if (action.type === EXTERNAL_LINK) {
          actionEl = HTML(TEMPLATES['workspace-dataset-distribution-action-external-link'])
          $('a', actionEl).set('@href', action.run())
        } else {
          actionEl = HTML(TEMPLATES['workspace-dataset-distribution-action'])
          $('button', actionEl).on('click', () => action.run())
        }
        let setLabelAndIcon = () => {
          $('.action-label', actionEl).fill(action.label)
          if (action.icon) {
            $('.action-icon', actionEl).fill(HTML(action.icon))
          }
        }
        setLabelAndIcon()
        action.on('labelChange', () => setLabelAndIcon())
        
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
