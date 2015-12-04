import Eventable from './Eventable.js'

export default class AnalysisCatalogue extends Eventable {
  constructor (formats) {
    super()
    this._datasets = new Map()
    
    this._formats = formats
  }
  
  addDataset (dataset) {
    if (!this._datasets.has(dataset.id)) {
      this._datasets.set(dataset.id, dataset)
      this.fire('add', {dataset})
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
  
  get datasets () {
    return [...this._datasets.values()]
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
          let urlOrData = distribution.accessURL || distribution.downloadURL || distribution.data
          let promise = format.load(urlOrData).then(data => {
            let meta = format.getMetadata(data)
            let actions = format.getActions(data)
            
            // inject context into actions
            for (let action of actions) {
              action.context = {dataset, distribution}
            }
            
            distribution.metadata = meta
            distribution.actions = actions

            this.fire('distributionLoad', {dataset, distribution})
          }).catch(e => {
            distribution.error = e
            this.fire('distributionLoadError', {dataset, distribution, error: e})
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
