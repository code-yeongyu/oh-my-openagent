type JsonRecord = Record<string, unknown>

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === "object") {
    const source = value as JsonRecord
    const out: JsonRecord = {}
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue
      out[key] = canonicalize(source[key])
    }
    return out
  }
  return value
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}
