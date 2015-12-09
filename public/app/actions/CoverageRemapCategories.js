import {$,$$, HTML} from 'minified'
import Modal from 'bootstrap-native/lib/modal-native.js'

import Remapper from 'category-remapper'
import 'category-remapper/css/remapper.css!'

import {withCategories} from 'leaflet-coverage/util/transform.js'

import {i18n} from '../util.js'
import {default as Action, PROCESS} from './Action.js'
import CoverageData from '../formats/CoverageData.js'
import JSONLD from '../formats/JSONLD.js'

let html = `
<div class="modal fade" id="parameterSelectModal" tabindex="-1" role="dialog" aria-labelledby="paramSelectModalLabel">
  <div class="modal-dialog" role="document">
    <div class="modal-content">
      <div class="modal-header">
        <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
        <h4 class="modal-title" id="paramSelectModalLabel">Select a categorical parameter</h4>
      </div>
      <div class="modal-body">
        <div class="panel panel-primary parameter-select">
          <div class="panel-body">
            <p>
              Which of the following categorical parameters do you like to remap?
            </p>
          </div>
          <ul class="list-group parameter-list"></ul>
        </div>
       
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>
      </div>
    </div>
  </div>
</div>

<div class="modal fade" id="remapModal" tabindex="-1" role="dialog" aria-labelledby="remapModalLabel">
  <div class="modal-dialog" role="document">
    <div class="modal-content">
      <div class="modal-header">
        <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
        <h4 class="modal-title" id="remapModalLabel">Remap <strong class="parameter-label"></strong> Categories</h4>
      </div>
      <div class="modal-body">
        <div class="panel panel-primary remap-is-remapping">
          <div class="panel-body">
            <p>This coverage is already remapped.</p>
            <button type="button" class="btn btn-primary btn-modify-remapping" data-dismiss="modal">Modify</button>
          </div>
        </div>
        
        <div class="panel panel-primary remap-remapping-distributions">
          <div class="panel-heading">
            <h4>Apply ready-made remapping definitions</h4>
          </div>
          <div class="panel-body">
            <p>
              Using a ready-made remapping definition is the fastest way to apply a remapping.
              The remapping definition defines both the target categories and their mapping
              from the source categories.
            </p>
            <div class="alert alert-info remapping-distribution-list-empty" role="alert"><strong>None found.</strong></div>
          </div>
          <ul class="list-group remapping-distribution-list"></ul>
        </div>
        
        <div class="panel panel-primary remap-categorical-distributions">
          <div class="panel-heading">
            <h4>Remap manually with categories from existing datasets</h4>
          </div>
          <div class="panel-body">
            <p>
              A manual remapping can be done more quickly by loading the desired
              target categories from an existing dataset. The connections then have
              to be created manually via drag and drop.
            </p>
            <div class="alert alert-info categorical-distribution-list-empty" role="alert"><strong>None found.</strong></div>
          </div>
          
          <ul class="list-group categorical-distribution-list"></ul>
        </div>
        
        <div class="panel panel-default remap-manual">
          <div class="panel-heading">
            <h4>Fully manual remapping</h4>
          </div>
          <div class="panel-body">
            <p>
              When the above methods cannot be used then the only option left is
              to manually create the target categories and connect
              them to the source categories. NOTE: This is currently not supported.
            </p>
          </div>
        </div>
       
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>
      </div>
    </div>
  </div>
</div>
<div id="remapper"></div>
<style>
/* above sidebar */
.modal, #remapper {
  z-index: 3000; 
}
.modal-backdrop {
  z-index: 2500;
}
.categorical-distribution-list-empty, .remapping-distribution-list-empty {
  margin-bottom: 0;
}
</style>
`
$('body').add(HTML(html))

const TEMPLATES = {
  'parameter-item': `
  <li class="list-group-item">
    <h4 class="list-group-item-heading parameter-label"></h4>
    <p>Distribution: <span class="distribution-title"></span></p>
    <p>Categories: <span class="parameter-categories"></span></p>

    <button type="button" class="btn btn-primary parameter-select-button" data-dismiss="modal">
      Select
    </button>
  </li>
  `,
  'categorical-distribution-item': `
  <li class="list-group-item">
    <h4 class="list-group-item-heading dataset-title"></h4>
    <p>Distribution: <span class="distribution-title"></span></p>
    <span class="distribution-parameters"></span>

  </li>
  `,
  // leave the <span> in! otherwise we can't reach the button via minified...
  'categorical-parameter-item': `
  <span>
    <p>Parameter: <span class="parameter-label"></span></p>
    <p>Categories: <span class="parameter-categories"></span></p>
  
    <button type="button" class="btn btn-primary remapping-button" data-dismiss="modal">
      Use Categories
    </button>
  </span>
  `,
  'remapping-distribution-item': `

  `
}

export default class CoverageRemapCategories extends Action {
  constructor (data) {
    super()
    this.cov = data
    
    this.label = 'Remap Categories'
  }
  
  get isSupported () {
    // Use Case: Category Remapping for grids
    // Current restriction: data is single grid coverage with one or more categorical parameters
    if (!('coverages' in this.cov) && this.cov.domainType.endsWith('Grid')) {
      if (this._getCategoricalParams().length > 0) {
        return true
      }
    }
    return false
  }
  
  _getCategoricalParams() {
    let params = [...this.cov.parameters.values()]
    return params.filter(param => param.observedProperty.categories)
  }
  
