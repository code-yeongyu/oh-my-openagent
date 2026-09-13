import {
  FRONTMATTER_RE,
  decodeQuotedScalar,
  decodeStringArray,
  isCanonicalScalarSource,
  isPlainSafeScalar,
  isQuotedScalarSource,
} from "./frontmatter-scalar"

/** Mirrors the skill loader's `MAX_DESCRIPTION_LENGTH`; memory descriptions also feed the prompt index. */
export const MAX_DESCRIPTION_LENGTH = 1024

const TOOL_CALL_SCAFFOLDING_RE = /<\/?(?:description|parameter)\b[^>]*>?/i
const HEADER_LINE_RE = /^([A-Za-z0-9_-]+):(?:[ \t]+(.*?))?[ \t]*$/

export function describeDescriptionViolation(description: string): string | null {
  if (description.trim().length === 0) return "'description' must not be empty"
  if (/[\r\n]/.test(description)) return "'description' must be a single line"
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return `'description' exceeds ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`
  }
  const scaffolding = TOOL_CALL_SCAFFOLDING_RE.exec(description)
  if (scaffolding !== null) {
    return `'description' contains tool-call scaffolding ("${scaffolding[0]}"); the arguments of this call were malformed and split incorrectly - resend it with a one-line description and the body in file_text`
  }
  return null
}

/**
 * Validate a memory file against the strict single-line frontmatter grammar
 * (every value a safe plain scalar, a JSON-quoted scalar, or a JSON string
 * array) plus the description contract. Returns the first violation, or null
 * when a strict YAML consumer such as the skill loader reads the file exactly
 * as the memory reader does.
 */
export function describeFrontmatterViolation(content: string): string | null {
  return describeFrontmatterWith(content, describeHeaderViolation)
}

/** Grammar only: what the renderer and the legacy normalizer guarantee; description content rules stay at the tool boundary and the reflection gate. */
export function describeFrontmatterGrammarViolation(content: string): string | null {
  return describeFrontmatterWith(content, describeHeaderGrammarViolation)
}

export function describeHeaderViolation(headerText: string): string | null {
  const grammar = describeHeaderGrammarViolation(headerText)
  if (grammar !== null) return grammar
  return describeDescriptionViolation(headerDescription(headerText))
}

export function describeHeaderGrammarViolation(headerText: string): string | null {
  const seen = new Set<string>()
  let description: string | undefined
  for (const line of headerText.split("\n")) {
    if (line.trim().length === 0) continue
    if (/^[ \t]/.test(line)) return `indented continuation lines are not allowed (single-line scalars only): ${line.trim()}`
    if (line.startsWith("#")) return `comment lines are not allowed in frontmatter: ${line}`
    const parsed = HEADER_LINE_RE.exec(line)
    if (parsed === null) return `not a 'key: value' line: ${line}`
    const key = parsed[1] ?? ""
    const raw = parsed[2] ?? ""
    if (seen.has(key)) return `duplicate frontmatter key '${key}'`
    seen.add(key)
    const violation = describeValueViolation(key, raw)
    if (violation !== null) return violation
    if (key === "description") description = decodeQuotedScalar(raw) ?? raw
  }
  if (description === undefined) return "missing required field 'description'"
  if (description.trim().length === 0) return "'description' must not be empty"
  if (/[\r\n]/.test(description)) return "'description' must be a single line"
  return null
}

function describeFrontmatterWith(content: string, check: (headerText: string) => string | null): string | null {
  const match = FRONTMATTER_RE.exec(content.replace(/\r\n?/g, "\n"))
  if (match === null) return "missing frontmatter (must start with --- and close with ---)"
  return check(match[1] ?? "")
}

function headerDescription(headerText: string): string {
  for (const line of headerText.split("\n")) {
    const parsed = HEADER_LINE_RE.exec(line)
    if (parsed?.[1] === "description") return decodeQuotedScalar(parsed[2] ?? "") ?? parsed[2] ?? ""
  }
  return ""
}

function describeValueViolation(key: string, raw: string): string | null {
  if (raw.length === 0) return key === "description" ? "'description' must not be empty" : `'${key}' has no value`
  if (isQuotedScalarSource(raw)) {
    return decodeQuotedScalar(raw) === undefined
      ? `'${key}' is not a valid quoted scalar (use JSON double quotes): ${raw}`
      : null
  }
  if (raw.startsWith("[")) {
    return decodeStringArray(raw) === undefined ? `'${key}' must be a JSON array of strings: ${raw}` : null
  }
  if (/^[>|]/.test(raw)) return `'${key}' must be a non-empty single line`
  // description and kind are string-typed; every other key (read_only, SKILL.md extras) may also
  // carry a YAML boolean or number as long as strict YAML reads the same text the memory reader keeps.
  const safe = key === "description" || key === "kind" ? isPlainSafeScalar(raw) : isCanonicalScalarSource(raw)
  return safe ? null : `'${key}' is not a safe YAML plain scalar (quote it, or remove ': ' and ' #'): ${raw}`
}
