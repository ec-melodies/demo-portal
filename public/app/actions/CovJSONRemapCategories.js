import {default as Action, PROCESS} from './Action.js'
import CovJSON from '../formats/CovJSON.js'
import JSONLD from '../formats/JSONLD.js'

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
    
    // Step 1: search for distributions in workspace that can be used as a mapping or as categories source;
    //         if no distributions found, display message and guide user
    // Step 2: display distributions in a list with "Use" buttons
    // Step 3: after the user presses the "Use" button, a new virtual dataset is created
    //         with a single distribution which is immediately displayed
    //         The virtual distribution has the remapping info attached so that it is possible
    //         to modify the mapping in the same virtual dataset.
    //         This info is stored directly in CovJSON as provenance data (derivedFrom
    // When a remapping is "modified" then this means removing the old virtual distribution and
    // adding a new one.
    
    // display "Modify" button when this is a remapped coverage
    /*
    let isRemapped = this._isRemapped()
    
    // display categories and remapping specs that can be used
    let catDists = this._findCategoryDistributions()
    let remappingDists = this._findCategoryDistributions()
    */
    
  }
  
  /**
   * Returns all distributions which have categories, including categories contained in coverage data.
   */
  _findCategoryDistributions () {
    return this._filterDistributions(dist => {
      if (dist.formatImpl instanceof CovJSON) {
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
          dists.push(dist)
        }
      }
    }
    return dists
  }
  
}

CovJSONRemapCategories.type = PROCESS
