import {$,$$, HTML} from 'minified'
import Modal from 'bootstrap-native/lib/modal-native.js'

import Remapper from 'category-remapper'
import 'category-remapper/css/remapper.css!'

import {withCategories} from 'leaflet-coverage/util/transform.js'

import {i18n} from '../util.js'
import {default as Action, VIEW, PROCESS} from './Action.js'
import CoverageData from '../formats/CoverageData.js'
import CatRemap from '../formats/CatRemap.js'

let html = `
<div class="modal fade" id="parameterSelectModal" tabindex="-1" role="dialog" aria-labelledby="paramSelectModalLabel">
  <div class="modal-dialog" role="document">
    <div class="modal-content">
      <div class="modal-header">
        <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
        <h4 class="modal-title" id="paramSelectModalLabel">Select a categorical parameter</h4>
      </div>
      <div class="modal-body">
        <span class="remap-is-remapping"></span>
      
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
        <span class="remap-is-remapping"></span>
        
        <div class="panel panel-primary remap-remapping-distributions">
          <div class="panel-heading">
            <h4>Option A: Apply ready-made remapping definitions</h4>
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
            <h4>Option B: Remap manually with categories from existing datasets</h4>
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
            <h4>Option C: Fully manual remapping</h4>
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
.workspace-dataset-distribution-action .btn {
  margin-bottom: 5px;
}
</style>
`
$('body').add(HTML(html))

const TEMPLATES = {
  'is-remapping': `
  <div class="panel panel-primary">
    <div class="panel-body">
      <p>This coverage data is the result of a category remapping operation.</p>
      <button type="button" class="btn btn-primary btn-modify-remapping" data-dismiss="modal">Modify Remapping</button>
    </div>
  </div>
  `,
  'parameter-item': `
  <li class="list-group-item">
    <h4 class="list-group-item-heading parameter-label"></h4>
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
    <p>Target: <span class="parameter-label"></span></p>
    <p>Categories: <span class="parameter-categories"></span></p>
  
    <button type="button" class="btn btn-primary remapping-button" data-dismiss="modal">
      Use Categories
    </button>
  </span>
  `,
  'remapping-distribution-item': `
  <li class="list-group-item">
    <h4 class="list-group-item-heading dataset-title"></h4>
    <p>Distribution: <span class="distribution-title"></span></p>
    <p>Target: <span class="target-observedProperty-label"></span></p>
    <p>Categories: <span class="target-categories"></span></p>
    
    <button type="button" class="btn btn-primary remapping-button" data-dismiss="modal">
      Apply
    </button>
  </li>
  `
}

export default class CoverageRemapCategories extends Action {
  constructor (data) {
    super()
    
    if (this._isSingleCoverage(data)) {
      this.cov = this._getSingleCoverage(data)
    } else {
      this.cov = data
    }
    
    this.label = 'Remap Categories'
    this.icon = '<span class="glyphicon glyphicon-random"></span>'
  }
  
  get isSupported () {
    // Use Case: Category Remapping for grids
    // Current restriction: data is single grid coverage with one or more categorical parameters
    if (this._isSingleCoverage(this.cov) && this.cov.domainType.endsWith('Grid')) {
      if (this._getCategoricalParams().length > 0) {
        return true
      }
    }
    return false
  }
  
  _isSingleCoverage (cov) {
    try {
      this._getSingleCoverage(cov)
      return true
    } catch (e) {
      return false
    }
  }
  
  _getSingleCoverage (cov) {
    if (!cov.coverages) {
      return cov
    } else if (cov.coverages.length === 1) {
      return cov.coverages[0]
    } else {
      throw new Error('not a single coverage')
    }
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
    let modalEl = $('#parameterSelectModal')
    
    this._showModifyRemappingSection(modalEl)
    
    $('.parameter-list', modalEl).fill()
    for (let param of this._getCategoricalParams()) {
      let el = $(HTML(TEMPLATES['parameter-item']))
      $('.parameter-label', el).fill(i18n(param.observedProperty.label))
      
      let categories = param.observedProperty.categories
      let content = categories.map(cat => i18n(cat.label)).join(', ')
      $('.parameter-categories', el).fill(content)
      
      $('.parameter-select-button', el).on('|click', () => {
        // small timeout otherwise scrolling gets broken
        // (immediate closing and opening of another modal seems problematic)
        setTimeout(() => this._remapModal(param, 200))
      })
      
      $('.parameter-list', modalEl).add(el)
    }
    
    new Modal(modalEl[0]).open()
  }
  
