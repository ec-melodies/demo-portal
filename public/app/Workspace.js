import Eventable from './Eventable.js'

export default class Workspace extends Eventable {
  constructor (formats) {
    super()
    this._datasets = new Map()
    
    this._formats = formats
    this._staticActionContext = {}
  }
  
  /**
   * Context that should be set on every Action after it is instantiated.
   */
  addStaticActionContext (staticContext) {
    for (let key of Object.keys(staticContext)) {
      this._staticActionContext[key] = staticContext[key]
    }
  }
  
  /**
   * @param {object} dataset The dataset to add.
   * @param {object} [parent] 
   *   The parent dataset out of which the dataset creation was triggered.
   *   This is currently used for UI purposes only to insert the new dataset at
   *   an appropriate place.
   */
  addDataset (dataset, parent) {
    if (!dataset.id) {
      dataset.id = new Date().getTime()
    }
    if (!this._datasets.has(dataset.id)) {
      // deep copy as we may modify the dataset (e.g. the title)
      dataset = JSON.parse(JSON.stringify(dataset))
      this._datasets.set(dataset.id, dataset)
      this.fire('add', {dataset, parent})
      this._loadDistribution(dataset)
    }
  }
  
  removeDataset (dataset) {
    if (this._datasets.has(dataset.id)) {
      // give all actions a chance to clean up
      for (let dist of dataset.distributions.filter(dist => 'actions' in dist)) {
        for (let action of dist.actions) {
          action.remove()
        }
      }
      this._datasets.delete(dataset.id)
      this.fire('remove', {dataset})
    }
  }
  
  requestFocus (dataset) {
    this.fire('requestFocus', {dataset})
  }
  
  setDatasetTitle (dataset, title) {
    dataset.title = {unknown: title}
    this.fire('titleChange', {dataset})
  }
  
  get datasets () {
    return [...this._datasets.values()]
  }
  
  filterDistributions (matchFn) {
    let dists = []
    for (let dataset of this.datasets) {
      for (let dist of dataset.distributions) {
        if (matchFn(dist)) {
          dists.push({distribution: dist, dataset})
        }
      }
    }
    return dists
  }
    
  /**
   * Loads analysable distributions of a dataset and stores metadata about them
   * in their "metadata" field.
   * If the format/API supports it then only the metadata part (or similar)
   * of a distribution is loaded.
   * 
   * Note that the loaded distributions are not cached or stored in any way
   * to prevent out-of-memory situations.
   * 
   * To support virtual datasets that we derived in some way,
   * a distribution object can also have a "data" property (which is
   * a JavaScript object) instead of an accessURL or downloadURL.
   * It would be infeasible to persist such data somehow into a Blob and
   * use URL.createObjectURL(blob) just to get a URL.
   */
  _loadDistribution (dataset) {
    this.fire('distributionsLoading', {dataset})
    let promises = []
    for (let distribution of dataset.distributions) {
      for (let format of this._formats) {
        if (format.supports(distribution.mediaType)) {
          this.fire('distributionLoading', {dataset, distribution})
          let urlOrData = distribution.url || distribution.data
          distribution.formatImpl = format
          let promise = format.load(urlOrData).then(data => {
            let meta = format.getMetadata(data)
            
            let actionContext = {dataset, distribution, workspace: this}
            for (let key in this._staticActionContext) {
              actionContext[key] = this._staticActionContext[key]
            }
            
            let actions = format.getActions(data, actionContext)
            
            distribution.metadata = meta
            distribution.actions = actions
            distribution.data = data

            this.fire('distributionLoad', {dataset, distribution})
          }).catch(e => {
            distribution.error = e
            this.fire('distributionLoadError', {dataset, distribution, error: e})
            console.log(e)
          })
          promises.push(promise)
        }
      }
    }
    Promise.all(promises).then(() => {
      this.fire('distributionsLoad', {dataset})
    })
  }
}
