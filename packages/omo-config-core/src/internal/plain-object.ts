const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"])

export function isUnsafeObjectKey(key: string): boolean {
  return DANGEROUS_KEYS.has(key)
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  )
}

export function hasTamperedPrototype(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((entry) => hasTamperedPrototype(entry))
  if (typeof value !== "object" || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return true
  return Object.values(value).some((entry) => hasTamperedPrototype(entry))
}
