import * as dcat from './dcat.js'
import Eventable from './Eventable.js'

export default class Catalogue extends Eventable {
  constructor () {
    super()
    this.datasets = []
  }
  
  /** 
   * Load a DCAT catalogue and replace the current datasets with the loaded datasets.
   */
  loadFromDCAT (url) {
    this.datasets = []
    return dcat.loadCatalog(url).then(catalog => {
      let datasets = catalog.datasets
      for (let dataset of datasets) {
        this.datasets.push(dataset)
      }
      this.fire('load', {url, datasets})
    })
  }
}
