import {indexOfNearest} from 'leaflet-coverage/util/arrays.js'
import * as referencingUtil from 'leaflet-coverage/util/referencing.js'

import {i18n} from '../util.js'

import {default as Action, PROCESS} from './Action.js'

/**
 * Compare a model grid against an observation collection.
 */
export default class CoverageModelObservationCompare extends Action {
  constructor (data) {
    super()
    
    if (this._isSingleCoverage(data)) {
      this.cov = this._getSingleCoverage(data)
    } else {
      this.cov = data
    }
    
    this.label = 'Intercompare'
    this.icon = '<span class="glyphicon glyphicon-stats"></span>'
  }
  
  get isSupported () {
    
  }
  
  run () {
    // Step 1: determine if this dataset is the model grid or the observation collection
    // Step 2: display modal for selecting the dataset to compare against
    //         (filter appropriately by coverage type / collection)
    // Step 3: display modal for selecting the parameters to compare against (if more than one)
    // Step 4: interactive map display
    //         - if there is a model time dimension, display that as an axis selector
    //           and have an observation time dimension extent selector (e.g. +- 1h)
    //         - the intercomparison data is calculated for the current model time step and observation time extent
    //           (don't subset by bounding box for now, do globally, we'll see how it goes)
    //         - the result is a virtual dataset which is NOT added to the workspace,
    //           it is just used for displaying the data as if it was added as a dataset
    //         - there is a button "Store as Dataset" which adds the current virtual comparison dataset
    //           to the workspace
    //         - when clicking on a comparison point, a popup is shown with plots etc.
  }
  
}

CoverageModelObservationCompare.type = PROCESS

