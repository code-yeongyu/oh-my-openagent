export type DiffEntry = {
  path: string
  kind: "added" | "removed" | "changed"
  before?: unknown
  after?: unknown
}

export type StructuralDiffResult = {
  diffs: DiffEntry[]
  identical_fields: string[]
  changed_fields: string[]
  structural_analysis: {
    structural_similarity: number
    added_paths: string[]
    removed_paths: string[]
    changed_paths: string[]
  }
}

export function diffJsonBodies(left: string | null, right: string | null): StructuralDiffResult {
  const leftFlat = flatten(parseJson(left))
  const rightFlat = flatten(parseJson(right))
  const paths = new Set([...Object.keys(leftFlat), ...Object.keys(rightFlat)])
  const diffs: DiffEntry[] = []
  const identical: string[] = []
  for (const path of Array.from(paths).sort()) {
    const hasLeft = Object.hasOwn(leftFlat, path)
    const hasRight = Object.hasOwn(rightFlat, path)
    if (!hasLeft) diffs.push({ path, kind: "added", after: rightFlat[path] })
    else if (!hasRight) diffs.push({ path, kind: "removed", before: leftFlat[path] })
    else if (!Object.is(leftFlat[path], rightFlat[path])) diffs.push({ path, kind: "changed", before: leftFlat[path], after: rightFlat[path] })
    else identical.push(path)
  }
  const changed = diffs.map((entry) => entry.path)
  const comparable = identical.length + changed.length
  return {
    diffs,
    identical_fields: identical,
    changed_fields: changed,
    structural_analysis: {
      structural_similarity: comparable === 0 ? 1 : identical.length / comparable,
      added_paths: diffs.filter((entry) => entry.kind === "added").map((entry) => entry.path),
      removed_paths: diffs.filter((entry) => entry.kind === "removed").map((entry) => entry.path),
      changed_paths: diffs.filter((entry) => entry.kind === "changed").map((entry) => entry.path),
    },
  }
}

function parseJson(value: string | null): unknown {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function flatten(value: unknown, prefix = ""): Record<string, unknown> {
  if (value == null || typeof value !== "object") return { [prefix || "$"]: value }
  if (Array.isArray(value)) return flattenArray(value, prefix)
  return flattenRecord(value as Record<string, unknown>, prefix)
}

function flattenArray(values: unknown[], prefix: string): Record<string, unknown> {
  return values.reduce<Record<string, unknown>>((acc, value, index) => ({ ...acc, ...flatten(value, `${prefix}[${index}]`) }), {})
}

function flattenRecord(record: Record<string, unknown>, prefix: string): Record<string, unknown> {
  const entries = Object.entries(record)
  if (entries.length === 0) return { [prefix || "$"]: {} }
  return entries.reduce<Record<string, unknown>>((acc, [key, value]) => ({
    ...acc,
    ...flatten(value, prefix ? `${prefix}.${key}` : key),
  }), {})
}
