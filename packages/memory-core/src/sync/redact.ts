/**
 * Credential redaction for memory-repository URLs.
 *
 * Mirror URLs are user-supplied and routinely carry a personal access token in
 * the userinfo position. Any URL that reaches a status view, a reminder or the
 * push log passes through here first, so a token never lands in a transcript
 * or an on-disk log line.
 */

const MASK = "***"

/**
 * `scheme://user:pass@` and `scheme://user@` inside arbitrary text.
 *
 * The userinfo character class deliberately excludes `/` and `@` so the match
 * cannot run past an authority boundary and swallow a path segment.
 */
const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)([^/@\s:]+)(?::([^/@\s]*))?@/gi

/**
 * scp-style `user@host:path` (no scheme), anchored on a word boundary so a
 * plain email address inside a sentence is not rewritten into a URL shape.
 */
const SCP_USERINFO = /(^|[\s'"(<])([^\s:/@]+)@([^\s:/@]+):(?=[^\s]*\/)/g

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
  return value
    .replace(URL_USERINFO, (_match, scheme: string, _user: string, password?: string) =>
      password === undefined ? `${scheme}${MASK}@` : `${scheme}${MASK}:${MASK}@`,
    )
    .replace(SCP_USERINFO, (_match, prefix: string, _user: string, host: string) =>
      `${prefix}${MASK}@${host}:`,
    )
}