  _modifyRemappingUI () {
    let trans = this.cov.transformations[this.cov.transformations.length-1]
    let sourceCov = trans.source
    let param  = trans.operation.parameter
    let remapDef = trans.operation.categoryRemappingDefinition
    let prefixTitle = false
    
    this._createVirtualRemappedDataset(sourceCov, param, remapDef, prefixTitle, () => {
      this.context.workspace.removeDataset(this.context.dataset)
    })
  }
  
  _showModifyRemappingSection (modalEl) {
    // display "Modify Remapping" button when this is a remapped coverage
    if (this._isRemapped()) {
      $('.remap-is-remapping', modalEl).fill(HTML(TEMPLATES['is-remapping']))
      $('.btn-modify-remapping', modalEl).on('click|', () => this._modifyRemappingUI())
    } else {
      $('.remap-is-remapping', modalEl).fill()
    }
  }
  
  _getCategoryMappingDefinition (sourceObservedProperty, targetObservedProperty) {
    let categoryMappings = []
    // match up identical categories
    for (let category of sourceObservedProperty.categories) {
      let match = targetObservedProperty.categories.some(c => c.id === category.id)
      if (match) {
        categoryMappings.push({
          sourceCategory: category.id,
          destinationCategory: category.id
        })
      }
    }
    
    let remapDef = {
      type: 'CategoryRemappingDefinition',
      label: {
        // TODO do this properly
        en: i18n(sourceObservedProperty.label) + ' / ' + i18n(targetObservedProperty.label) + ' Mapping'
      },
      sourceObservedProperty: sourceObservedProperty,
      destinationObservedProperty: targetObservedProperty,
      categoryMappings
    }
    return remapDef
  }
  
