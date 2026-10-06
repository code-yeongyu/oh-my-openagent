/**
 * Secret-like material scanner and redactor for the memory boundary.
 *
 * One exported scanner with span reporting, shared by every surface that must
 * refuse or mask secret-like text: the sync mirror, the compiled projection,
 * recall hints, command output, and the commit gates. Matching runs on a
 * normalised shadow of the input (format characters and zero-width codepoints
 * stripped, non-breaking spaces folded) so split or visually obfuscated
 * credentials cannot evade it, and spans map back to the original string so
 * masking rewrites the original bytes. The matched text is never logged or
 * returned - only the pattern class and the span.
 */

const MASK = "***"

export type SecretPatternClass =
  | "aws_access_key"
  | "credential_assignment"
  | "authorization_header"
  | "openai_key"
  | "vendor_token"
  | "pem_block"
  | "split_credential_assignment"

export interface SecretMatch {
  readonly class: SecretPatternClass
  readonly start: number
  readonly end: number
}

/**
 * The value tail of the assignment-style classes stops at whitespace, quotes,
 * angle brackets, commas and closing delimiters, so a credential inside a JSON
 * string, an XML attribute or a Markdown link stays delimited and the
 * surrounding text survives masking.
 */
const SECRET_VALUE_TAIL = "[^\\s\"'<>,}\\])]"

export const SECRET_PATTERN_SOURCES: ReadonlyArray<readonly [SecretPatternClass, string, string]> = [
  ["aws_access_key", "\\bAKIA[0-9A-Z]{16}\\b", ""],
  [
    "credential_assignment",
    `\\b(?:bearer|token|api[_-]?key|secret|password|passwd|pwd)\\s*[=:]\\s*${SECRET_VALUE_TAIL}{1,256}`,
    "i",
  ],
  ["authorization_header", `\\bAuthorization\\s*:\\s*Bearer\\s+${SECRET_VALUE_TAIL}{1,256}`, "i"],
  ["openai_key", "\\bsk-(?:proj-)?[-_A-Za-z0-9]+\\b", ""],
  ["vendor_token", "\\b(?:ghp|github_pat|glpat|xox[baprs])[-_][-_A-Za-z0-9]+\\b", ""],
]

/**
 * Credential keys written with whitespace between the letters (`t o k e n`),
 * which the unsplit class cannot match. Applied only where no plain match
 * covers the span, so a normal assignment is never double-reported.
 */
const SPLIT_CREDENTIAL_ASSIGNMENT_SOURCE = `(?:a\\s*u\\s*t\\s*h\\s*o\\s*r\\s*i\\s*z\\s*a\\s*t\\s*i\\s*o\\s*n|p\\s*a\\s*s\\s*s\\s*w\\s*(?:o\\s*r\\s*)?d|s\\s*e\\s*c\\s*r\\s*e\\s*t|t\\s*o\\s*k\\s*e\\s*n|a\\s*p\\s*i\\s*[_-]?\\s*k\\s*e\\s*y)\\s*[:=]\\s*${SECRET_VALUE_TAIL}{6,256}`

const FORMAT_CHARACTER = /\p{Cf}/u

/**
 * Build a scan shadow of `text`: Unicode format characters (zero-width
 * codepoints, bidi controls, BOM) and C0 controls other than LF/TAB are
 * dropped, and NBSP folds to a plain space. `map[i]` is the original string
 * index of shadow character `i`, so a span found in the shadow maps back to
 * the exact original bytes to mask.
 */
function normalizeForSecretScan(text: string): { shadow: string; map: number[] } {
  let shadow = ""
  const map: number[] = []
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code === 0x00a0) {
      shadow += " "
      map.push(index)
      continue
    }
    const char = text.charAt(index)
    if ((code < 0x20 && code !== 0x0a && code !== 0x09) || FORMAT_CHARACTER.test(char)) continue
    shadow += char
    map.push(index)
  }
  return { shadow, map }
}

