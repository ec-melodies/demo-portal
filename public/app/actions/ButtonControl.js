import L from 'leaflet'
import {$,HTML} from 'minified'

let TEMPLATE = 
`<div class="info" style="clear:none">
  <button></button>
</div>`

class ButtonControl extends L.Control {
  constructor (options) {
    super(options.position ? {position: options.position} : {position: 'topleft'})
    this._title = options.title
  }
     
  onAdd (map) {
    let el = HTML(TEMPLATE)[0]
    L.DomEvent.disableClickPropagation(el)
    
    $('button', el)
      .fill(this._title)
      .on('click', () => this.fire('click'))
        
    return el
  }
    
}

ButtonControl.include(L.Mixin.Events)

//work-around for Babel bug, otherwise ButtonControl cannot be referenced here
export { ButtonControl as default }
