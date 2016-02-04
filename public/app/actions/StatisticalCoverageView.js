import {$,$$, HTML} from 'minified'
import Modal from 'bootstrap-native/lib/modal-native.js'

import c3 from 'c3'
import 'c3/c3.css!'

import {default as Action, VIEW} from './Action.js'
import {i18n} from '../util.js'

const DISCRETE_PROB = 'http://www.uncertml.org/statistics/discrete-probability'

let html = `
<div class="modal fade" id="statisticsViewModal" tabindex="-1" role="dialog" aria-labelledby="statisticsViewModalLabel">
  <div class="modal-dialog modal-lg" role="document">
    <div class="modal-content">
      <div class="modal-header">
        <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
        <h4 class="modal-title" id="statisticsViewModalLabel">Statistics View</h4>
      </div>
      <div class="modal-body">
        <div class="param-selector"></div>
      
        <div class="chart-container"></div>
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
  'param-selector': `<select name="param"></select>`
}
  
/**
 * Displays statistical coverages as a graph, 
 * currently supporting discrete probabilities as statistical measure only.
 * 
 */
export default class StatisticalCoverageView extends Action {
  constructor (data, context) {
    super(context)
    this.cov = data
    
    this.label = 'View'
    this.icon = '<span class="glyphicon glyphicon-stats"></span>'
  }
  
  get isSupported () {
    if (this.cov.coverages) {
      return false
    }
    
    for (let param of this.cov.parameters.values()) {
      let obsProp = param.observedProperty
      if (obsProp.statisticalMeasure !== DISCRETE_PROB) {
        return false
      }
    }
        
    return true
  }
  
  run () {
    Promise.all([this.cov.loadDomain(), this.cov.loadRanges()]).then(([domain, ranges]) => {
      if (domain.axes.size > 1) {
        alert('Sorry, only statistical coverages with exactly one axis (often time) are supported.')
        return
      }
      
      // We offer two visualizations:
      // 1. A timeseries chart for a single category (http://c3js.org/samples/timeseries.html)
      // 2. A timeseries stacked area chart (http://c3js.org/samples/chart_area_stacked.html)
      
      this._displayChart(domain, ranges)
    })
  }
  
  _displayChart (domain, ranges) {
    let modalEl = $('#statisticsViewModal')
    $('.chart-container', modalEl).fill()
    $('.param-selector', modalEl).fill(HTML(TEMPLATES['param-selector']))
    $('select', modalEl).add(HTML('<option value="">All</option>'))
    
    let getStatTitle = param => {
      let cats = param.observedProperty.statisticalCategories
      let title
      if (cats) {
        title = cats.map(cat => i18n(cat.label)).join(' & ')
      } else {
        title = i18n(param.observedProperty.label)
      }
      return title
    }
    
    for (let param of this.cov.parameters.values()) {
      let title = getStatTitle(param)
      $('select', modalEl).add(HTML(`<option value="${param.key}">${title}</option>`))
    }
    
    // TODO support bounds
    let tColumn = ['t'].concat(domain.axes.get('t').values.map(t => new Date(t)))
    
    let displayStackedChart = () => {
      // stacked area chart of all parameters
      
      let names = {}
      let colors = {}
      let types = {}
      let group = []
      let ratioColumns = []
      for (let param of this.cov.parameters.values()) {
        let key = param.key
        // skip params that are 0 during the whole series
        if (!ranges.get(key).values.some(v => v > 0)) {
          continue
        }
        names[key] = getStatTitle(param)
        types[key] = 'area'
        group.push(key)
        let cats = param.observedProperty.statisticalCategories
        if (cats && cats.length === 1 && cats[0].preferredColor) {
          colors[key] = cats[0].preferredColor
        }
        ratioColumns.push([key].concat(ranges.get(key).values.map(v => v*100)))
      }
      
      c3.generate({
        bindto: $$('.chart-container', modalEl),
        data: {
          x: 't',
          columns: [tColumn].concat(ratioColumns),
          types: types,
          groups: [group],
          names: names,
          colors: colors
        },
        grid: {
          y: {
            show: true
          }
        },
        tooltip: {
          format: {
            value: value => value.toFixed(2) + '%'
          }
        },
        axis: {
          y: {
            min: 0,
            max: 100,
            padding: 0,
            label: {
              text: 'Percentage (%)',
              position: 'outer-middle'
            },
            tick: {
              format: d => d.toFixed(2)
            }
          },
          x: {
            type: 'timeseries',
            tick: {
              // TODO determine appropriate accuracy
              format: '%Y-%m-%d'
            }
          }
        },
        size: {
          height: 500
        }
      })
    }
    
    let displaySingleParamChart = key => {
      // timeseries of single parameter
      let param = this.cov.parameters.get(key)
      
      // convert from ratio to percentage
      let percentageColumn = [key].concat(ranges.get(key).values.map(v => v*100))
     
      let obsPropLabel
      let cats = param.observedProperty.statisticalCategories
      if (cats && cats.length === 1) {
        obsPropLabel = i18n(cats[0].label) + ' Percentage'
      } else {
        obsPropLabel = i18n(param.observedProperty.label)
      }
      
      c3.generate({
        bindto: $$('.chart-container', modalEl),
        data: {
          x: 't',
          columns: [tColumn, percentageColumn],
          names: {
            [key]: obsPropLabel
          }
        },
        legend: {
          show: false
        },
        grid: {
          y: {
            show: true
          }
        },
        tooltip: {
          format: {
            value: value => value.toFixed(2) + '%'
          }
        },
        axis: {
          y: {
            label: {
              text: obsPropLabel + ' (%)',
              position: 'outer-middle'
            },
            tick: {
              format: d => d.toFixed(2)
            }
          },
          x: {
            type: 'timeseries',
            tick: {
              // TODO determine appropriate accuracy
              format: '%Y-%m-%d'
            }
          }
        }
      })
    }
    
    $('select', modalEl).on('change', () => {
      let key = $$('select', modalEl).value
      if (!key) {
        displayStackedChart()
      } else {
        displaySingleParamChart(key)
      }
    })
            
    new Modal(modalEl[0]).open()
    
    setTimeout(() => displayStackedChart(), 500)
  }
  
}

StatisticalCoverageView.type = VIEW
