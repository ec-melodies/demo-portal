export default class Format {
  constructor (actionClasses) {
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
      }
    }
    return actions
  }
}