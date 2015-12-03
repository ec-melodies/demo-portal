import Eventable from './Eventable.js'
import GeoJSONLoader from './loaders/GeoJSONLoader.js'
import CovJSONLoader from './loaders/CovJSONLoader.js'
import JSONLDLoader from './loaders/JSONLDLoader.js'

export default class AnalysisCatalogue extends Eventable {
  constructor () {
    super()
    this._datasets = new Map()
    
    this._loaders = [
      new GeoJSONLoader(),
      new CovJSONLoader(), 
      new JSONLDLoader()
      ]
  }
  
  addDataset (dataset) {
    if (!this._datasets.has(dataset.id)) {
      this._datasets.set(dataset.id, dataset)
      this.fire('add', {dataset})
      this._loadDistributionMetadata(dataset)
    }
  }
  
  removeDataset (dataset) {
    if (this._datasets.has(dataset.id)) {
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
  _loadDistributionMetadata (dataset) {
    this.fire('distributionsMetadataLoading', {dataset})
    let promises = []
    for (let distribution of dataset.distributions) {
      for (let loader of this._loaders) {
        if (loader.supports(distribution.mediaType)) {
          this.fire('distributionMetadataLoading', {dataset, distribution})
          let urlOrData = distribution.accessURL || distribution.downloadURL || distribution.data
          let promise = loader.loadMetadata(urlOrData).then(meta => {
            distribution.metadata = meta
            this.fire('distributionMetadataLoad', {dataset, distribution})
          }).catch(e => {
            distribution.error = e
            this.fire('distributionMetadataLoadError', {dataset, distribution, error: e})
          })
          promises.push(promise)
        }
      }
    }
    Promise.all(promises).then(() => {
      this.fire('distributionsMetadataLoad', {dataset})
    })
  }
}
