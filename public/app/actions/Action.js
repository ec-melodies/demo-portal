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
  constructor (context) {
    super()
    this.context = context || {}
    this.type = this.constructor.type
  }
  
  /**
   * Called when the context that this action belongs to (e.g. dataset) is removed.
   * It allows the action to clean up any UI etc.
   */
  remove () {}
}