export function scanSecretLikeMaterial(value: string): SecretMatch[] {
  if (!value) return []
  const matches: SecretMatch[] = []
  const { shadow, map } = normalizeForSecretScan(value)
  const toOriginalSpan = (start: number, end: number): { start: number; end: number } | undefined => {
    const originalStart = map[start]
    const originalLast = map[end - 1]
    if (originalStart === undefined || originalLast === undefined) return undefined
    return { start: originalStart, end: originalLast + 1 }
  }
  let pemOffset = 0
  while (true) {
    const block = findPemBlock(shadow, pemOffset)
    if (block === undefined) break
    const span = toOriginalSpan(block.start, block.end)
    if (span !== undefined) matches.push({ class: "pem_block", ...span })
    pemOffset = block.end
  }
  for (const [patternClass, source, flags] of SECRET_PATTERN_SOURCES) {
    const pattern = new RegExp(source, `${flags}g`)
    let match: RegExpExecArray | null
    while ((match = pattern.exec(shadow)) !== null) {
      const span = toOriginalSpan(match.index, match.index + match[0].length)
      if (span !== undefined) matches.push({ class: patternClass, ...span })
    }
  }
  const splitPattern = new RegExp(SPLIT_CREDENTIAL_ASSIGNMENT_SOURCE, "gi")
  let splitMatch: RegExpExecArray | null
  while ((splitMatch = splitPattern.exec(shadow)) !== null) {
    const span = toOriginalSpan(splitMatch.index, splitMatch.index + splitMatch[0].length)
    if (span === undefined) continue
    const covered = matches.some((existing) => existing.start < span.end && span.start < existing.end)
    if (!covered) matches.push({ class: "split_credential_assignment", ...span })
  }
  return matches.sort((a, b) => a.start - b.start || a.end - b.end)
}

export function containsSecretLikeMaterial(value: string): boolean {
  return scanSecretLikeMaterial(value).length > 0
}

export function redactSecretLikeMaterial(value: string): string {
  if (!value) return ""
  const matches = scanSecretLikeMaterial(value)
  if (matches.length === 0) return value
  const merged: Array<{ start: number; end: number }> = []
  for (const match of matches) {
    const last = merged[merged.length - 1]
    if (last !== undefined && match.start <= last.end) {
      last.end = Math.max(last.end, match.end)
    } else {
      merged.push({ start: match.start, end: match.end })
    }
  }
  let redacted = ""
  let cursor = 0
  for (const span of merged) {
    redacted += `${value.slice(cursor, span.start)}${MASK}`
    cursor = span.end
  }
  return `${redacted}${value.slice(cursor)}`
}

function findPemBlock(value: string, from = 0): { readonly start: number; readonly end: number } | undefined {
  const begin = value.indexOf("-----BEGIN ", from)
  if (begin < 0) return undefined
  const labelEnd = value.indexOf("-----", begin + 11)
  if (labelEnd < 0 || labelEnd - (begin + 11) > 64) return undefined
  const label = value.slice(begin + 11, labelEnd)
  if (label.length === 0 || /[^A-Za-z0-9 ]/.test(label)) return undefined
  let endMarker = value.indexOf("-----END ", labelEnd + 5)
  while (endMarker >= 0) {
    const endLabelStart = endMarker + 9
    const endLabelEnd = value.indexOf("-----", endLabelStart)
    if (endLabelEnd >= 0 && value.slice(endLabelStart, endLabelEnd) === label) {
      return { start: begin, end: endLabelEnd + 5 }
    }
    endMarker = value.indexOf("-----END ", endLabelEnd >= 0 ? endLabelEnd + 5 : endLabelStart)
  }
  return undefined
}

/**
 * `scheme://user:pass@` and `scheme://user@` inside arbitrary text.
 *
 * The userinfo character class deliberately excludes `/` and `@` so the match
 * cannot run past an authority boundary and swallow a path segment.
 */
const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)([^/@\s:]{1,256})(?::([^/@\s]{0,256}))?@/gi

/**
 * scp-style `user@host:path` (no scheme), anchored on a word boundary so a
 * plain email address inside a sentence is not rewritten into a URL shape.
 */
const SCP_USERINFO = /(^|[\s'"(<])([^\s:/@]{1,256})@([^\s:/@]{1,256}):/g

/**
 * Mask credentials in a URL, or in free text containing URLs.
 *
 * Both halves of a `user:password` pair are masked: the username of a token
 * pair is often the secret itself (`x-access-token:<token>` is the inverse of
 * `<token>:x-oauth-basic`), and a bare username still leaks account identity.
 * URLs without userinfo - `file://`, plain `https://` and local paths - are
 * returned unchanged.
 */
export function redactUrl(value: string): string {
  if (!value) return ""
  const withUrlCredentials = value.includes("://")
    ? value.replace(URL_USERINFO, (_match, scheme: string, _user: string, password?: string) =>
      password === undefined ? `${scheme}${MASK}@` : `${scheme}${MASK}:${MASK}@`,
    )
    : value
  const withScpCredentials = withUrlCredentials.includes("@")
    ? withUrlCredentials.replace(SCP_USERINFO, (_match, prefix: string, _user: string, host: string) =>
      `${prefix}${MASK}@${host}:`,
    )
    : withUrlCredentials
  return redactSecretLikeMaterial(withScpCredentials)
}
