import {$,$$, HTML} from 'minified'
import Modal from 'bootstrap-native/lib/modal-native.js'

import {i18n} from '../util.js'

import * as transformUtil from 'leaflet-coverage/util/transform.js'
import * as referencingUtil from 'leaflet-coverage/util/referencing.js'

import {default as Action, PROCESS} from './Action.js'

let html = `
`
$('body').add(HTML(html))

const TEMPLATES = {
}

export default class CoverageSubsetByPolygon extends Action {
  constructor (data) {
    super()
    
    if (this._isSingleCoverage(data)) {
      this.cov = this._getSingleCoverage(data)
    } else {
      this.cov = data
    }
    
    this.label = 'Polygon Subset'
    this.icon = '<span class="glyphicon glyphicon-scissors"></span>'
  }
  
  // TODO code duplication with CoverageRemapCategories.js
  get isSupported () {
    // data is single grid coverage
    if (this._isSingleCoverage(this.cov) && this.cov.domainType.endsWith('Grid')) {
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
    // 
  }
  
}

CoverageSubsetByPolygon.type = PROCESS
