import Catalogue from './Catalogue.js'
import AnalysisCatalogue from './AnalysisCatalogue.js'

/**
 * Something like a controller.
 */
export default class App {
  constructor () {
    this.catalogue = new Catalogue()
    this.analysisCatalogue = new AnalysisCatalogue()
  }
}