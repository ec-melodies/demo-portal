import L from 'leaflet'
import {$, HTML} from 'minified' 

const DEFAULT_TEMPLATE_ID = 'template-image-legend'
const DEFAULT_TEMPLATE = `
<template id="${DEFAULT_TEMPLATE_ID}">
  <div class="info legend image-legend">
    <div class="legend-title">
      <strong class="legend-title-text"></strong>
    </div>
    <img alt="Legend" />
  </div>
</template>
<style>
.legend {
  color: #555;
}
.legend-title {
  margin-bottom:3px;
}
</style>
`

export default class ImageLegend extends L.Control {
  
  constructor (url, options) {
    super(options.position ? {position: options.position} : {})
    this.url = url
    this.title = options.title
    this.layer = options.layer
    this.id = options.id || DEFAULT_TEMPLATE_ID
    
    if (!options.id && document.getElementById(DEFAULT_TEMPLATE_ID) === null) {
      $('body').add(HTML(DEFAULT_TEMPLATE))
    }
  }
  
  onRemove (map) {
    if (this.layer) {
      map.off('layerremove', this._remove)
    }
  }
  
  onAdd (map) {
    if (this.layer) {
      this._remove = e => {
        if (e.layer !== this.layer) return
        this.removeFrom(map)
      }
      map.on('layerremove', this._remove)
    }
    
    let el = document.importNode($('#' + this.id)[0].content, true).children[0]
    this._el = el
    $('img', el).set('@src', this.url)
    if (this.title) {
      $('.legend-title-text', el).fill(this.title)  
    } else {
      $('.legend-title', el).hide() 
    }    
    
    return el
  }
  
}
