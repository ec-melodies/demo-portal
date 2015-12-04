import Action from './Action.js'

export default function factory (map) {
  return data => new CovJSONRemapCategories(data, map)
} 

export class CovJSONRemapCategories extends Action {
  constructor (data, map) {
    super()
    this.cov = data
    this.map = map
    
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