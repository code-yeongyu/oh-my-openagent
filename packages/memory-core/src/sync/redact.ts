/**
 * Credential redaction for memory-repository URLs.
 *
 * Mirror URLs are user-supplied and routinely carry a personal access token in
 * the userinfo position. Any URL that reaches a status view, a reminder or the
 * push log passes through here first, so a token never lands in a transcript
 * or an on-disk log line.
 */

const MASK = "***"

const SECRET_PATTERN_SOURCES = [
  ["\\bAKIA[0-9A-Z]{16}\\b", ""],
  ["\\b(?:bearer|token|api[_-]?key|secret|password|passwd|pwd)\\s*[=:]\\s*\\S{1,256}", "i"],
  ["\\bAuthorization\\s*:\\s*Bearer\\s+\\S{1,256}", "i"],
  ["\\bsk-(?:proj-)?[-_A-Za-z0-9]+\\b", ""],
  ["\\b(?:ghp|github_pat|glpat|xox[baprs])-[-_A-Za-z0-9]+\\b", ""],
] as const

const SECRET_PATTERNS = SECRET_PATTERN_SOURCES.map(([source, flags]) => new RegExp(source, flags))
const SECRET_REPLACERS = SECRET_PATTERN_SOURCES.map(([source, flags]) => new RegExp(source, `${flags}g`))

export function containsSecretLikeMaterial(value: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(value)) || findPemBlock(value) !== undefined
}

function redactSecretLikeMaterial(value: string): string {
  let redacted = SECRET_REPLACERS.reduce((current, pattern) => current.replace(pattern, MASK), value)
  let offset = 0
  while (true) {
    const block = findPemBlock(redacted, offset)
    if (block === undefined) return redacted
    redacted = `${redacted.slice(0, block.start)}${MASK}${redacted.slice(block.end)}`
    offset = block.start + MASK.length
  }
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
