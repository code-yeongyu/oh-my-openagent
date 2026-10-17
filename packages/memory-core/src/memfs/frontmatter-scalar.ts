/**
 * The single-line scalar subset of YAML that memory frontmatter uses, written
 * without a YAML runtime dependency (the extension bundle has no byte budget
 * for one). The rules are deliberately conservative: a plain scalar is
 * accepted only when the `yaml` package's core schema is known to read it
 * back verbatim, and anything else is emitted as a JSON double-quoted scalar,
 * which is a valid YAML double-quoted scalar. `frontmatter-strict-yaml.test.ts`
 * pins this subset against the real `yaml` package.
 */

export const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

const PLAIN_UNSAFE_LEAD_RE = /^[-?:,[\]{}#&*!|>'"%@`]/
const CONTROL_OR_TAB_RE = /[\u0000-\u001f\u007f]/
const CORE_SCHEMA_SPECIAL_RE = /^(?:true|True|TRUE|false|False|FALSE|null|Null|NULL|~)$/
const CORE_SCHEMA_NUMBER_RE =
  /^(?:0o[0-7]+|0x[0-9a-fA-F]+|[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/
const DOUBLE_QUOTED_JSON_RE = /^"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"$/
const SINGLE_QUOTED_RE = /^'(?:[^']|'')*'$/

export function isYamlMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isQuotedScalarSource(raw: string): boolean {
  return raw.length >= 2 && (raw.startsWith('"') || raw.startsWith("'"))
}

/** Decode a quoted scalar written in the JSON / single-quote subset; undefined when it is not one. */
export function decodeQuotedScalar(raw: string): string | undefined {
  if (DOUBLE_QUOTED_JSON_RE.test(raw)) {
    try {
      const value: unknown = JSON.parse(raw)
      return typeof value === "string" ? value : undefined
    } catch {
      return undefined
    }
  }
  if (SINGLE_QUOTED_RE.test(raw)) return raw.slice(1, -1).replace(/''/g, "'")
  return undefined
}

/** Decode a JSON array of non-empty strings (the `aliases` shape); undefined otherwise. */
export function decodeStringArray(raw: string): readonly string[] | undefined {
  if (!raw.startsWith("[")) return undefined
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!Array.isArray(value)) return undefined
  return value.every((item): item is string => typeof item === "string") ? value : undefined
}

export function isPlainSafeScalar(value: string): boolean {
  if (value.length === 0 || value !== value.trim()) return false
  if (CONTROL_OR_TAB_RE.test(value) || PLAIN_UNSAFE_LEAD_RE.test(value)) return false
  if (value.includes(": ") || value.endsWith(":") || value.includes(" #")) return false
  return !CORE_SCHEMA_SPECIAL_RE.test(value) && !CORE_SCHEMA_NUMBER_RE.test(value)
}

export function renderStringScalar(value: string): string {
  return isPlainSafeScalar(value) ? value : JSON.stringify(value)
}

/** The value the memory reader sees for `key: raw`: a quoted scalar decoded, a plain one verbatim. */
export function decodeScalarSource(raw: string): string {
  return decodeQuotedScalar(raw) ?? raw
}

/** Raw scalar source that strict YAML reads exactly as the memory reader does. */
export function isCanonicalScalarSource(raw: string): boolean {
  if (isQuotedScalarSource(raw)) return decodeQuotedScalar(raw) !== undefined
  if (raw.startsWith("[")) return decodeStringArray(raw) !== undefined
  return isPlainSafeScalar(raw) || CORE_SCHEMA_SPECIAL_RE.test(raw) || CORE_SCHEMA_NUMBER_RE.test(raw)
}

export function renderRawScalar(raw: string): string {
  return isCanonicalScalarSource(raw) ? raw : JSON.stringify(raw)
}
