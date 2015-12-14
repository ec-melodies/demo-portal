import Eventable from '../Eventable.js'

export default class Format extends Eventable {
  constructor (actionClasses) {
    super()
    this.actionClasses = actionClasses || []
    // overwrite in subclass
    this.label = undefined
    this.shortLabel = undefined
    this.mediaTypes = undefined
  }
  
  supports (mediaType) {
    return mediaType && this.mediaTypes.some(m => mediaType.toLowerCase().startsWith(m))
  }
  
  getActions (obj, context) {
    let actions = []
    for (let actionClass of this.actionClasses) {
      let action = new actionClass(obj)
      action.context = context
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
      console.log(data)
      this.fire('load')
      return data
    }).catch(error => {
      this.fire('loadError', {error})
      throw error
    })
  }
}