  _remapModal (sourceParameter) {
    let modalEl = $('#remapModal')
    $('.parameter-label', modalEl).fill(i18n(sourceParameter.observedProperty.label))
    
    this._showModifyRemappingSection(modalEl)
    
    // display categories and remapping specs that can be used
    let catDists = this._findCategoryDistributions()
    let remappingDists = this._findRemappingDistributions(sourceParameter)
    
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
            let remapDef = this._getCategoryMappingDefinition(sourceParameter.observedProperty, param.observedProperty)
            this._createVirtualRemappedDataset(this.cov, sourceParameter, remapDef, true)
          })
        }
      }
            
      $('.categorical-distribution-list', modalEl).add(el)
    }
    
    $('.remapping-distribution-list', modalEl).fill()
    for (let {distribution,dataset} of remappingDists) {
      let el = $(HTML(TEMPLATES['remapping-distribution-item']))
      
      let remapDef = distribution.data
      
      $('.dataset-title', el).fill(i18n(dataset.title))
      $('.distribution-title', el).fill(i18n(distribution.title))
      $('.target-observedProperty-label', el).fill(i18n(remapDef.destinationObservedProperty.label))
      
      let cats = remapDef.destinationObservedProperty.categories
      let catsStr = cats.map(cat => i18n(cat.label)).join(', ')      
      $('.target-categories', el).fill(catsStr)
      
      $('.remapping-button', el).on('|click', () => {
        this._createVirtualRemappedDataset(this.cov, sourceParameter, remapDef, true)
      })
      
      $('.remapping-distribution-list', modalEl).add(el)
    }
    
    $$('.categorical-distribution-list-empty', modalEl).style.display = catDists.length > 0 ? 'none' : 'block'
    $$('.remapping-distribution-list-empty', modalEl).style.display = remappingDists.length > 0 ? 'none' : 'block'
    
    
    new Modal(modalEl[0]).open()
  }
  
  _createVirtualRemappedDataset (cov, parameter, remapDef, prefixTitle, oncreate) {
    if (prefixTitle) {
      prefixTitle = 'Remapped: '
    } else {
      prefixTitle = ''
    }
      
    let sourceParameter = parameter
    let targetObservedProp = remapDef.destinationObservedProperty
    let mapping = new Map(remapDef.categoryMappings.map(m => [m.sourceCategory, m.destinationCategory]))
    
    this._showRemapper(sourceParameter.observedProperty, targetObservedProp, mapping, data => {
      // use the mapping that was potentially modified by the user 
      let mapping = data.mapping
      
      let remappedCov = withCategories(cov, sourceParameter.key, targetObservedProp, mapping)
      
      // update remapDef in case the user dragged around connections
      let newRemapDef = JSON.parse(JSON.stringify(remapDef))
      newRemapDef.categoryMappings = []
      for (let [sourceCategory, destinationCategory] of mapping) {
        newRemapDef.categoryMappings.push({sourceCategory, destinationCategory})
      }
      
      if (!remappedCov.transformations) {
        remappedCov.transformations = []
      }
      remappedCov.transformations.push({
        source: cov,
        operation: {
          type: 'CategoryRemappingOperation',
          parameter: sourceParameter,
          categoryRemappingDefinition: newRemapDef
        }
      })
      
      let virtualDataset = {
        title: { en: prefixTitle + i18n(this.context.dataset.title) },
        virtual: true,
        distributions: [{
          title: { en: prefixTitle + i18n(this.context.distribution.title) },
          mediaType: 'coveragedata',
          data: remappedCov
        }]
      }
      let workspace = this.context.workspace

      // display after loading
      var done = ({dataset}) => {
        if (dataset === virtualDataset) {
          window.ac = dataset.distributions[0].actions
          dataset.distributions[0].actions.find(a => a.type === VIEW).run()                  
          workspace.off('distributionsLoad', done)
        }
      }
      workspace.on('distributionsLoad', done)
      
      workspace.addDataset(virtualDataset)
      workspace.requestFocus(virtualDataset)
      
      if (oncreate) oncreate()
    })
  }
  
  _showRemapper (sourceObservedProperty, targetObservedProperty, mapping, onapply) {
    let remapper = new Remapper('remapper')
    
    let sourceCategories = sourceObservedProperty.categories.map(cat => {
      // TODO be more clever about colors
      let color = cat.preferredColor || 'grey'          
      return {
        id: cat.id,
        label: i18n(cat.label),
        color
      }
    })
    let targetCategories = targetObservedProperty.categories.map(cat => {
      // TODO be more clever about colors
      let color = cat.preferredColor || 'grey'          
      return {
        id: cat.id,
        label: i18n(cat.label),
        color
      }
    })
    
    remapper.populateFroms(sourceCategories)
    remapper.populateTos(targetCategories)
    if (mapping) {
      setTimeout(() => remapper.linkCategories(mapping), 100)
    }
    
    remapper.on('apply', data => {
      remapper.remove() // we create a fresh one each time
      onapply(data)
    })
    
    remapper.show()
  }
  
  /**
   * Returns all distributions which have categories, including categories contained in coverage data.
   */
  _findCategoryDistributions () {
    return this.context.workspace.filterDistributions(dist => {
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
   * Returns all distributions which are a category remapping and are compatible to the source categories.
   */
  _findRemappingDistributions (sourceParameter) {
    let sourceCats = new Set(sourceParameter.observedProperty.categories.map(c => c.id))
    return this.context.workspace.filterDistributions(dist => {
      if (!(dist.formatImpl instanceof CatRemap)) return false
      return dist.data.categoryMappings.some(m => sourceCats.has(m.sourceCategory))
    })
  }
  
  /**
   * Returns whether the associated distribution is a result of a remapping.
   */
  _isRemapped () {
    // check Coverage data for remapping transformation
    
    // .transformations contains a record of all transformations that led to the this coverage data
    // The last applied transformation (which then directly resulted into this coverage data) is at the array end.
    if (!this.cov.transformations) return false
    let trans = this.cov.transformations[this.cov.transformations.length-1]
    return trans.operation.type === 'CategoryRemappingOperation'
  }
  
}

CoverageRemapCategories.type = PROCESS
