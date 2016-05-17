import {$, $$, HTML} from 'minified'
import Modal from 'bootstrap-native/lib/modal-native.js'

import {withSimpleDerivedParameter} from 'covutils/lib/coverage/transform.js'

import {i18n} from '../util.js'
import {default as Action, PROCESS} from './Action.js'

let html = `
<div class="modal fade" id="deriveParameterModal" tabindex="-1" role="dialog" aria-labelledby="deriveParameterModalLabel">
  <div class="modal-dialog" role="document">
    <div class="modal-content">
      <div class="modal-header">
        <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
        <h4 class="modal-title" id="deriveParameterModalLabel">Derive a Parameter</h4>
      </div>
      <div class="modal-body">
        <div class="panel panel-primary derive-input-parameters">
          <div class="panel-heading">
            <h4>Select input parameters</h4>
          </div>
          <div class="panel-body input-parameters">
          </div>
        </div>
        
        <div class="panel panel-primary derive-ouput-parameter">
          <div class="panel-heading">
            <h4>Define derived parameter</h4>
          </div>
          <div class="panel-body">
            
            <div class="form-horizontal">
              <div class="form-group">
                <label for="inputParameterKey" class="col-sm-2 control-label">ID</label>
                <div class="col-sm-10">
                  <input type="text" class="form-control" id="inputParameterKey" placeholder="salinity">
                </div>
              </div>
              <div class="form-group">
                <label for="inputObservedPropertyLabel" class="col-sm-2 control-label">Observed Property</label>
                <div class="col-sm-10">
                  <input type="text" class="form-control" id="inputObservedPropertyLabel" placeholder="Sea Water Salinity">
                </div>
              </div>
              <div class="form-group">
                <label for="inputParameterUnits" class="col-sm-2 control-label">Units</label>
                <div class="col-sm-10">
                  <input type="text" class="form-control" id="inputParameterUnits">
                </div>
              </div>
              <div class="form-group">
                <label for="inputParameterFormula" class="col-sm-2 control-label">Formula</label>
                <div class="col-sm-10">
                  <input type="text" class="form-control" id="inputParameterFormula">
                </div>
              </div>
              <div class="form-group">
                <div class="col-sm-offset-2 col-sm-10 submit-button-container">
                </div>
              </div>
            </div>
  
          </div>
        </div>
               
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>
      </div>
    </div>
  </div>
</div>
`
$('body').add(HTML(html))

const TEMPLATES = {
  'input-parameter': `
  <div class="checkbox">
    <label>
      <input type="checkbox" class="input-parameter-key">
      <code class="parameter-key"></code> - <span class="observedProperty-label"></span>
    </label>
  </div>
  `,
  'submit-button': `
  <button type="submit" class="btn btn-primary submit-button" data-dismiss="modal">Confirm</button>
  `
}

export default class CoverageDeriveParameter extends Action {
  constructor (data, context) {
    super(context)
    
    if (this._isSingleCoverage(data)) {
      this.cov = this._getSingleCoverage(data)
    } else {
      this.cov = data
    }
    
    this.label = 'Derive'
    this.icon = '<span class="glyphicon glyphicon-plus"></span>'
  }
  
  // TODO code duplication with CoverageRemapCategories.js
  get isSupported () {
    if (this._isSingleCoverage(this.cov)) {
      return true
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
  
  run () {
    // Step 1: Display modal with fields for parameter key, label, unit, input parameters, formula
    // Step 2: Save
    
    let cov = this.cov
    
    let modalEl = $('#deriveParameterModal')
    
    // clean old inputs
    $('.input-parameters', modalEl).fill()
    $$('#inputParameterKey', modalEl).value = ''
    $$('#inputObservedPropertyLabel', modalEl).value = ''
    $$('#inputParameterUnits', modalEl).value = ''
    $$('#inputParameterFormula', modalEl).value = ''
    
    for (let parameter of cov.parameters.values()) {
      let el = $(HTML(TEMPLATES['input-parameter']))
      
      $$('.input-parameter-key', el).value = parameter.key
      $('.parameter-key', el).fill(parameter.key)
      $('.observedProperty-label', el).fill(i18n(parameter.observedProperty.label))
      
      $('input', el).on('|click', () => {
        let formulaInput = $$('#inputParameterFormula', modalEl) 
        if (formulaInput.value) return
        // update formula placeholder to provide some guidance
        let keys = this._getCheckedParameterKeys(modalEl)
        formulaInput.placeholder = keys.join(' + ')
      })
                  
      $('.input-parameters', modalEl).add(el)
    }
    
    let el = $(HTML(TEMPLATES['submit-button']))
    $('.submit-button-container', modalEl).fill().add(el)
    
    $('.submit-button', modalEl).on('?click', () => {
      let inputKeys = this._getCheckedParameterKeys(modalEl)
      let key = $$('#inputParameterKey', modalEl).value
      let propLabel = $$('#inputObservedPropertyLabel', modalEl).value
      let units = $$('#inputParameterUnits', modalEl).value
      let formula = $$('#inputParameterFormula', modalEl).value
      
      if (!inputKeys.length || !key || !propLabel || !formula) {
        alert('Input parameters, ID, observed property, and formula are required')
        return
      }
      
      let fn = new Function(...inputKeys, 'return ' + formula)
      try {
        let testVals = inputKeys.map(() => Math.random())
        fn(...testVals)
      } catch (e) {
        alert('Invalid formula: ' + e)
        return
      }
      console.log(fn.toString())
      
      this._createVirtualDataset(inputKeys, key, propLabel, units, fn)      
      
      return true
    })
    
    new Modal(modalEl[0]).open()
  }
  
  _createVirtualDataset (inputKeys, key, propLabel, units, fn) {
    let parameter = {
      key,
      observedProperty: {
        label: {en: propLabel}
      }
    }
    if (units) {
      parameter.unit = {
        symbol: units
      }
    }
    
    let derivedCov = withSimpleDerivedParameter(this.cov, {
      parameter,
      inputParameters: inputKeys,
      fn
    })
    
    let appendTitle = ' [derived: ' + key + ']'
    
    let virtualDataset = {
      title: { en: i18n(this.context.dataset.title) + appendTitle },
      virtual: true,
      distributions: [{
        title: { en: i18n(this.context.distribution.title) + appendTitle },
        mediaType: 'coveragedata',
        data: derivedCov
      }]
    }
    let workspace = this.context.workspace
            
    workspace.addDataset(virtualDataset, this.context.dataset)
    workspace.requestFocus(virtualDataset)
  }
  
  _getCheckedParameterKeys (modalEl) {
    let inputs = $('.input-parameter-key', modalEl).array()
    let checked = inputs.filter(el => el.checked)
    return checked.map(el => el.value)
  }
  
}

CoverageDeriveParameter.type = PROCESS
