// The same value-based rules as senpi's redactSecrets (packages/ai/src/utils/provider-error.ts, senpi#4283), byte for
// byte apart from formatting: a task's stored error text is provider output and reaches the parent session and its
// clients. parity: the shared secret matrix in __fixtures__/secret-inventory.ts is the same generator senpi's tests use.

// Every pattern below is linear in the input: each quantifier is bounded or ends the match, alternatives start with
// different characters, and a name is matched only from the start of its run of name characters, so no input makes
// the engine retry a long run from many positions (senpi#4283 review: a keyword repeated over 1 MB took minutes).

// The last component of a name (split on "_", "-", "." and camelCase) that says it holds a credential: api_key,
// x-api-key, access_token, sessionToken, client_secret, Set-Cookie. A credential word elsewhere in a name
// (primary_key_column, token_type, authorization_endpoint) or inside a word (monkey, tokenizer, max_tokens) is not.
const SECRET_WORDS = new Set([
  "key",
  "apikey",
  "accesskey",
  "secretkey",
  "privatekey",
  "token",
  "accesstoken",
  "refreshtoken",
  "authtoken",
  "apitoken",
  "idtoken",
  "secret",
  "clientsecret",
  "auth",
  "authorization",
  "cookie",
  "cookies",
  "password",
  "passwd",
  "pwd",
  "passphrase",
  "credential",
  "credentials",
  "signature",
  "sig",
])
const COOKIE_WORDS = new Set(["cookie", "cookies"])
// A cheap pre-check that skips splitting the names that cannot hold a credential.
const SECRET_WORD_HINT = /key|token|secret|auth|cookie|session|pass|pwd|credential|sig/i

function nameComponents(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[\s_.-]+/)
    .filter((component) => component.length > 0)
}

/** The credential word a name ends with (`session` only as the whole name), or undefined. */
function secretWord(name: string): string | undefined {
  if (!SECRET_WORD_HINT.test(name)) return undefined
  const whole = name.toLowerCase()
  if (SECRET_WORDS.has(whole) || whole === "session") return whole
  const components = nameComponents(name)
  const last = components.at(-1)
  if (last === undefined) return undefined
  if (SECRET_WORDS.has(last)) return last
  return components.length === 1 && last === "session" ? last : undefined
}

const NAME_CHARS = String.raw`[A-Za-z0-9_.-]`
const NAME_START = String.raw`(?<![A-Za-z0-9_.-])`
// A name longer than 128 characters is not read as one: the bound keeps every match attempt constant.
const NAME = String.raw`${NAME_CHARS}{1,128}`
// A quote or escape around a name or value: ASCII and typographic quotes, backslashes and HTML-escaped quotes.
const QUOTE = String.raw`(?:[\\"'\`\u2018\u2019\u201C\u201D]|&quot;|&#0?34;|&#x22;|&#0?39;)`
// Between the name and its value: closing quotes or escapes, ":", "=" or a full-width colon, an array or Go map
// bracket, opening quotes or escapes, and an auth scheme.
const SEPARATOR = String.raw`${QUOTE}{0,8}\s{0,4}[:=\uFF1A]\s{0,4}\[?\s{0,4}${QUOTE}{0,8}\s{0,4}(?:(?:bearer|basic|token|apikey)(?:\s{1,4}|%20))?`
// A token-like run: base64, base64url, hex, URL-encoded and key-prefix characters.
const VALUE_CHARS = String.raw`[A-Za-z0-9+/=_.~%-]`
const MIN_SECRET_LENGTH = 16

