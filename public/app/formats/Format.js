export default class Format {
  constructor (actionFactories) {
    this._actionFactories = actionFactories || []
  }
  
  getActions (obj) {
    let actions = []
    for (let actionFactory of this._actionFactories) {
      let action = actionFactory(obj)
      if (action.isSupported) {
        actions.push(action)
      }
    }
    return actions
  }
}