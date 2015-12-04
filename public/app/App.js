import Catalogue from './Catalogue.js'
import AnalysisCatalogue from './AnalysisCatalogue.js'

import CovJSON from './formats/CovJSON.js'
import GeoJSON from './formats/GeoJSON.js'
import JSONLD from './formats/JSONLD.js'
import WMS from './formats/WMS.js'

import CovJSONView from './actions/CovJSONView.js'
import CovJSONRemapCategories from './actions/CovJSONRemapCategories.js'
import GeoJSONView from './actions/GeoJSONView.js'
import WMSView from './actions/WMSView.js'

/**
 * Something like a main controller.
 */
export default class App {
  constructor (map) {
    this.map = map
            
    this.catalogue = new Catalogue()
    
    this.formats = [
      new CovJSON([
         CovJSONView,
         CovJSONRemapCategories
      ]),
      new GeoJSON([
        GeoJSONView
      ]),
      new WMS([
        WMSView
      ]),
      new JSONLD()
    ]
    
    this.analysisCatalogue = new AnalysisCatalogue(this.formats)
    this.analysisCatalogue.addStaticActionContext({map})
  }
}