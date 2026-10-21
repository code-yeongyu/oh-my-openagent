/**
 * Writing a name into a config object safely.
 *
 * A server, a provider or a credential is named by something the user controls, and `__proto__`
 * is a name like any other to them. Assigning it would reach the prototype setter and change
 * what the object inherits from, so it is written as an own property instead.
 */

export const PROTOTYPE_NAMES = new Set(["__proto__", "constructor", "prototype"])

/** Whether a name is one that must never be walked into or assigned over. */
export function isPrototypeName(name) {
  return PROTOTYPE_NAMES.has(String(name))
}

/**
 * Write a name into an object as an own, enumerable property.
 *
 * `Object.defineProperty` creates the property itself, so a name that reads as a prototype is
 * just a name here, and it is written to the file like any other.
 */
export function defineEntry(target, name, value) {
  Object.defineProperty(target, name, { value, enumerable: true, writable: true, configurable: true })
  return target
}
