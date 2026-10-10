import { isPlainObject, isUnsafeObjectKey } from "../internal/plain-object"

type ConfigEdit = { readonly path: readonly string[]; readonly value: unknown }

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((entry, index) => deepEqual(entry, right[index]))
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false
  const leftKeys = Object.keys(left)
  if (leftKeys.length !== Object.keys(right).length) return false
  return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key]))
}

export function withoutMarker(document: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const { _migrations: _marker, ...rest } = document
  return rest
}

export function diffEdits(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
  path: readonly string[] = [],
): ConfigEdit[] {
  const edits: ConfigEdit[] = []
  for (const key of Object.keys(before)) {
    if (isUnsafeObjectKey(key)) continue
    if (!Object.prototype.hasOwnProperty.call(after, key)) edits.push({ path: [...path, key], value: undefined })
  }
  for (const [key, value] of Object.entries(after)) {
    if (isUnsafeObjectKey(key)) continue
    const nextPath = [...path, key]
    if (!Object.prototype.hasOwnProperty.call(before, key)) {
      edits.push({ path: nextPath, value })
      continue
    }
    const previous = before[key]
    if (deepEqual(previous, value)) continue
    if (isPlainObject(previous) && isPlainObject(value)) {
      edits.push(...diffEdits(previous, value, nextPath))
      continue
    }
    edits.push({ path: nextPath, value })
  }
  return edits
}
