import Eventable from '../Eventable.js'

export default class Format extends Eventable {
  constructor (actionClasses) {
    super()
    this.actionClasses = actionClasses || []
    this.label = '<OVERWRITE ME>'
    this.shortLabel = this.label
  }
  
  getActions (obj) {
    let actions = []
    for (let actionClass of this.actionClasses) {
      let action = new actionClass(obj)
      if (action.isSupported) {
        actions.push(action)
        this.fire('actionCreate', {action})
      }
    }
    return actions
  }
  
  load (input) {
    this.fire('loading')
    return this.doLoad(input).then(data => {
      this.fire('load')
      return data
    }).catch(error => {
      this.fire('loadError', {error})
      throw error
    })
  }
}