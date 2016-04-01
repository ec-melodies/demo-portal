import {indexOfNearest, indicesOfNearest} from 'leaflet-coverage/util/arrays.js'
import * as referencingUtil from 'leaflet-coverage/util/referencing.js'
import {COVJSON_GRID} from 'leaflet-coverage/util/constants.js'
import TimeAxis from 'leaflet-coverage/controls/TimeAxis.js'
import SelectControl from './SelectControl.js'
import ButtonControl from './ButtonControl.js'

import {$,$$, HTML} from 'minified'
import Modal from 'bootstrap-native/lib/modal-native.js'

import {i18n, COVJSON_PREFIX} from '../util.js'
import CoverageData from '../formats/CoverageData.js'
import {default as Action, VIEW, PROCESS} from './Action.js'

const PointCollection = COVJSON_PREFIX + 'PointCoverageCollection'
const ProfileCollection = COVJSON_PREFIX + 'VerticalProfileCoverageCollection'

const TYPE = {
    MODEL: 1,
    OBSERVATIONS: 2
}

let html = `
<div class="modal fade" id="comparisonDatasetSelectModal" tabindex="-1" role="dialog" aria-labelledby="comparisonDatasetSelectModalLabel">
  <div class="modal-dialog" role="document">
    <div class="modal-content">
      <div class="modal-header">
        <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
        <h4 class="modal-title" id="comparisonDatasetSelectModalLabel">Select a dataset to compare against</h4>
      </div>
      <div class="modal-body">
        
        <div class="panel panel-primary">
          <div class="panel-heading">
            <h4>Model-Observation comparison</h4>
          </div>
          <div class="panel-body">
            <p class="help-text-model">
              The gridded input dataset that you selected is assumed to be the model dataset that is compared
              against an observation collection dataset (point or vertical profile observations).
              Please select the observation dataset below.
            </p>
            <p class="help-text-observations">
              The collection-type input dataset that you selected is assumed to be the observation set that is
              compared against a model grid dataset.
              Please select the model dataset below.
            </p>
            <div class="alert alert-info comparison-distribution-list-empty" role="alert"><strong>None found.</strong></div>
          </div>
          
          <ul class="list-group comparison-distribution-list"></ul>
        </div>
       
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>
      </div>
    </div>
  </div>
</div>

<div class="modal fade" id="comparisonParametersSelectModal" tabindex="-1" role="dialog" aria-labelledby="comparisonParametersSelectModalLabel">
  <div class="modal-dialog" role="document">
    <div class="modal-content">
      <div class="modal-header">
        <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
        <h4 class="modal-title" id="comparisonParametersSelectModalLabel">Select parameters</h4>
      </div>
      <div class="modal-body">
        
        <div class="panel panel-primary">
          <div class="panel-body">
            <p>
              Select the parameters you wish to compare.
              Note that currently no unit conversion is done.
            </p>
              
            <div class="form-horizontal">
              <div class="form-group">
                <label for="modelComparisonParameter" class="col-sm-3 control-label">Model</label>
                <div class="col-sm-9">
                  <select id="modelComparisonParameter" class="form-control model-parameter-select"></select>
                </div>
              </div>
              
              <div class="form-group">
                <label for="observationComparisonParameter" class="col-sm-3 control-label">Observations</label>
                <div class="col-sm-9">
                  <select id="observationComparisonParameter" class="form-control observation-parameter-select"></select>
                </div>
              </div>
            </div>
                          
            <div class="parameter-select-button-container"></div>
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
  'comparison-distribution-item': `
  <li class="list-group-item">
    <h4 class="list-group-item-heading dataset-title"></h4>
    <p>Distribution: <span class="distribution-title"></span></p>
    <button type="button" class="btn btn-primary select-button" data-dismiss="modal">
      Select
    </button>
  </li>
  `,
  'params-select-button': `<button type="button" class="btn btn-primary params-select-button" data-dismiss="modal">Select</button>`
}


/**
 * Compare a model grid against an observation collection.
 */
export default class CoverageModelObservationCompare extends Action {
  constructor (data, context) {
    super(context)
    
    this.data = data
    
    this.label = 'Intercompare'
    this.icon = '<span class="glyphicon glyphicon-stats"></span>'
  }
  
  get isSupported () {
    return getCovData(this.data)
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
    //         - the result is a virtual dataset which is added to the workspace and displayed
    //         - when clicking on a comparison point, a popup is shown with plots etc.
    //         - when changing times the virtual dataset is replaced by a new one
    
    this._displayDistributionSelectModal()
  }
  
  _displayDistributionSelectModal () {
    let {data, type} = getCovData(this.data)
    
    let modalEl = $('#comparisonDatasetSelectModal')
    
    let dists
    if (type === TYPE.MODEL) {
      $('.help-text-model', modalEl).show()
      $('.help-text-observations', modalEl).hide()
      
      dists = this.context.workspace.filterDistributions(dist => {
        if (dist.formatImpl instanceof CoverageData) {
          let covdata = getCovData(dist.data)
          return covdata && covdata.type === TYPE.OBSERVATIONS
        }
      })
    } else {
      $('.help-text-model', modalEl).hide()
      $('.help-text-observations', modalEl).show()
      
      dists = this.context.workspace.filterDistributions(dist => {
        if (dist.formatImpl instanceof CoverageData) {
          let covdata = getCovData(dist.data)
          return covdata && covdata.type === TYPE.MODEL
        }
      })
    }
    
    $('.comparison-distribution-list', modalEl).fill()
    for (let {distribution,dataset} of dists) {
      let el = $(HTML(TEMPLATES['comparison-distribution-item']))
      
      $('.dataset-title', el).fill(i18n(dataset.title))
      $('.distribution-title', el).fill(i18n(distribution.title))
      
      $('.select-button', el).on('|click', () => {
        if (type === TYPE.MODEL) {
          this._displayParameterSelectModal(data, distribution.data)
        } else {
          // extract grid from 1-element collection if necessary 
          let modelCov = getCovData(distribution.data).data
          this._displayParameterSelectModal(modelCov, data)
        }
      })
            
      $('.comparison-distribution-list', modalEl).add(el)
    }
    $$('.comparison-distribution-list-empty', modalEl).style.display = dists.length > 0 ? 'none' : 'block'
    
    new Modal(modalEl[0]).open()
  }
  
  _displayParameterSelectModal (modelCov, observationsColl) {        
    let modelParams = getNonCategoricalParams(modelCov)
    let observationsParams = getNonCategoricalParams(observationsColl)
    
    let modalEl = $('#comparisonParametersSelectModal')
    
    let fillSelect = (el, params) => {
      el.fill()
      for (let param of params) {
        let unit = (param.unit.symbol || i18n(param.unit.label)) || 'unknown unit'
        let label = i18n(param.observedProperty.label) + ' (' + unit + ')'
        el.add(HTML('<option value="' + param.key + '">' + label + '</option>'))
      }
    }
    
    fillSelect($('.model-parameter-select', modalEl), modelParams)
    fillSelect($('.observation-parameter-select', modalEl), observationsParams)
    
    // we add this anew each time to get rid of old event listeners
    $('.parameter-select-button-container', modalEl).fill(HTML(TEMPLATES['params-select-button']))
    
    $('.params-select-button', modalEl).on('|click', () => {
      let modelParamKey = $$('.model-parameter-select', modalEl).value
      let observationsParamKey = $$('.observation-parameter-select', modalEl).value
      this._displayIntercomparisonUI (modelCov, observationsColl, modelParamKey, observationsParamKey)
    })
    
    new Modal(modalEl[0]).open()
  }
  
  _displayIntercomparisonUI (modelCov, observationsColl, modelParamKey, observationsParamKey) {
    let map = this.context.map
    
    this._intercomparisonActive = true
    
    let doIntercomparison = (modelTime, obsTimeDelta) => {
      this.fire('loading')
      let promises
      if (modelTime) {
        // subset model + filter observations
        let obsStart = new Date(modelTime.getTime() - obsTimeDelta*1000)
        let obsStop = new Date(modelTime.getTime() + obsTimeDelta*1000)
        promises = [
          modelCov.subsetByValue({t: modelTime.toISOString()}),
          observationsColl.query()
            .filter({t: {start: obsStart.toISOString(), stop: obsStop.toISOString()}})
            .execute({eagerload: true})
        ]
      } else {
        promises = [modelCov, observationsColl]
      }
      Promise.all(promises).then(([modelCovSubset, obsCollFiltered]) => {
        deriveIntercomparisonStatistics(modelCovSubset, obsCollFiltered, modelParamKey, observationsParamKey).then(covjsonobj => {
          this.fire('load')
          let workspace = this.context.workspace 
          
          // discard old intercomparison dataset
          if (this._intercomparisonResultDataset) {
            workspace.removeDataset(this._intercomparisonResultDataset)
          }
          
          // create new dataset and display          
          let covjson = JSON.stringify(covjsonobj, null, 2)
    
          // NOTE: we don't call URL.revokeObjectURL() currently when removing the dataset again
          let blobUrl = URL.createObjectURL(new Blob([covjson], {type: 'application/prs.coverage+json'}))
          
          let prefixTitle = 'Intercomparison'
          if (modelTime) {
            let modelTimeISO = modelTime.toISOString()
            let obsTimeDeltaStr = '± ' + Math.round(obsTimeDelta/60) + ' min'
            prefixTitle += ' [Model: ' + modelTimeISO + ', Observations: ' + obsTimeDeltaStr + ']'            
          }

          let virtualDataset = {
            title: { en: prefixTitle },
            virtual: true,
            distributions: [{
              title: { en: prefixTitle },
              mediaType: 'application/prs.coverage+json',
              url: blobUrl
            }]
          }
          this._intercomparisonResultDataset = virtualDataset
          
          // display after loading
          var done = ({dataset}) => {
            if (dataset === virtualDataset) {
              dataset.distributions[0].actions.find(a => a.type === VIEW).run()                  
              workspace.off('distributionsLoad', done)
            }
          }
          workspace.on('distributionsLoad', done)
          workspace.addDataset(virtualDataset, this.context.dataset)
        })
      })
    }
    
    // UI
    modelCov.loadDomain().then(modelDomain => {
      if (modelDomain.axes.has('t')) {
        // display time controls
        
        // Model: simple time axis control
        let modelTimeSlices = modelDomain.axes.get('t').values.map(t => new Date(t))
        let modelFakeLayer = {timeSlices: modelTimeSlices, time: modelTimeSlices[0]}
        this._modelTimeControl = new TimeAxis(modelFakeLayer, {title: 'Model time'})
          .on('change', ({time}) => {
            let obsTimeDelta = parseInt(this._obsTimeDeltaControl.value)
            doIntercomparison(time, obsTimeDelta)
          })
          .addTo(map)
        
        // Observations: time delta control
        let choices = [
          { value: 60, label: '± 1 min' },
          { value: 60*10, label: '± 10 min' },
          { value: 60*30, label: '± 30 min' }, 
          { value: 60*60, label: '± 1 hour' },
          { value: 60*60*24, label: '± 1 day' }, 
          { value: 60*60*24*30, label: '± 30 days' }]
        this._obsTimeDeltaControl = new SelectControl(null, choices, {title: 'Observation time delta'})
          .on('change', event => {
            let obsTimeDelta = parseInt(event.value)
            let modelTime = modelFakeLayer.time
            doIntercomparison(modelTime, obsTimeDelta)
          })
          .addTo(map)
          
        // to start, apply first model time slice and first delta choice
        doIntercomparison(modelFakeLayer.time, choices[0].value)
        
        let doneButton = new ButtonControl({title: 'Exit Intercomparison'}).addTo(map)
        doneButton.on('click', () => {
          map.removeControl(this._modelTimeControl)
          map.removeControl(this._obsTimeDeltaControl)
          map.removeControl(doneButton)
          let viewAction = this._intercomparisonResultDataset.distributions[0].actions.find(a => a.type === VIEW)
          if (viewAction.visible) {
            // hide it
            viewAction.run()
          }
          this._intercomparisonActive = false
        })
        
      } else {
        doIntercomparison()
      }
    })
  }
}

CoverageModelObservationCompare.type = PROCESS

/**
 * Prepares coverage data for comparison, i.e. assigns the semantic type (model or observations)
 * and also extracts grids from 1-element collections.
 * If the coverage data is not suitable for intercomparison, then undefined is returned.
 */
function getCovData (data) {
  // either a Grid (=model) or a collection of Point or VerticalProfile coverages (=observations)
  // also, there must be non-categorical parameters
  let res
  if (data.coverages) {
    if (data.profiles.indexOf(PointCollection) !== -1 || data.profiles.indexOf(ProfileCollection) !== -1) {
      res = {type: TYPE.OBSERVATIONS, data}
    }
    // check if Grid in a 1-element collection
    if (data.coverages.length === 1 && data.coverages[0].domainProfiles.indexOf(COVJSON_GRID) !== -1) {
      res = {type: TYPE.MODEL, data: data.coverages[0]}
    }
  } else if (data.domainProfiles.indexOf(COVJSON_GRID) !== -1) {
    res = {type: TYPE.MODEL, data}      
  }
  if (res && getNonCategoricalParams(res.data).length === 0) {
    res = undefined
  }
  return res
}

function getNonCategoricalParams (cov) {
  let params = [...cov.parameters.values()]
  return params.filter(param => !param.observedProperty.categories)
}

// TODO move to reusable module
function subsetGridToPointsSimple (gridCov, points) {
  return Promise.all(points.map(([x,y]) => {
    // we want exactly the grid cell in which the point is locatedlink:
    return gridCov.subsetByValue({x: {start: x, stop: x}, y: {start: y, stop: y}}, {eagerload: true})
  }))
}

/**
 * Returns a subsetted XY grid which fits the given x and y extent.
 */
function subsetHorizontalGrid (xVals, yVals, xExtent, yExtent) {
  let [xMin, xMax] = xExtent
  let [yMin, yMax] = yExtent
    
  // snap xMin, xMax etc to grid
  xMin = xVals[indexOfNearest(xVals, xMin)]
  xMax = xVals[indexOfNearest(xVals, xMax)]
  yMin = yVals[indexOfNearest(yVals, yMin)]
  yMax = yVals[indexOfNearest(yVals, yMax)]
  
  // determine resolution of grid (assumes a regular grid)
  // TODO support non-regular grids (rectilinear)
  let dx = Math.abs(xVals[0] - xVals[1])
  let dy = Math.abs(yVals[0] - yVals[1])
  
  let nx = Math.round((xMax - xMin)/dx + 1)
  let ny = Math.round((yMax - yMin)/dy + 1)
  let arr = new Uint8Array(nx * ny)
  
  // convenience functions
  let idx = (ix,iy) => nx*iy + ix
  let xv2i = x => Math.round((x-xMin)/dx)
  let yv2i = y => Math.round((y-yMin)/dy)
  let vidx = (x,y) => idx(xv2i(x), yv2i(y))

  return {
    nx, ny,
    dx, dy,
    get: (ix, iy) => arr[idx(ix,iy)],
    set: (ix, iy, v) => arr[idx(ix,iy)] = v,
    vset: (x, y, v) => arr[vidx(x,y)] = v,
    ix2v: ix => xMin + ix * dx,
    iy2v: iy => yMin + iy * dy
  }
}

/*
// debug function
function print2D (matrix) {
  for (let iy=0; iy < matrix.ny; iy++) {
    let line = ''
    for (let ix=0; ix < matrix.nx; ix++) {
      line += matrix.get(ix,iy) + ' '
    }
    console.log(line)
  }
}

// debug function
function print2DCoords (matrix) {
  console.log('x:')
  let line = ''
  for (let ix=0; ix < matrix.nx; ix++) {
    line += matrix.ix2v(ix) + ' '
  }
  console.log(line)
  console.log('y:')
  for (let iy=0; iy < matrix.ny; iy++) {
    console.log(matrix.iy2v(iy))
  }
}
*/

// TODO move to reusable module
function subsetGridToPointsConnected (gridCov, points) {
  // try to find rectangles in order to limit the number of grid subset queries
    
  let X = 'x'
  let Y = 'y'
    
  // TODO handle points outside grid domain
    
  let xs = points.map(([x]) => x)
  let ys = points.map(([,y]) => y)
  let xExtent = [Math.min(...xs), Math.max(...xs)]
  let yExtent = [Math.min(...ys), Math.max(...ys)]
  
  return gridCov.loadDomain().then(domain => {
    let hits = subsetHorizontalGrid(domain.axes.get(X).values, domain.axes.get(Y).values, xExtent, yExtent)
            
    // all points are placed into a 2D hit matrix
    for (let [x,y] of points) {
      hits.vset(x, y, 1)
    }
        
    // find hit rectangles, as big as possible
    // an approximative algorithm is used, picking the first rectangles it finds
    let rectangles = findRectangles(hits)
    
    // some debug stats
    let sizes = rectangles.map(([ix1,iy1,ix2,iy2]) => (ix2-ix1+1) * (iy2-iy1+1))
    let connected = sizes.filter(s => s > 1).length
    console.log('grid subset queries total: ' + rectangles.length + ', connected: ' + connected)
    
    // convert to axis values
    let rectanglesCenter = rectangles.map(([ix1,iy1,ix2,iy2]) => 
      [hits.ix2v(ix1), hits.iy2v(iy1), 
       hits.ix2v(ix2), hits.iy2v(iy2)])
    
    let {dx,dy} = hits
    let rectanglesBounds = rectanglesCenter.map(([x1,y1,x2,y2]) => 
      [x1-dx/2, y1-dy/2, 
       x2+dx/2, y2+dy/2])

    // map to subsets
    // the center coordinates are used to avoid fetching neighboring cells
    let rectSubsetPromises = rectanglesCenter.map(([x1,y1,x2,y2]) => 
      gridCov.subsetByValue({x: {start: x1, stop: x2}, y: {start: y1, stop: y2}}, {eagerload: true}))
    
    return Promise.all(rectSubsetPromises).then(rectSubsets => {
      let pointSubsetPromises = []
      for (let [x,y] of points) {
        let rectSubset
        for (let i=0; i < rectangles.length; i++) {
          let [x1,y1,x2,y2] = rectanglesBounds[i]
          if (x1 <= x && x <= x2 && y1 <= y && y <= y2) {
            rectSubset = rectSubsets[i]
            break
          }
        }
        if (!rectSubset) {
          throw new Error('bug')
        }
        // TODO check if this subset is done locally by coverage-rest-client
        //  -> currently yes because coverage-rest-client can't handle API info within "derivedFrom"
        //     (fortunate coincidence! fix it!)
        pointSubsetPromises.push(rectSubset.subsetByValue({x: {start: x, stop: x}, y: {start: y, stop: y}}, {eagerload: true}))
      }
      return Promise.all(pointSubsetPromises)
    })
  })
}

/**
 * Returns as-big-as-possible rectangles of 1's in a 2D matrix.
 * 
 * Note: The matrix gets modified in-place during processing.
 * 
 * TODO move to reusable module
 * 
 * @param {object} matrix An object with get(ix,iy), set(ix,iy,v) functions and nx, ny properties
 * @returns {array<[x1,y1,x2,y2]>} rectangles with top-left and bottom-right index coordinates
 */
function findRectangles (matrix) {
  /* matrix:
   * 1 1 1 0 1
   * 1 1 0 1 1
   * 0 0 1 1 1
   */
  
  let {nx,ny} = matrix
  
  // find hit rectangles, as big as possible
  // an approximative algorithm is used, picking the first rectangles it finds

  // pre-compute vertical lengths of consecutive 1s
  for (let iy=ny-2; iy >= 0; iy--) {
    for (let ix=0; ix < nx; ix++) {
      let val = matrix.get(ix, iy)
      if (val > 0) {
        matrix.set(ix, iy, val + matrix.get(ix, iy+1))
      }
    }
  }
  
  /* matrix:
   * 2 2 1 0 3
   * 1 1 0 2 2
   * 0 0 1 1 1
   */
  
  // now iterate through each row and if v > 0 then expand to the right until value <  v
  // and mark found rectangles as 0 in matrix matrix
  let rectangles = []
  
  for (let iy=0; iy < ny; iy++) {
    for (let ix=0; ix < nx; ix++) {
      // any hit here?
      let v = matrix.get(ix, iy)
      if (v === 0) {
        continue
      }
      // expand rectangle to the right keeping initial height
      let ix2 = ix + 1
      while (ix2 < nx && matrix.get(ix2, iy) >= v) {
        ix2++
      }
      ix2 -= 1
      let iy2 = iy + v - 1
      // add the found rectangle
      rectangles.push([ix, iy, ix2, iy2])
      // clear rectangle area (skip over first row as we don't look at it again)
      for (let iy3=iy+1; iy3 <= iy2; iy3++) {
        for (let ix3=ix; ix3 <= ix2; ix3++) {
          matrix.set(ix3, iy3, 0)
        }
      }
      // skip over rectangle
      ix = ix2
    }
  }
  
  return rectangles
}

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
  
  let X = 'x'
  let Y = 'y'
    
  // TODO check that model and insitu coverages have the same CRSs
  
  let model = modelGridCoverage
  let modelParam = model.parameters.get(modelParamKey)
      
  return model.loadDomain().then(modelDomain => {
    for (let [key,axis] of modelDomain.axes) {
      if ([X,Y,Z].indexOf(key) === -1 && axis.values.length > 1) {
        throw new Error('Only x,y,' + Z + ' can be varying axes in the model grid, not: ' + key)
      }
    }
    let modelHasZ = modelDomain.axes.has(Z)
    let modelZ = modelHasZ ? modelDomain.axes.get(Z).values : null
    let modelHasVaryingZ = modelZ && modelZ.length > 1
    let modelZMin = modelZ ? Math.min(modelZ[0], modelZ[modelZ.length-1]) : null
    let modelZMax = modelZ ? Math.max(modelZ[0], modelZ[modelZ.length-1]) : null
    
    function deriveCovJSONs (insituCollection) {
      let hasNextPage = insituCollection.paging && insituCollection.paging.next
      let nextPage = hasNextPage ? insituCollection.paging.next.load({eagerload: true}) : undefined
      
      let insituCovs = insituCollection.coverages
      
      let promises = [Promise.all(insituCovs.map(cov => cov.loadDomain())),
                      Promise.all(insituCovs.map(cov => cov.loadRange(insituParamKey)))]

      return Promise.all(promises).then(([insituDomains, insituRanges]) => {
        let insitus = insituCovs.map((cov, i) => ({
          cov,
          domain: insituDomains[i],
          range: insituRanges[i]
        }))
        
        let points = insitus.map(insitu => ({x: insitu.domain.axes.get(X).values[0], y: insitu.domain.axes.get(Y).values[0]}))
        let fromProj = referencingUtil.getProjection(insituDomains[0])
        let toProj = referencingUtil.getProjection(modelDomain)
        points = points.map(point => referencingUtil.reproject(point, fromProj, toProj)).map(({x,y}) => [x,y])
        let modelSubsetsPromise = subsetGridToPointsConnected(model, points)
        
        // TODO wrap the insitu collection/pagination and split into tiles (should happen outside this function)
        //      then the rectangle search may find bigger rectangles (since observations are naturally clustered then)
        
        return modelSubsetsPromise.then(modelSubsets => {
          let promises = []
          for (let [insitu, modelSubset] of insitus.map((v,i) => [v, modelSubsets[i]])) {
            for (let [key,axis] of insitu.domain.axes) {
              if (key !== Z && axis.values.length > 1) {
                throw new Error('Only ' + Z + ' can be a varying axis in in-situ coverages, not: ' + key)
              }
            }
            
            let insituX = insitu.domain.axes.get(X).values[0]
            let insituY = insitu.domain.axes.get(Y).values[0]
            let insituHasZ = insitu.domain.axes.has(Z)
            let insituZ = insituHasZ ? insitu.domain.axes.get(Z).values : null
            let insituHasVaryingZ = insituZ && insituZ.length > 1
            
            if (insituHasVaryingZ && !modelHasZ) {
              throw new Error('Model grid must have a ' + Z + ' axis if insitu data has a varying ' + Z + ' axis')
            }
            if (!insituHasZ && modelHasVaryingZ) {
              throw new Error('Model grid must not have a varying ' + Z + ' axis if insitu data has no ' + Z + ' axis')
            }
            
            let promise = modelSubset.loadRange(modelParamKey).then(modelSubsetRange => {              
              // collect the values to compare against each other
              let modelVals = []
              let insituVals = []
              if (!modelHasVaryingZ) {
                let modelVal = modelSubsetRange.get({})
                
                let insituVal
                if (!insituHasVaryingZ) {
                  insituVal = insitu.range.get({})
                } else {
                  // varying insitu z, get closest value to grid z
                  let zIdxClosest = indexOfNearest(insituZ, modelZ[0])
                  insituVal = insitu.range.get({[Z]: zIdxClosest})
                }
                if (modelVal !== null && insituVal !== null) {
                  modelVals = [modelVal]
                  insituVals = [insituVal]
                }
              } else {
                // varying model z
                
                // linear interpolation
                let interp = (z,z0,v0,z1,v1) => v0 + (v1 - v0)*(z - z0)/(z1 - z0)
                
                for (let i=0; i < insituZ.length; i++) {
                  let z = insituZ[i]
                  if (z < modelZMin || z > modelZMax) {
                    // we don't extrapolate
                    continue
                  }
                  let insituVal = insitu.range.get({[Z]: i})
                  if (insituVal === null) {
                    continue
                  }
                  
                  // interpolate between nearest model points on z axis
                  let [zIdxClosest1,zIdxClosest2] = indicesOfNearest(modelZ, z)
                  let [zClosest1,zClosest2] = [modelZ[zIdxClosest1], modelZ[zIdxClosest2]]
                  let val1 = modelSubsetRange.get({[Z]: zIdxClosest1})
                  let val2 = modelSubsetRange.get({[Z]: zIdxClosest2})
                  if (val1 === null || val2 === null) {
                    // We could be more clever here and search for other points.
                    // However, model grids will likely not have partially missing values at one x/y point anyway.
                    continue
                  }
                  
                  let val
                  if (zIdxClosest1 === zIdxClosest2) {
                    val = val1
                  } else {
                    val = interp(z, zClosest1, val1, zClosest2, val2)
                  }
                  modelVals.push(val)                
                  insituVals.push(insituVal)
                }
              }
              
              if (modelVals.length === 0) {
                return
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
                  "qualifiedUsage": {
                    "model": {
                      "entity": modelGridCoverage.id,
                      "hadRole": "modelToCompareAgainst",
                      "parameterKey": modelParamKey
                    },
                    "observation": {
                      "entity": insitu.cov.id,
                      "hadRole": "observationToCompareAgainst",
                      "parameterKey": insituParamKey
                    }
                  }
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
            
            promises.push(promise)
          }
          
          return Promise.all([Promise.all(promises),nextPage]).then(([covjsons,nextPageColl]) => {
            if (nextPageColl) {
              return deriveCovJSONs(nextPageColl).then(nextCovjsons => covjsons.concat(nextCovjsons))
            } else {
              return covjsons
            }
          })
        })
      })
    }
    
    return deriveCovJSONs(insituCoverageCollection).then(covjsons => {
      // put statistical point coverages into a CovJSON collection
      
      covjsons = covjsons.filter(o => o) // filter empty results
      
      let coll = {
        "@context": {
          "prov": "http://www.w3.org/ns/prov#",
          "wasGeneratedBy": "prov:wasGeneratedBy",
          "qualifiedUsage": {"@id": "prov:qualifiedUsage", "@container": "@index"},
          "entity": {"@id": "prov:entity", "@type": "@id"},
          "hadRole": {"@id": "prov:hadRole", "@type": "@vocab"},
          "covstats": "http://covstats#",
          "ModelObservationComparisonActivity": "covstats:ModelObservationComparisonActivity",
          "modelToCompareAgainst": "covstats:modelToCompareAgainst",
          "observationsToCompareAgainst": "covstats:observationsToCompareAgainst",
          "observationToCompareAgainst": "covstats:observationToCompareAgainst",
          "parameterKey": "covstats:parameterKey"
        },
        "type": "CoverageCollection",
        "profile": "PointCoverageCollection",
        "wasGeneratedBy": {
          "type": "ModelObservationComparisonActivity",
          "qualifiedUsage": {
            "model": {
              "entity": modelGridCoverage.id,
              "hadRole": "modelToCompareAgainst",
              "parameterKey": modelParamKey
            },
            "observations": {
              "entity": insituCoverageCollection.id,
              "hadRole": "observationsToCompareAgainst",
              "parameterKey": insituParamKey
            }
          }
        },
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
            },
            "preferredPalette": {
              "interpolation": "linear",
              "colors": ["green", "orange", "red"]
            }
          }
        },
        "referencing": [{
          // FIXME the order could be different, or even be a x-y-z CRS
          "components": ["x","y"],
          "system": referencingUtil.getRefSystem(modelDomain, [X,Y])
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