  run () {
    // open UI for remapping etc.
    
    // First modal dialog:
    // Step 0: The user first selects which categorical parameter he wants to remap.
    //         If there is just a single one, then this step is skipped.
    
    // Second modal dialog:
    // Step 1: search for distributions in workspace that can be used as a mapping or as target categories;
    //         if no distributions found, display message and guide user
    // Step 2: display distributions in a list with "Use" buttons
    // Step 3: after the user presses the "Use" button, a new virtual dataset is created
    //         with a single distribution which is immediately displayed
    //         The virtual distribution has the remapping info attached so that it is possible
    //         to modify the mapping in the same virtual dataset.
    //         This info is stored directly in CovJSON as provenance data (derivedFrom
    // When a remapping is "modified" then this means removing the old virtual distribution and
    // adding a new one.
    
    let catParams = this._getCategoricalParams()
    if (catParams.length > 1) {
      this._selectParameterModal()
    } else {
      // go directly to the second modal
      this._remapModal(catParams[0])
    }
  }
  
  _selectParameterModal () {
    // TODO implement
    let parameter = null
    this._remapModal(parameter)
  }
  
  _remapModal (sourceParameter) {
    // display "Modify" button when this is a remapped coverage
    let modalEl = $('#remapModal')
    $('.parameter-label', modalEl).fill(i18n(sourceParameter.observedProperty.label))
       
    let isRemapped = this._isRemapped()
    $$('.remap-is-remapping', modalEl).style.display = isRemapped ? 'block' : 'none'
    
    // display categories and remapping specs that can be used
    let catDists = this._findCategoryDistributions()
    let remappingDists = this._findRemappingDistributions()
    
    $('.categorical-distribution-list', modalEl).fill()
    for (let {distribution,dataset} of catDists) {
      let el = $(HTML(TEMPLATES['categorical-distribution-item']))
      
      $('.dataset-title', el).fill(i18n(dataset.title))
      $('.distribution-title', el).fill(i18n(distribution.title))
      
      let cov = distribution.data
      let covTargetCategories
      for (let param of cov.parameters.values()) {
        if (param.observedProperty.categories) {
          let paramEl = $(HTML(TEMPLATES['categorical-parameter-item']))
          covTargetCategories = param.observedProperty.categories
          let content = covTargetCategories.map(cat => i18n(cat.label)).join(', ')
          $('.parameter-categories', paramEl).fill(content)
          $('.parameter-label', paramEl).fill(i18n(param.observedProperty.label))
          $('.distribution-parameters', el).add(paramEl)
          
          $('.remapping-button', paramEl).on('|click', () => {
            let remapper = new Remapper('remapper')
            
            let sourceCategories = sourceParameter.observedProperty.categories.map(cat => {
              // TODO be more clever about colors
              let color = cat.preferredColor || 'green'          
              return {
                id: cat.id,
                label: i18n(cat.label),
                color
              }
            })
            let targetCategories = covTargetCategories.map(cat => {
              // TODO be more clever about colors
              let color = cat.preferredColor || 'green'          
              return {
                id: cat.id,
                label: i18n(cat.label),
                color
              }
            })
            
            remapper.populateFroms(sourceCategories)
            remapper.populateTos(targetCategories)
            
            remapper.on('apply', data => {
              remapper.remove() // we create a fresh one each time
              
              let mapping = data.mapping
              let remappedCov = withCategories(this.cov, sourceParameter.key, covTargetCategories, mapping)
              
              this.context.workspace.addDataset({
                title: new Map([['en', 'Remapped: ' + i18n(dataset.title)]]),
                virtual: true,
                distributions: [{
                  title: new Map([['en', 'Remapping of: ' + i18n(distribution.title)]]),
                  mediaType: 'coveragedata',
                  data: remappedCov
                }]
              })
            })
            
            remapper.show()
          })
        }
      }
            
      $('.categorical-distribution-list', modalEl).add(el)
    }
    
    $('.remapping-distribution-list', modalEl).fill()
    for (let remappingDist of remappingDists) {
      // TODO implement
    }
    
    $$('.categorical-distribution-list-empty', modalEl).style.display = catDists.length > 0 ? 'none' : 'block'
    $$('.remapping-distribution-list-empty', modalEl).style.display = remappingDists.length > 0 ? 'none' : 'block'
    
    
    new Modal(modalEl[0]).open()
  }
  
  /**
   * Returns all distributions which have categories, including categories contained in coverage data.
   */
  _findCategoryDistributions () {
    return this._filterDistributions(dist => {
      if (dist.formatImpl instanceof CoverageData) {
        let cov = dist.data
        // check for categorical parameters
        if (cov.parameters) {
          for (let param of cov.parameters.values()) {
            if (!param.observedProperty.categories) continue
            return true
          }
        }
        return false
      }
    })
  }
  
  /**
   * Returns all distributions which are a category remapping specification.
   */
  _findRemappingDistributions () {
    return this._filterDistributions(dist => {
      if (dist.formatImpl instanceof JSONLD) {
        // TODO implement
        return false
      }
    })
  }
  
  /**
   * Returns whether the associated distribution is a result of a remapping.
   */
  _isRemapped () {
    // TODO check Coverage data for remapping provenance info
    return false
  }
   
  _filterDistributions (matchFn) {
    let datasets = this.context.workspace.datasets
    let dists = []
    for (let dataset of datasets) {
      for (let dist of dataset.distributions) {
        if (matchFn(dist)) {
          dists.push({distribution: dist, dataset})
        }
      }
    }
    return dists
  }
  
}

CoverageRemapCategories.type = PROCESS
