const deep = new WeakSet<object>()

/**
 * A read-only map with no mutating method; its entries live in a private field, so Map.prototype.set cannot reach them.
 * It is not a Map: `instanceof Map` is false and structuredClone copies it as an empty object. Test for one with
 * isReadonlyMap.
 */
class ClosedMap<K, V> implements ReadonlyMap<K, V> {
  readonly #inner: Map<K, V>

  constructor(entries: Iterable<readonly [K, V]>) {
    this.#inner = new Map(entries)
    Object.freeze(this)
  }

  get size(): number {
    return this.#inner.size
  }

  get(key: K): V | undefined {
    return this.#inner.get(key)
  }

  has(key: K): boolean {
    return this.#inner.has(key)
  }

  forEach(callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void): void {
    for (const [key, value] of this.#inner) callback(value, key, this)
  }

  entries(): MapIterator<[K, V]> {
    return this.#inner.entries()
  }

  keys(): MapIterator<K> {
    return this.#inner.keys()
  }

  values(): MapIterator<V> {
    return this.#inner.values()
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.#inner[Symbol.iterator]()
  }
}

/** The set counterpart of ClosedMap, with the same caveats: test for one with isReadonlySet. */
class ClosedSet<T> implements ReadonlySet<T> {
  readonly #inner: Set<T>

  constructor(values: Iterable<T>) {
    this.#inner = new Set(values)
    Object.freeze(this)
  }

  get size(): number {
    return this.#inner.size
  }

  has(value: T): boolean {
    return this.#inner.has(value)
  }

  forEach(callback: (value: T, again: T, set: ReadonlySet<T>) => void): void {
    for (const value of this.#inner) callback(value, value, this)
  }

  entries(): SetIterator<[T, T]> {
    return this.#inner.entries()
  }

  keys(): SetIterator<T> {
    return this.#inner.keys()
  }

  values(): SetIterator<T> {
    return this.#inner.values()
  }

  [Symbol.iterator](): SetIterator<T> {
    return this.#inner[Symbol.iterator]()
  }

  union<U>(other: ReadonlySetLike<U>): Set<T | U> {
    return this.#inner.union(other)
  }

  intersection<U>(other: ReadonlySetLike<U>): Set<T & U> {
    return this.#inner.intersection(other)
  }

  difference<U>(other: ReadonlySetLike<U>): Set<T> {
    return this.#inner.difference(other)
  }

  symmetricDifference<U>(other: ReadonlySetLike<U>): Set<T | U> {
    return this.#inner.symmetricDifference(other)
  }

  isSubsetOf(other: ReadonlySetLike<unknown>): boolean {
    return this.#inner.isSubsetOf(other)
  }

  isSupersetOf(other: ReadonlySetLike<unknown>): boolean {
    return this.#inner.isSupersetOf(other)
  }

  isDisjointFrom(other: ReadonlySetLike<unknown>): boolean {
    return this.#inner.isDisjointFrom(other)
  }
}

/** True for a native Map and for the closed map a frozen copy holds in its place. */
export const isReadonlyMap = (value: unknown): value is ReadonlyMap<unknown, unknown> => value instanceof Map || value instanceof ClosedMap

/** True for a native Set and for the closed set a frozen copy holds in its place. */
export const isReadonlySet = (value: unknown): value is ReadonlySet<unknown> => value instanceof Set || value instanceof ClosedSet

const registered = <T extends object>(value: T): T => {
  deep.add(value)
  return value
}

const isPlain = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const freezeDeep = (value: unknown, keep: (value: object) => boolean): unknown => {
  if (typeof value === "function") throw new TypeError("a verified state holds only plain data, never a function")
  if (typeof value !== "object" || value === null) return value
  if (deep.has(value) || keep(value)) return value
  if (Array.isArray(value)) return registered(Object.freeze(value.map((item) => freezeDeep(item, keep))))
  if (value instanceof Map) return registered(new ClosedMap([...value].map(([key, item]) => [freezeDeep(key, keep), freezeDeep(item, keep)])))
  if (value instanceof Set) return registered(new ClosedSet([...value].map((item) => freezeDeep(item, keep))))
  if (!isPlain(value)) throw new TypeError("a verified state holds only plain data")
  return registered(Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freezeDeep(item, keep)]))))
}

const isCopyOf = <T>(copy: unknown, original: T): copy is T => copy === original || (typeof copy === "object" && copy !== null && deep.has(copy))

/**
 * A copy of `value` in which nothing reachable can change: objects and arrays are frozen, maps and
 * sets become closed read-only collections. Values `keep` accepts (branded, already-frozen values
 * whose identity carries trust) are kept as they are, and parts copied earlier are shared.
 */
export const frozenCopy = <T>(value: T, keep: (value: object) => boolean): T => {
  const copy = freezeDeep(value, keep)
  if (!isCopyOf(copy, value)) throw new Error("unreachable: a frozen copy is always registered")
  return copy
}
