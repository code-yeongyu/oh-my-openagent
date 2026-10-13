import { V2UnsupportedOperationError } from "../unsupported-operation-error"

const NOT_THENABLE_KEYS: ReadonlySet<string> = new Set(["then", "toJSON", "constructor"])

/** A callable stub at `path` whose every property is another stub and whose call rejects naming `path`. */
export function unsupportedPath(path: readonly string[]): unknown {
  return new Proxy(function unsupportedOperation(): void {}, {
    get(_target, property) {
      if (typeof property === "symbol" || NOT_THENABLE_KEYS.has(property)) return undefined
      return unsupportedPath([...path, property])
    },
    apply() {
      return Promise.reject(new V2UnsupportedOperationError(path.join(".")))
    },
  })
}

/**
 * Exposes the mapped members of `implemented` and turns every other member into an unsupported
 * stub, so a gap fails loudly at the call site instead of returning silently empty data.
 */
export function withFallback<T extends object>(path: readonly string[], implemented: T): T {
  return new Proxy(implemented, {
    get(target, property, receiver) {
      if (typeof property === "symbol" || NOT_THENABLE_KEYS.has(property)) return Reflect.get(target, property, receiver)
      if (Object.hasOwn(target, property)) return Reflect.get(target, property, receiver)
      return unsupportedPath([...path, property])
    },
  })
}
