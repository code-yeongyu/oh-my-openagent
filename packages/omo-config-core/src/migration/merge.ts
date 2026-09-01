import { isPlainObject, isUnsafeObjectKey } from "../internal/plain-object"

export type NoClobberMergeResult = {
  readonly additions: Record<string, unknown>
  readonly diagnostics: readonly string[]
  readonly merged: Record<string, unknown>
}

function displayValue(value: unknown): string {
  const encoded = JSON.stringify(value)
  return encoded === undefined ? String(value) : encoded
}

function displayPath(path: readonly string[]): string {
  return path.join(".")
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => cloneValue(entry))
  if (!isPlainObject(value)) return value

  const clone: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (isUnsafeObjectKey(key)) continue
    clone[key] = cloneValue(entry)
  }
  return clone
}

function hasOwn(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function mergeInto(
  existing: Readonly<Record<string, unknown>>,
  legacy: Readonly<Record<string, unknown>>,
  path: readonly string[],
  diagnostics: string[],
): Record<string, unknown> {
  const additions: Record<string, unknown> = {}

  for (const [key, legacyValue] of Object.entries(legacy)) {
    if (isUnsafeObjectKey(key)) continue
    const nextPath = [...path, key]
    if (!hasOwn(existing, key)) {
      additions[key] = cloneValue(legacyValue)
      continue
    }

    const keptValue = existing[key]
    if (isPlainObject(keptValue) && isPlainObject(legacyValue)) {
      const nested = mergeInto(keptValue, legacyValue, nextPath, diagnostics)
      if (Object.keys(nested).length > 0) additions[key] = nested
      continue
    }

    diagnostics.push(`skipped: ${displayPath(nextPath)} legacy=${displayValue(legacyValue)} kept=${displayValue(keptValue)}`)
  }

  return additions
}

function applyAdditions(
  existing: Readonly<Record<string, unknown>>,
  additions: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result = cloneValue(existing)
  if (!isPlainObject(result)) throw new Error("Migration target must be a plain object")

  for (const [key, value] of Object.entries(additions)) {
    if (isUnsafeObjectKey(key)) continue
    const current = result[key]
    result[key] = isPlainObject(current) && isPlainObject(value)
      ? applyAdditions(current, value)
      : cloneValue(value)
  }
  return result
}

export function mergeWithoutClobber(
  existing: Readonly<Record<string, unknown>>,
  legacy: Readonly<Record<string, unknown>>,
): NoClobberMergeResult {
  const diagnostics: string[] = []
  const additions = mergeInto(existing, legacy, [], diagnostics)
  return {
    additions,
    diagnostics,
    merged: applyAdditions(existing, additions),
  }
}

export function collectMigrationEdits(
  value: Readonly<Record<string, unknown>>,
  path: readonly string[] = [],
): readonly { readonly path: readonly string[]; readonly value: unknown }[] {
  const edits: { path: readonly string[]; value: unknown }[] = []

  for (const [key, entry] of Object.entries(value)) {
    if (isUnsafeObjectKey(key)) continue
    const nextPath = [...path, key]
    if (isPlainObject(entry) && Object.keys(entry).length > 0) {
      edits.push(...collectMigrationEdits(entry, nextPath))
    } else {
      edits.push({ path: nextPath, value: cloneValue(entry) })
    }
  }

  return edits
}
