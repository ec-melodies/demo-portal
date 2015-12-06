export default class Eventable {
  constructor () {
    this.listeners = new DefaultMap(() => [])
  }
  
  on (events, fn) {
    events = Array.isArray(events) ? events : [events]
    for (let event of events) {
      this.listeners.get(event).push(fn)
    }
    return this
  }
  
  fire (event, data) {
    console.log(`Event: '${event}', Class: ${this.constructor.name}, Data:`, data)
    for (let fn of this.listeners.get(event)) {
      fn(data)
    }
  }
}

/**
 * A Map which returns a default value for get(key) if key does not exist.
 */
class DefaultMap extends Map {
  constructor (defaultFactory, iterable) {
    super(iterable)
    this.defaultFactory = defaultFactory
  }
  get (key) {
    if (!this.has(key)) {
      this.set(key, this.defaultFactory())
    }
    return super.get(key)
  }
}