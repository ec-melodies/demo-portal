import Eventable from './Eventable.js'

export default class AnalysisCatalogue extends Eventable {
  constructor () {
    super()
    this._datasets = new Map()
  }
  
  addDataset (dataset) {
    if (!this._datasets.has(dataset.id)) {
      this._datasets.set(dataset.id, dataset)
      this.fire('add', {dataset})
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
}