const NAMED_HEAD = new RegExp(String.raw`${NAME_START}(${NAME})${SEPARATOR}`, "gi")
const VALUE_AT = new RegExp(String.raw`${VALUE_CHARS}{${MIN_SECRET_LENGTH},}`, "y")
// The fields of an object held under a credential name (`"credentials": {"value": "..."}`): every token-like
// value in it is a credential, whatever its field is called.
const OBJECT_AT = /\{[^{}]{0,4096}\}/y
const OBJECT_FIELD_VALUE = new RegExp(String.raw`(${SEPARATOR})${VALUE_CHARS}{${MIN_SECRET_LENGTH},}`, "gi")
// Cookie pairs (`a=1; __cf_bm=...`, `["a=1","sid=..."]`): every value is a credential, however short, except the
// Set-Cookie attributes.
const COOKIE_PAIR_AT = /([^\s=;,"'`\\<>{}[\]&]{1,128})(?:=([^\s;,"'`\\<>{}[\]&]{1,4096}))?/y
const COOKIE_GAP_AT = new RegExp(String.raw`;\s{0,4}|${QUOTE}{0,8}\s{0,4},\s{0,4}${QUOTE}{0,8}`, "y")
const COOKIE_ATTRIBUTES = new Set([
  "path",
  "domain",
  "expires",
  "max-age",
  "samesite",
  "secure",
  "httponly",
  "priority",
  "partitioned",
])
const MAX_COOKIE_PAIRS = 64

const XML_VALUE = new RegExp(
  String.raw`((?:<|&lt;)(${NAME})(?:>|&gt;)\s{0,4})(${VALUE_CHARS}{${MIN_SECRET_LENGTH},})`,
  "gi",
)
// `scheme://user:password@host`: the password, whatever its length.
const URL_USERINFO = /(?<![A-Za-z0-9+.-])([A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/[^\s/?#@:]{1,256}:)[^\s/?#@]{1,256}@/g
const BEARER_VALUE = new RegExp(String.raw`\b(bearer\s{1,8})${VALUE_CHARS}{8,}`, "gi")
// Credential-shaped values recognized by their prefix wherever they appear; a letter before the prefix means a word.
const PREFIXED_VALUES: readonly RegExp[] = [
  /(?<![A-Za-z])sk-[A-Za-z0-9_-]{8,}/g,
  /(?<![A-Za-z])(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /(?<![A-Za-z])gsk_[A-Za-z0-9]{20,}/g,
  /(?<![A-Za-z])xai-[A-Za-z0-9]{20,}/g,
  /(?<![A-Za-z])hf_[A-Za-z0-9]{20,}/g,
  /(?<![A-Za-z])xox[abposr]-[A-Za-z0-9-]{10,}/g,
  /(?<![A-Za-z])gh[pousr]_[A-Za-z0-9]{20,}/g,
  /(?<![A-Za-z])github_pat_[A-Za-z0-9_]{20,}/g,
  /(?<![A-Za-z])(?:AKIA|ASIA)[0-9A-Z]{16}(?![0-9A-Z])/g,
  /(?<![A-Za-z])AIza[0-9A-Za-z_-]{30,}/g,
  // A JWT's header segment is base64url JSON, so it always begins with `eyJ`.
  /(?<![A-Za-z])eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
]

/** Replace the cookie values that start at `start`; returns the rebuilt tail start and the redacted pieces. */
function redactCookiePairs(text: string, start: number, replacement: string, out: string[]): number {
  let position = start
  for (let pair = 0; pair < MAX_COOKIE_PAIRS; pair++) {
    VALUE_AT.lastIndex = position
    const whole = VALUE_AT.exec(text)
    COOKIE_PAIR_AT.lastIndex = position
    const match = whole === null ? COOKIE_PAIR_AT.exec(text) : null
    if (whole !== null) {
      out.push(replacement)
      position += whole[0].length
    } else if (match !== null) {
      const [all, name = "", value] = match
      if (value === undefined || COOKIE_ATTRIBUTES.has(name.toLowerCase())) out.push(all)
      else out.push(`${name}=${replacement}`)
      position += all.length
    } else break
    COOKIE_GAP_AT.lastIndex = position
    const gap = COOKIE_GAP_AT.exec(text)
    if (gap === null || gap[0].length === 0) break
    out.push(gap[0])
    position += gap[0].length
  }
  return position
}

/** Replace the value after each credential name: a token-like run, an object's field values, or cookie pairs. */
function redactNamedValues(text: string, replacement: string): string {
  const out: string[] = []
  let copied = 0
  NAMED_HEAD.lastIndex = 0
  for (let head = NAMED_HEAD.exec(text); head !== null; head = NAMED_HEAD.exec(text)) {
    const valueStart = head.index + head[0].length
    const word = secretWord(head[1] ?? "")
    if (word === undefined) continue
    out.push(text.slice(copied, valueStart))
    let valueEnd = valueStart
    if (COOKIE_WORDS.has(word)) {
      valueEnd = redactCookiePairs(text, valueStart, replacement, out)
    } else {
      VALUE_AT.lastIndex = valueStart
      OBJECT_AT.lastIndex = valueStart
      const value = VALUE_AT.exec(text)
      const object = value === null ? OBJECT_AT.exec(text) : null
      if (value !== null) {
        out.push(replacement)
        valueEnd += value[0].length
      } else if (object !== null) {
        out.push(object[0].replace(OBJECT_FIELD_VALUE, `$1${replacement}`))
        valueEnd += object[0].length
      }
    }
    copied = valueEnd
    NAMED_HEAD.lastIndex = Math.max(valueEnd, NAMED_HEAD.lastIndex)
  }
  if (copied === 0) return text
  out.push(text.slice(copied))
  return out.join("")
}

/**
 * Mask credentials in provider or gateway text by value, not by a list of names: a token-like run of at least 16
 * characters after a name that ends with a credential word (in a header, JSON, array, Go map, Python repr, XML, URL
 * query or form body, with ASCII, typographic or HTML-escaped quotes, at any escaping depth), every field of an
 * object held under such a name, every cookie value, URL userinfo passwords, bearer tokens, and known key prefixes
 * anywhere. Model ids, error codes, request ids and names that merely contain a credential word stay readable.
 * Linear in the input length.
 */
export function redactSecretText(text: string, replacement = "[REDACTED]"): string {
  let redacted = redactNamedValues(text, replacement)
    .replace(XML_VALUE, (all, open: string, name: string) =>
      secretWord(name) === undefined ? all : `${open}${replacement}`,
    )
    .replace(URL_USERINFO, `$1${replacement}@`)
    .replace(BEARER_VALUE, `$1${replacement}`)
  for (const pattern of PREFIXED_VALUES) redacted = redacted.replace(pattern, replacement)
  return redacted
}
