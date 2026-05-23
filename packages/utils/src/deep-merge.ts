const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_DEPTH = 50;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

/**
 * Deep merges two objects, with override values taking precedence.
 * - Objects are recursively merged
 * - Arrays are replaced (not concatenated)
 * - undefined values in override do not overwrite base values
 *
 * @example
 * deepMerge({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 10 }, e: 5 })
 * // => { a: 1, b: { c: 10, d: 3 }, e: 5 }
 */
export function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>, depth?: number): T;
export function deepMerge<T extends Record<string, unknown>>(base: T | undefined, override: T | undefined, depth?: number): T | undefined;
export function deepMerge<T extends Record<string, unknown>>(
  base: T | undefined,
  override: T | undefined,
  depth = 0
): T | undefined {
  if (!base && !override) return undefined;
  if (!base) return override;
  if (!override) return base;
  if (depth > MAX_DEPTH) return override ?? base;

  const result = { ...base } as Record<string, unknown>;

  for (const key of Object.keys(override)) {
    if (DANGEROUS_KEYS.has(key)) continue;

    const baseValue = base[key];
    const overrideValue = override[key];

    if (overrideValue === undefined) continue;

    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      result[key] = deepMerge(baseValue, overrideValue, depth + 1);
    } else {
      result[key] = overrideValue;
    }
  }

  return result as T;
}
