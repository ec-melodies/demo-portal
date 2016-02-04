/*
 * For a given categorical coverage parameter, calculate and show
 * percentages of each category for a given time step or combined
 * as a time series plot.
 */

import {$,$$, HTML} from 'minified'
import Modal from 'bootstrap-native/lib/modal-native.js'

import {i18n} from '../util.js'

import * as rangeUtil from 'leaflet-coverage/util/range.js'
import * as referencingUtil from 'leaflet-coverage/util/referencing.js'

import {default as Action, PROCESS} from './Action.js'

let html = `
<div class="modal fade" id="statisticsOptionsModal" tabindex="-1" role="dialog" aria-labelledby="statisticsOptionsModalLabel">
  <div class="modal-dialog" role="document">
    <div class="modal-content">
      <div class="modal-header">
        <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
        <h4 class="modal-title" id="statisticsOptionsModalLabel">Select reference periods</h4>
      </div>
      <div class="modal-body">
        
        <div class="panel panel-primary">
          <div class="panel-body">
            <p>
              Select the reference periods for which the summary statistics shall be calculated.
              The more periods you select, the longer the processing time will be.
            </p>
              
            <select multiple class="form-control ref-periods-select">
            </select>
            
            <div class="calculate-button-container"></div>
          </div>
          
       
        </div>
       
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>
      </div>
    </div>
  </div>
</div>

<div class="modal fade" id="statisticsProgressModal" tabindex="-1" role="dialog" aria-labelledby="statisticsProgressModalLabel">
  <div class="modal-dialog" role="document">
    <div class="modal-content">
      <div class="modal-header">
        <h4 class="modal-title" id="statisticsProgressModalLabel">Progress</h4>
      </div>
      <div class="modal-body">
        
        <div class="panel panel-primary">
          <div class="panel-body">
            <p>
              Please wait until the operation is finished.
            </p>
            <progress max="1" value="0"></progress>
          </div>
        </div>
       
      </div>
    </div>
  </div>
</div>

<style>
.calculate-button-container {
  margin-top: 20px;
}
#statisticsProgressModal progress {
  width: 100%;
}
</style>
`
$('body').add(HTML(html))

const TEMPLATES = {
  'calculate-button': `<button type="button" class="btn btn-primary calculate-button" data-dismiss="modal">Calculate</button>`
}

export default class CoverageCategoriesStatistics extends Action {
  constructor (data, context) {
    super(context)
    
    if (this._isSingleCoverage(data)) {
      this.cov = this._getSingleCoverage(data)
    } else {
      this.cov = data
    }
    
    this.label = 'Statistics'
    this.icon = '<span class="glyphicon glyphicon-stats"></span>'
  }
  
