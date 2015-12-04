import {default as Action, PROCESS} from './Action.js'

export default class CovJSONRemapCategories extends Action {
  constructor (data) {
    super()
    this.cov = data
    
    this.label = 'Remap Categories'
  }
  
  get isSupported () {
    // Use Case: Category Remapping for grids
    // Current restriction: data is single grid coverage with single categorical parameter
    let cov = this.cov
    if (!('coverages' in cov) && cov.domainType.endsWith('Grid')) {
      if (cov.parameters.size === 1) {
        let param = cov.parameters.values().next().value
        if (param.observedProperty.categories) {
          return true
        }
      }
    }
    return false
  }
  
  run () {
    // open UI for remapping etc.
  }
}

CovJSONRemapCategories.type = PROCESS