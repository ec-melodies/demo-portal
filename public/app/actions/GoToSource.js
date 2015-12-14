import {default as Action, EXTERNAL_LINK} from './Action.js'

export default class GoToSource extends Action {
  constructor (data) {
    super()
    
    this.label = 'Go To Source'
  }
  
  get isSupported () {
    return this.context.distribution.url
  }
  
  run () {
    return this.context.distribution.url
  }
}

GoToSource.type = EXTERNAL_LINK