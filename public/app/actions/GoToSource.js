import {default as Action, EXTERNAL_LINK} from './Action.js'

export default class GoToSource extends Action {
  constructor (data) {
    super()
    
    this.icon = '<span class="glyphicon glyphicon-link"></span>'
    this.label = 'Source'
  }
  
  get isSupported () {
    return this.context.distribution.url
  }
  
  run () {
    return this.context.distribution.url
  }
}

GoToSource.type = EXTERNAL_LINK