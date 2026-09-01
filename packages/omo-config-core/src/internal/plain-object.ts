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