  // TODO code duplication with CoverageRemapCategories.js
  get isSupported () {
    // TODO check if there are other multi-valued axes except x,y,t -> if yes, unsupported
    
    // data is single grid coverage with one or more categorical parameters
    if (this._isSingleCoverage(this.cov) && this.cov.domainType.endsWith('Grid')) {
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
    // we only derive a new coverage dataset here
    // viewing happens in another class
    
    // Step 1: Modal to select statistics options
    //         -> Either a single time step, or all time steps
    // Step 2: Create statistics coverage (without geo axes!)
    
    // FIXME need param select modal!!    
    let param = this._getCategoricalParams()[0]
    
    this.cov.loadDomain().then(domain => {
      if (!domain.axes.has('t')) {
        this._createStats(this.cov, param, domain)
      } else if (domain.axes.get('t').values.length === 1) {
        this._createStats(this.cov, param, domain, [0])
      } else {
        this._refPeriodsModal(this.cov, param, domain)
      }
    })
  }
  
  _refPeriodsModal (cov, param, domain) {
    let modalEl = $('#statisticsOptionsModal')
    
    // we add this anew each time to get rid of old event listeners
    $('.calculate-button-container', modalEl).fill(HTML(TEMPLATES['calculate-button']))
    
    $('.ref-periods-select', modalEl).fill()
    
    let t = domain.axes.get('t')
    
    for (let i=0; i < t.values.length; i++) {
      let refPeriod
      if (t.bounds) {
        refPeriod = t.bounds[i][0] + ' - ' + t.bounds[i][1]
      } else {
        refPeriod = t.values[i]
      }
      $('.ref-periods-select', modalEl).add(HTML('<option value="' + i + '">' + refPeriod + '</option>'))
    }
    
    $('.calculate-button', modalEl).on('|click', () => {
      let timeIndices = []
      
      let options = $$('.ref-periods-select', modalEl).options
      for (let i=0; i < options.length; i++) {
        if (options[i].selected) {
          timeIndices.push(parseInt(options[i].value))
        }
      }
      
      if (timeIndices.length === 0) {
        alert('Please select at least one reference period')
        return false
      }
      
      this._createStats(cov, param, domain, timeIndices)
    })
    
    new Modal(modalEl[0]).open()
  }
  
  _createStats (cov, param, domain, timeIndices) {
    // show progress modal and calculate statistics
    // when done, display a close button with a guidance text what to do next
    
    let modalEl = $('#statisticsProgressModal')
    $$('progress', modalEl).value = 0
    var modal = new Modal(modalEl[0])
    modal.open()
    
    if (!timeIndices) {
      timeIndices = [null]
    }
    
    let total = timeIndices.length
    let done = 0
    
    let raiseProgress = () => {
      done++
      $$('progress', modalEl).value = done / total
    }
    
    let getRatios = range => {
      let rawCounts = new Map()
      for (let vals of param.categoryEncoding.values()) {
        for (let val of vals) {
          rawCounts.set(val, 0)
        }
      }
      
      // TODO using a Map is possibly too slow
      rangeUtil.iterate(range, val => {
        if (val !== null) {
          rawCounts.set(val, rawCounts.get(val) + 1)
        }
      })
      
      // convert to [category, count] array
      let categoryCounts = []
      for (let category of param.observedProperty.categories) {
        if (!param.categoryEncoding.has(category.id)) {
          categoryCounts.push([category, 0])
        } else {
          let count = param.categoryEncoding.get(category.id)
            .map(val => rawCounts.get(val))
            .reduce((c1, c2) => c1 + c2)
          categoryCounts.push([category, count])
        }
      }
      
      // convert to ratios
      let totalCount = categoryCounts.map(c => c[1]).reduce((c1, c2) => c1 + c2)
      let ratios = categoryCounts.map(([category, count]) => [category, count/totalCount])
      
      return ratios
    }
    
    var processTimeSlices = (stats, currentIndex) => {
      return cov.subsetByIndex({t: timeIndices[currentIndex]}).then(subset => {
        return subset.loadDomain().then(subsetDomain => {
          return subset.loadRange(param.key).then(range => {
            raiseProgress()
            
            let ratios = getRatios(range)
            stats.push({
              t: subsetDomain.axes.get('t'),
              ratios
            })
            
            if (currentIndex+1 < total) {
              return processTimeSlices(stats, currentIndex+1)
            } else {
              return stats
            }
          })
        })
      })
    }
    
    let asCoverageJSON = stats => {
      let t = {
        "values": stats.map(s => s.t.values[0])
      }
      if (stats[0].t.bounds) {
        t["bounds"] = stats.map(s => s.t.bounds[0])
      }
      
      let params = {}
      let ranges = {}
      
      let paramKey = category => i18n(category.label).replace(/ /g, '_')
      
      for (let category of param.observedProperty.categories) {
        let key = paramKey(category)
        params[key] = {
          "type": "Parameter",
          "observedProperty": {
            "label": {
              "en": i18n(category.label) + " Ratio"
            },
            "statisticalMeasure": "http://www.uncertml.org/statistics/discrete-probability",
            "statisticalCategories": [category]
          }
        }
        ranges[key] = {
          "type": "Range",
          "dataType": "float",
          "values": []
        }
      }
      
      for (let {ratios} of stats) {
        for (let [category, ratio] of ratios) {
          ranges[paramKey(category)].values.push(ratio)
        }
      }
      
      return {
        "type": "Coverage",
        "domain": {
          "type": "Domain",
          "axes": {
            "t": t
          },
          "referencing": [{
            "dimensions": ["t"],
            "trs": referencingUtil.getRefSystem(domain, ['t'])
          }]
        },
        "parameters": params,
        "ranges": ranges
      }
    }

    processTimeSlices([], 0).then(stats => {
      let covjson = JSON.stringify(asCoverageJSON(stats), null, 2)
      
      // NOTE: we don't call URL.revokeObjectURL() currently when removing the dataset again
      let blobUrl = URL.createObjectURL(new Blob([covjson], {type: 'application/prs.coverage+json'}))
      
      // add as dataset
      let prefixTitle = 'Statistics of '
      let virtualDataset = {
        title: { en: prefixTitle + i18n(this.context.dataset.title) },
        virtual: true,
        distributions: [{
          title: { en: prefixTitle + i18n(this.context.dataset.title) },
          mediaType: 'application/prs.coverage+json',
          url: blobUrl
        }]
      }
      let workspace = this.context.workspace      
      workspace.addDataset(virtualDataset, this.context.dataset)
      workspace.requestFocus(virtualDataset)
      
      modal.close()
    })
    
  }
  
}

CoverageCategoriesStatistics.type = PROCESS