function deriveIntercomparisonStatistics (modelGridCoverage, insituCoverageCollection, modelParamKey, insituParamKey) {
  
  // Basic requirements:
  // - the measurement units of both input parameters must be equal
  // - the model and insitu axes must have the same meaning and CRS
  // If any of that is not the case, then the input has to be transformed before-hand.
  
  // The following combinations for the Z axes are possible:
  // - the model has a fixed Z axis and the insitu coverages have a fixed or varying Z axis
  // - the model has a varying Z axis and the insitu coverages have a fixed or varying Z axis
  // - the model has a fixed Z axis and the insitu coverages have no Z axis
  // - the model has no Z axis and the insitu coverages have a fixed or no Z axis
  
  // The model grid must have:
  // - X and Y axes
  
  // Both inputs can have other fixed axes (like T), but those will be discarded in the result.
  
  // If one input has a fixed, the other a varying Z axis, then there are multiple choices
  // for matching up Z values. In that case the closest Z value is chosen and the result
  // is the absolute difference between both measurement values.
  
  // If both inputs have varying Z axes, then the insitu Z steps are used as base for extracting
  // a virtual vertical profile from the model grid (picking the closest slices from the grid).
  // In that case, the resulting statistics is the standard deviation (RMSE).
  
  // If neither of the inputs has a Z axis, then the resulting statistics is the absolute difference
  // between both measurement values, equal to the case when one input has a fixed Z axis.
  
  // The above is done for every insitu coverage in the collection.
  // The result is again a collection, but of Point coverages.
  // For each Point coverage, the input model grid and the input insitu coverage are referenced
  // by their IDs. This is to help with connecting data and specifically combined visualization
  // (info popups, plots etc.).
  
  // Formula used in all cases (n = number of z steps or 1 if no z axis):
  // RMSE = sqrt ( ( sum_{i=1}^n (x_i - y_i)^2 ) / n)
  // (simplifies to absolute difference if n=1)
  
  // Currently, we hard-code the statistics axis to 'z' but it can be any varying axis along which to calculate the RMSE.
  // For example, z could be fixed and the time axis 't' is varying instead.
  // This would however require that in-situ coverages have a time axis, which is typically not the case,
  // instead each new observation is a separate coverage (the reason is that the z values are often not the same).
  let Z = 'z'
    
  // TODO check that model and insitu coverages have the same CRSs
  
  let model = modelGridCoverage
  let insituCovs = insituCoverageCollection.coverages
  
  let modelParam = model.parameters.get(modelParamKey)
  
  let promises = [
    model.loadDomain(),
    Promise.all(insituCovs.map(cov => cov.loadDomain())),
    Promise.all(insituCovs.map(cov => cov.loadRange(insituParamKey)))
  ]
  
  return Promise.all(promises).then(([modelDomain, insituDomains, insituRanges]) => {
    for (let [key,axis] of modelDomain.axes) {
      if (['x','y',Z].indexOf(key) === -1 && axis.values.length > 1) {
        throw new Error('Only x,y,' + Z + ' can be varying axes in the model grid, not: ' + key)
      }
    }
    
    let modelHasZ = modelDomain.axes.has(Z)
    let modelZ = modelHasZ ? modelDomain.axes.get(Z).values : null 
    
    let insitus = insituCovs.map((cov, i) => ({
      cov,
      domain: insituDomains[i],
      range: insituRanges[i]
    }))
    
    let promises = []
    for (let insitu of insitus) {
      for (let [key,axis] of insitu.domain.axes) {
        if (key !== Z && axis.values.length > 1) {
          throw new Error('Only ' + Z + ' can be a varying axis in in-situ coverages, not: ' + key)
        }
      }
      
      let insituX = insitu.domain.axes.get('x').values[0]
      let insituY = insitu.domain.axes.get('y').values[0]
      let insituHasZ = insitu.domain.axes.has(Z)
      let insituZ = insituHasZ ? insitu.domain.axes.get(Z).values : null
      
      if (insituHasZ && insituZ.length > 1 && !modelHasZ) {
        throw new Error('Model grid must have a ' + Z + ' axis if insitu data has a varying ' + Z + ' axis')
      }
      if (!insituHasZ && modelHasZ && modelZ.length > 1) {
        throw new Error('Model grid must not have a varying ' + Z + ' axis if insitu data has no ' + Z + ' axis')
      }
          
      // TODO we want the geographically closest grid cell, but subsetByValue is defined numerically only
      //  -> for x (longitude, wrap-around) we could implement our own search algorithm and use subsetByIndex then
      //  -> this gets complicated for arbitrary projected CRSs though
      let promise = model.subsetByValue({x: {target: insituX}, y: {target: insituY}}).then(modelSubset => {
        return Promise.all([modelSubset.loadDomain(), modelSubset.loadRange(modelParamKey)])
          .then(([modelSubsetDomain, modelSubsetRange]) => {
            
            // collect the values to compare against each other
            let modelVals = []
            let insituVals = []
            if (!modelHasZ || modelZ.length === 1) {
              modelVals = [modelSubsetRange.get({})]
              
              if (!insituHasZ || insituZ.length === 1) {
                insituVals = [insitu.range.get({})]
              } else {
                // varying insitu z, get closest value to grid z
                let zIdxClosest = indexOfNearest(insituZ, modelZ[0])
                let val = insitu.range.get({[Z]: zIdxClosest})
                insituVals.push(val)
              }
            } else {
              // varying model z
              for (let z of insituZ) {
                let zIdxClosest = indexOfNearest(modelZ, z)
                let val = modelSubsetRange.get({[Z]: zIdxClosest})
                modelVals.push(val)
              }
              
              for (let i=0; i < insituZ.length; i++) {
                let val = insitu.range.get({[Z]: i})
                insituVals.push(val)
              } 
            }
            
            // calculate RMSE = sqrt ( ( sum_{i=1}^n (x_i - y_i)^2 ) / n)
            let n = modelVals.length
            let sum = zip(modelVals, insituVals)
              .map(([v1,v2]) => Math.pow(v1-v2, 2))
              .reduce((l,r) => l+r)
            let rmse = Math.sqrt(sum / n)
            
            // assemble the result into a CovJSON Point coverage            
            let covjson = {
              "type": "Coverage",
              "profile": "PointCoverage",
              "wasGeneratedBy": {
                "type": "ModelObservationComparisonActivity",
                "qualifiedUsage": [{
                  "entity": modelGridCoverage.id,
                  "hadRole": "modelToCompareAgainst"
                }, {
                  "entity": insitu.cov.id,
                  "hadRole": "observationToCompareAgainst"
                }]
              },
              "domain": {
                "type": "Domain",
                "profile": "Point",
                "axes": {
                  "x": { "values": [insituX] },
                  "y": { "values": [insituY] }
                }
              },
              "ranges": {
                "rmse": {
                  "type": "Range",
                  "values": [rmse],
                  "dataType": "float"
                }
              }
            }
            
            return covjson            
          })
      })
      
      promises.push(promise)
    }
    
    return Promise.all(promises).then(covjsons => {
      // put statistical point coverages into a CovJSON collection
      
      let coll = {
        "@context": {
          "prov": "http://www.w3.org/ns/prov#",
          "wasGeneratedBy": "prov:wasGeneratedBy",
          "qualifiedUsage": "prov:qualifiedUsage",
          "entity": {"@id": "prov:entity", "@type": "@id"},
          "hadRole": {"@id": "prov:hadRole", "@type": "@vocab"},
          "covstats": "http://covstats#",
          "ModelObservationComparisonActivity": "covstats:ModelObservationComparisonActivity",
          "modelToCompareAgainst": "covstats:modelToCompareAgainst",
          "observationToCompareAgainst": "covstats:observationToCompareAgainst"
        },
        "type": "CoverageCollection",
        "profile": "PointCoverageCollection",
        "parameters": {
          "rmse": {
            "type": "Parameter",
            "unit": modelParam.unit,
            "observedProperty": {
              "label": {
                "en": "RMSE of " + i18n(modelParam.observedProperty.label)
              },
              // TODO is stddev ok here? uncertml doesn't know RMSE
              "statisticalMeasure": "http://www.uncertml.org/statistics/standard-deviation"
            }
          }
        },
        "referencing": [{
          // FIXME the order could be different, or even be a x-y-z CRS
          "dimensions": ["x","y"],
          "srs": referencingUtil.getRefSystem(modelDomain, ['x','y'])
        }],
        "coverages": covjsons
      }
      return coll
    })
  })  
}

function zip (a, b) {
  return a.map((e, i) => [a[i], b[i]])
}
