import L from 'leaflet'

import kdTree from './kdTree.js'

/**
 * A uniform collection of point-like layers (typically Markers).
 * All point layers must have the same "parameter",
 * "palette", and "paletteExtent" properties.
 * To keep palettes synchronized, use the ParameterSync class.
 */
class PointCollection extends L.Class {
  constructor () {
    // TODO implement
    
    // should this class directly use ParameterSync?
    // -> setting the parameter/palette should probably be possible
    
    this.layer = L.layerGroup()
  }
  
  getValueAt (latlng, radius) {
    // TODO implement
    // use kd-tree to find closest point
    // https://github.com/ubilabs/kd-tree-javascript
  }
  
  get parameter () {
    
  }
  
  get palette () {
    
  }
  
  get paletteExtent () {
    
  }
}

PointCollection.include(L.Mixin.Events)

//work-around for Babel bug, otherwise PointCollection cannot be referenced here
export { PointCollection as default }