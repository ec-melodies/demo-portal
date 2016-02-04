import {DefaultMap} from './util.js'

export default class Eventable {
  constructor () {
    this.listeners = new DefaultMap(() => new Set())
  }
  
  on (events, fn) {
    events = Array.isArray(events) ? events : [events]
    for (let event of events) {
      this.listeners.get(event).add(fn)
    }
    return this
  }
  
  off (event, fn) {
    if (!this.listeners.get(event).delete(fn)) {
      throw new Error('Event listener not found')
    }
  }
  
  fire (event, data) {
    console.log(`Event: '${event}', Class: ${this.constructor.name}, Data:`, data)
    // create a copy before interation to avoid issues when adding listeners while iterating
    for (let fn of new Set(this.listeners.get(event))) {
      fn(data)
    }
  }
}

