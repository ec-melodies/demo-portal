export default class Eventable {
  constructor () {
    this.listeners = new DefaultMap(() => [])
  }
  
  on (event, fn) {
    this.listeners.get(event).push(fn)
  }
  
  fire (event, data) {
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