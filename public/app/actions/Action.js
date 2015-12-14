import Eventable from '../Eventable.js'

export const VIEW = 'view'
export const PROCESS = 'process'
export const EXTERNAL_LINK = 'external_link'

/**
 * Every subclass must add a static `type` property with either VIEW or PROCESS.
 * This is automatically assigned as instance property to allow easier access.
 * 
 * When a subclass is loading external data, then the dataLoading and dataLoad events
 * should be fired.
 */
export default class Action extends Eventable {
  constructor () {
    super()
    this._context = {}
    this.type = this.constructor.type
  }
  /**
   * Set by Workspace._loadDistribution().
   */
  set context (val) {
    this._context = val
  }
  
  get context () {
    return this._context
  }
  
  /**
   * Called when the context that this action belongs to (e.g. dataset) is removed.
   * It allows the action to clean up any UI etc.
   */
  remove () {}
}