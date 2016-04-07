import L from 'leaflet'
import {$,HTML} from 'minified'

let TEMPLATE = 
`<div class="info" style="clear:none">
  <strong class="select-title"></strong><br>
  <select></select>
</div>`

export class SelectControl extends L.Control {
  constructor (covLayer, choices, options) {
    super(options.position ? {position: options.position} : {position: 'topleft'})
    this._title = options.title || ''
    this.covLayer = covLayer
    this._choices = choices
    this.value = choices[0].value

    this._remove = () => this.removeFrom(this._map)
    if (covLayer && covLayer.on) {
      covLayer.on('remove', this._remove)
    }
  }
    
  onRemove (map) {
    if (this.covLayer && this.covLayer.off) {
      this.covLayer.off('remove', this._remove)
    }
  }
  
  onAdd (map) {
    let el = HTML(TEMPLATE)[0]
    L.DomEvent.disableClickPropagation(el)
    
    $('.select-title', el).fill(this._title)
    
    for (let {value, label} of this._choices) {
      $('select', el).add(HTML(`<option value="${value}">${label}</option>`))
    }
    
    $('select', el).on('change', event => {
      this.fire('change', {value: event.target.value})
      this.value = event.target.value
    })
    
    return el
  }
    
}

SelectControl.include(L.Mixin.Events)

//work-around for Babel bug, otherwise SelectControl cannot be referenced here
export { SelectControl as default }
