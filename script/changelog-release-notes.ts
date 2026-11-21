/**
 * Release-note source of truth.
 *
 * The changelog is authored under `## [Unreleased]`. Release-state preparation stamps that
 * heading into `## [<version>] - <UTC date>` and opens a fresh empty Unreleased block, so the
 * released commit already carries the notes. The release job then extracts that exact section
 * for the GitHub release body.
 *
 * Every operation is fail-closed: a missing, empty, or duplicated section throws rather than
 * publishing a release with silently empty notes.
 */

const UNRELEASED_HEADING = "## [Unreleased]"

/** `## [1.2.3] - 2026-09-11`, capturing the version token. */
function releaseHeadingPattern(version: string): RegExp {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`^## \\[${escaped}\\][^\\n]*$`, "m")
}

export function assertUtcDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`release date must be YYYY-MM-DD, got: ${date}`)
  const [year, month, day] = date.split("-").map(Number) as [number, number, number]
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    throw new Error(`release date is not a real calendar date: ${date}`)
  }
  return date
}

/**
 * Stamp `## [Unreleased]` into a released section and reopen an empty Unreleased block.
 * Idempotent by refusal: stamping a version that already exists throws.
 */
export function stampUnreleased(changelog: string, version: string, date: string): string {
  assertUtcDate(date)
  if (!version.trim()) throw new Error("version is required")
  if (releaseHeadingPattern(version).test(changelog)) {
    throw new Error(`changelog already contains a section for ${version}`)
  }
  const index = changelog.indexOf(UNRELEASED_HEADING)
  if (index < 0) throw new Error("changelog has no ## [Unreleased] heading to stamp")
  const body = sectionBodyAt(changelog, index + UNRELEASED_HEADING.length)
  if (!body.trim()) throw new Error("refusing to stamp an empty ## [Unreleased] section")
  return `${changelog.slice(0, index)}${UNRELEASED_HEADING}\n\n## [${version}] - ${date}${changelog.slice(index + UNRELEASED_HEADING.length)}`
}

/** Body text from `start` up to the next `## ` heading (or end of file). */
function sectionBodyAt(changelog: string, start: number): string {
  const rest = changelog.slice(start)
  const next = rest.search(/^## /m)
  return next < 0 ? rest : rest.slice(0, next)
}

/**
 * Extract the released section for a version. Fail-closed: throws when the section is absent,
 * empty, or duplicated, so a release can never publish blank notes.
 */
export function extractReleaseNotes(changelog: string, version: string): string {
  const pattern = releaseHeadingPattern(version)
  const matches = changelog.match(new RegExp(pattern.source, "gm")) ?? []
  if (matches.length === 0) throw new Error(`changelog has no section for ${version}`)
  if (matches.length > 1) throw new Error(`changelog has ${matches.length} sections for ${version}`)
  const found = pattern.exec(changelog)
  if (!found) throw new Error(`changelog has no section for ${version}`)
  const body = sectionBodyAt(changelog, found.index + found[0].length).trim()
  if (!body) throw new Error(`release section for ${version} is empty`)
  return body
}

// Release notes are published the moment the release is created, so a reference to a repository that is
// not public must never reach them.
//
// Decision: this is an ALLOWLIST, so anything not listed is neutralized. That deliberately includes
// public third-party repositories (e.g. SawyerHood/dev-browser#146): a public repo cannot be told from a
// private one by name, and leaking a private reference is worse than hiding a public one.
// An owner-qualified reference or URL is public only when the owner/repo PAIR is listed; an unqualified
// repo#N reference is public only when the repo name is listed.
const PUBLIC_QUALIFIED_REPOS = new Set([
  "code-yeongyu/senpi",
  "code-yeongyu/oh-my-openagent",
  "code-yeongyu/oh-my-opencode",
  "code-yeongyu/lazycodex",
  "sisyphuslabs/doriterm",
])
const PUBLIC_UNQUALIFIED_REPOS = new Set(["senpi", "omo", "oh-my-openagent", "oh-my-opencode", "doriterm", "lazycodex"])
// Same-repo shorthand such as PR#123 or GH#123 names no repository.
const NON_REPO_TOKENS = new Set(["pr", "gh", "issue", "issues"])
const NEUTRALIZED = "tracked internally"

// GitHub top-level paths that are product pages, not repository owners: github.com/settings/tokens is not a repo.
const RESERVED_GITHUB_PATHS = new Set([
  "settings",
  "apps",
  "sponsors",
  "orgs",
  "marketplace",
  "features",
  "topics",
  "collections",
  "explore",
  "notifications",
  "login",
  "about",
  "pricing",
  "enterprise",
  "security",
  "site",
  "contact",
  "customer-stories",
  "readme",
  "trending",
  "new",
  "organizations",
  "codespaces",
  "users",
  "enterprises",
  "account",
  "dashboard",
  "pulls",
  "issues",
])

// A GitHub URL names a repository on github.com (optionally www.), on any other github.com subdomain
// (api., gist., codeload., ...) and on any githubusercontent.com subdomain (raw., objects., ...). The host
// may carry a scheme, a protocol-relative "//", an scp-style "git@" prefix, or nothing at all, and may end in a
// root dot (github.com.). A scheme-less host is recognized after any separator, a URL path slash and a markdown
// emphasis delimiter (_ * ~) included, and only skipped when glued to a letter, digit, dot or dash (notgithub.com).
const GITHUB_HOST = String.raw`((?:[a-z0-9-]+\.)*github\.com|(?:[a-z0-9-]+\.)+githubusercontent\.com)\.*(?::\d+)?[/:]`
const GITHUB_URL_START = new RegExp(String.raw`(?<![A-Za-z0-9.-])` + GITHUB_HOST, "gi")
// GitHub subdomains that never address a repository.
const NON_REPO_GITHUB_HOSTS = new Set([
  "docs.github.com",
  "support.github.com",
  "status.github.com",
  "resources.github.com",
  "education.github.com",
  "skills.github.com",
  "lab.github.com",
  "cli.github.com",
  "desktop.github.com",
  "pages.github.com",
  "classroom.github.com",
])
// Sticky matchers: they read at lastIndex instead of slicing, so every scan stays linear.
const OWNER_REPO_AT = /([\w.-]+)\/([\w.-]*[\w-])/y
const REPO_AT = /[\w.-]*[\w-]/y
const REPO_REFERENCE_HASH = /#\d+(?![A-Za-z0-9])/g
const EMPHASIS_CHARS = "_*~`"
const TRAILING_CHARS = ".,;:!?*_~"

// The tokenizer: scanTokens below, one hand-written left-to-right pass (no regex over unbounded input, so the cost
// stays linear however adversarial the text). It yields markdown links (text, target; the target may hold one level
// of balanced parentheses), angle autolinks holding a URL and URL tokens, so the inside of a kept public token is
// never rewritten again. Plain-text repo#N references live in the gaps between tokens and are found by
// scanRepoReferences, a linear scanner (a single regex for them backtracks quadratically).
// A URL token starts at http(s)://, at another clone scheme, at a protocol-relative "//" or at a bare GitHub host,
// and runs to whitespace or a closing bracket, quote or backtick; trailing sentence punctuation and emphasis
// delimiters stay outside it.
const URL_SCHEMES = ["ssh://", "git://", "ftp://", "svn://", "git+ssh://"]
const HTTP_STARTS = ["http://", "https://", "http%3a%2f%2f", "https%3a%2f%2f"]
const GITHUB_HOST_SUFFIX = ".github.com"
const USERCONTENT_SUFFIX = ".githubusercontent.com"

interface Token {
  kind: "link" | "angle" | "url"
  start: number
  end: number
  /** Markdown link text; empty for the other kinds. */
  text: string
  /** Markdown link target, the autolink URL or the URL token. */
  target: string
}

function startsWithAt(text: string, at: number, prefix: string): boolean {
  return text.slice(at, at + prefix.length).toLowerCase() === prefix
}

function isSpace(ch: string): boolean {
  return /\s/.test(ch)
}

function isUrlStop(ch: string): boolean {
  return ch === ")" || ch === "]" || ch === "<" || ch === ">" || ch === '"' || ch === "`" || isSpace(ch)
}

/** Index of the ")" closing a markdown link target that starts at `from`, or -1. One level of nested parentheses. */
function linkTargetEnd(text: string, from: number): number {
  let at = from
  while (at < text.length) {
    const ch = text.charAt(at)
    if (ch === "(") {
      let close = at + 1
      while (close < text.length && !/[\s()]/.test(text.charAt(close))) close++
      if (text.charAt(close) !== ")") return -1
      at = close + 1
    } else if (ch === ")" || isSpace(ch)) {
      break
    } else {
      at++
    }
  }
  return text.charAt(at) === ")" ? at : -1
}

function urlStartsAt(text: string, at: number): boolean {
  const first = text.charAt(at).toLowerCase()
  if (first === "h" && HTTP_STARTS.some((start) => startsWithAt(text, at, start))) return true
  const before = at > 0 ? text.charAt(at - 1) : ""
  if (/[sgf]/.test(first) && (before === "" || !/[\w./+-]/.test(before))) {
    if (URL_SCHEMES.some((scheme) => startsWithAt(text, at, scheme))) return true
  }
  // A bare GitHub host: only at the start of a hostname run, so every run is read once.
  if (!/[a-z0-9-]/i.test(first) || (before !== "" && /[A-Za-z0-9.-]/.test(before))) return false
  let runEnd = at
  while (runEnd < text.length && /[A-Za-z0-9.-]/.test(text.charAt(runEnd))) runEnd++
  let hostEnd = runEnd
  while (hostEnd > at && text.charAt(hostEnd - 1) === ".") hostEnd--
  const host = text.slice(at, hostEnd).toLowerCase()
  const isGithub = host === "github.com" || host.endsWith(GITHUB_HOST_SUFFIX)
  const isUserContent = host.endsWith(USERCONTENT_SUFFIX) && host.length > USERCONTENT_SUFFIX.length
  if (!(isGithub || isUserContent) || host.includes("..")) return false
  const after = text.charAt(runEnd)
  return after === "/" || after === ":" || startsWithAt(text, runEnd, "%2f") || startsWithAt(text, runEnd, "%3a")
}

/** Every markdown link, angle autolink and URL token in the text, in order, in one linear pass. */
function scanTokens(text: string): Token[] {
  const tokens: Token[] = []
  let closeAt = -2
  let failedClose = -3
  let at = 0
  while (at < text.length) {
    const ch = text.charAt(at)
    if (ch === "[") {
      if (closeAt !== -1 && closeAt <= at) closeAt = text.indexOf("]", at + 1)
      if (closeAt >= 0 && closeAt !== failedClose && text.charAt(closeAt + 1) === "(") {
        const end = linkTargetEnd(text, closeAt + 2)
        if (end >= 0) {
          tokens.push({
            kind: "link",
            start: at,
            end: end + 1,
            text: text.slice(at + 1, closeAt),
            target: text.slice(closeAt + 2, end),
          })
          at = end + 1
          continue
        }
        failedClose = closeAt
      }
    } else if (ch === "<") {
      let end = at + 1
      while (end < text.length && text.charAt(end) !== "<" && text.charAt(end) !== ">" && !isSpace(text.charAt(end)))
        end++
      const run = text.slice(at + 1, end)
      if (run && text.charAt(end) === ">" && /\/\/|github\.com|githubusercontent\.com/i.test(run)) {
        tokens.push({ kind: "angle", start: at, end: end + 1, text: "", target: run })
        at = end + 1
        continue
      }
    } else if (urlStartsAt(text, at)) {
      let end = at
      while (end < text.length && !isUrlStop(text.charAt(end))) end++
      tokens.push({ kind: "url", start: at, end, text: "", target: text.slice(at, end) })
      at = end
      continue
    }
    at++
  }
  return tokens
}

function isPublicPair(owner: string, repo: string): boolean {
  return PUBLIC_QUALIFIED_REPOS.has((owner + "/" + repo).toLowerCase())
}

// An (optionally owner-qualified) repo#N reference is private unless its repo is public. PR#/GH#-style
// shorthand and names ending in "-" or "." are not references.
function isPrivateRepoReference(owner: string | undefined, repo: string | undefined): boolean {
  if (repo === undefined || /[-.]$/.test(repo) || NON_REPO_TOKENS.has(repo.toLowerCase())) return false
  return owner === undefined ? !PUBLIC_UNQUALIFIED_REPOS.has(repo.toLowerCase()) : !isPublicPair(owner, repo)
}

interface RepoReference {
  start: number
  end: number
  owner: string | undefined
  repo: string
}

/**
 * Every (optionally owner-qualified) repo#N reference in the text. Anchored on each "#<digits>" and read backwards
 * over the word run in front of it, so the cost is linear in the text. A repo name starts at a letter that follows a
 * non-alphanumeric character: markdown emphasis delimiters (_ *) and dots count as boundaries, so _acme-svc#3_ is found.
 */
function scanRepoReferences(text: string): RepoReference[] {
  const found: RepoReference[] = []
  let floor = 0
  for (const hash of text.matchAll(REPO_REFERENCE_HASH)) {
    const hashAt = hash.index
    let runStart = hashAt
    while (runStart > floor && /[\w./-]/.test(text.charAt(runStart - 1))) runStart--
    floor = hashAt + hash[0].length
    const run = text.slice(runStart, hashAt)
    const lastSlash = run.lastIndexOf("/")
    const segment = run.slice(lastSlash + 1)
    let repoAt = 0
    while (
      repoAt < segment.length &&
      !(/[A-Za-z]/.test(segment.charAt(repoAt)) && (repoAt === 0 || !/[A-Za-z0-9]/.test(segment.charAt(repoAt - 1))))
    ) {
      repoAt++
    }
    if (repoAt >= segment.length) continue
    let owner: string | undefined
    if (repoAt === 0 && lastSlash > 0) {
      const candidate = run.slice(run.lastIndexOf("/", lastSlash - 1) + 1, lastSlash)
      if (candidate) owner = candidate
    }
    found.push({
      start: hashAt - (segment.length - repoAt) - (owner === undefined ? 0 : owner.length + 1),
      end: floor,
      owner,
      repo: segment.slice(repoAt),
    })
  }
  return found
}

function replacePlainReferences(text: string): string {
  let result = ""
  let last = 0
  for (const reference of scanRepoReferences(text)) {
    if (!isPrivateRepoReference(reference.owner, reference.repo)) continue
    result += text.slice(last, reference.start) + NEUTRALIZED
    last = reference.end
  }
  return result + text.slice(last)
}

function isPrivateGithubUrl(host: string, text: string, start: number): boolean {
  if (NON_REPO_GITHUB_HOSTS.has(host)) return false
  let pathStart = start
  if (host === "api.github.com") {
    if (!text.startsWith("repos/", start)) return false
    pathStart += "repos/".length
  }
  OWNER_REPO_AT.lastIndex = pathStart
  const named = OWNER_REPO_AT.exec(text)
  if (!named) return false
  const [, owner, repo] = named
  if (owner === undefined || repo === undefined) return false
  // Reserved product-page paths exist only on the github.com web host; everywhere else the first segment is an owner.
  if ((host === "github.com" || host === "www.github.com") && RESERVED_GITHUB_PATHS.has(owner.toLowerCase())) {
    return false
  }
  // A trailing .git is the clone-URL spelling of the same repo.
  return !isPublicPair(owner, repo.replace(/\.git$/i, ""))
}

/**
 * Owner/repo pairs that follow a GitHub host in forms other than the first path segment pair: fork syntax
 * <owner>:<repo> (compare links read main...<owner>:<repo>:branch). Relative ../ paths are resolved first.
 * Any pair not on the allowlist makes the token private.
 */
function hasPrivateFollowingPair(text: string, from: number): boolean {
  for (let colon = text.indexOf(":", from); colon >= 0; colon = text.indexOf(":", colon + 1)) {
    let ownerStart = colon
    while (ownerStart > from && /[\w.-]/.test(text.charAt(ownerStart - 1))) ownerStart--
    const owner =
      text
        .slice(ownerStart, colon)
        .split(/\.{2,}/)
        .pop() ?? ""
    REPO_AT.lastIndex = colon + 1
    const repo = REPO_AT.exec(text)?.[0]
    // A numeric "repo" is a port or a time, not a repository.
    if (!owner || !repo || /^\d+$/.test(repo)) continue
    // <owner>:<repo>:<branch> - the second colon only introduces the branch, not a pair.
    if (ownerStart > from && text.charAt(ownerStart - 1) === ":") continue
    if (!isPublicPair(owner, repo.replace(/\.git$/i, ""))) return true
  }
  return false
}

function trimEmphasis(text: string): string {
  let start = 0
  let end = text.length
  while (start < end && EMPHASIS_CHARS.includes(text.charAt(start))) start++
  while (end > start && EMPHASIS_CHARS.includes(text.charAt(end - 1))) end--
  return text.slice(start, end)
}

/**
 * Resolve "." and ".." path segments the way a URL parser does: github.com/owner/./repo and
 * github.com/other/../owner/repo both name owner/repo. A ".." that would climb above the first segment is dropped.
 */
function resolveDotSegments(text: string): string {
  if (!text.includes("/.") && !text.startsWith("./") && !text.startsWith("../")) return text
  const out: string[] = []
  for (const segment of text.split("/")) {
    if (segment === ".") continue
    if (segment === "..") {
      out.pop()
      continue
    }
    out.push(segment)
  }
  return out.join("/")
}

/**
 * A normalized copy of a token for detection only: percent-decoded until stable (bounded), stripped of surrounding
 * markdown emphasis, lowercased, and with a root dot after a GitHub host collapsed (github.com. -> github.com).
 */
function normalizeForDetection(token: string): string {
  let text = token
  for (let pass = 0; pass < 4; pass++) {
    const decoded = text.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    if (decoded === text) break
    text = decoded
  }
  return trimEmphasis(text)
    .toLowerCase()
    .replace(/(github\.com|githubusercontent\.com)\.+(?=(?::\d+)?[/:])/g, "$1")
}

/**
 * True when the text holds ANY private reference anywhere inside it: a GitHub URL (any GitHub host, with or
 * without a scheme, at any nesting depth, however it is encoded) whose owner/repo - or any later fork-syntax or
 * relative owner/repo pair - is not on the public allowlist, or an owner/repo#N or repo#N reference that is not
 * public. This is the single definition of "private" for neutralization.
 */
export function findPrivateReferences(token: string): boolean {
  const decoded = normalizeForDetection(token)
  if (detectPrivateReferences(decoded)) return true
  // The same token read as a URL parser would resolve it: dot segments applied. Both readings are judged, so a
  // path that climbs out of an allowlisted repo into a private one is caught either way.
  const resolved = resolveDotSegments(decoded)
  return resolved !== decoded && detectPrivateReferences(resolved)
}

function detectPrivateReferences(text: string): boolean {
  let firstRepoHostEnd = -1
  for (const found of text.matchAll(GITHUB_URL_START)) {
    const host = found[1]
    if (host === undefined) continue
    const end = found.index + found[0].length
    if (isPrivateGithubUrl(host, text, end)) return true
    if (firstRepoHostEnd < 0 && !NON_REPO_GITHUB_HOSTS.has(host)) firstRepoHostEnd = end
  }
  if (firstRepoHostEnd >= 0 && hasPrivateFollowingPair(text, firstRepoHostEnd)) return true
  return scanRepoReferences(text).some((reference) => isPrivateRepoReference(reference.owner, reference.repo))
}

/** Split trailing sentence punctuation and emphasis delimiters off a URL token; they stay outside the replacement. */
function splitTrailing(token: string): [string, string] {
  let end = token.length
  while (end > 0 && TRAILING_CHARS.includes(token.charAt(end - 1))) end--
  return [token.slice(0, end), token.slice(end)]
}

/**
 * Replace private references in published release text. Markdown links, autolinks and URL tokens are judged
 * WHOLE (target and anything nested in it): one private reference anywhere replaces the entire token, while the
 * emphasis markers and punctuation that wrapped it are kept. A link whose target is clean but whose text names a
 * private repo#N keeps the target and neutralizes only the text. Plain-text references are replaced one by one.
 * Public text comes out byte-identical.
 */
function neutralizeAllowlist(text: string): string {
  let result = ""
  let last = 0
  for (const token of scanTokens(text)) {
    result += replacePlainReferences(text.slice(last, token.start))
    last = token.end
    const match = text.slice(token.start, token.end)
    if (token.kind === "link") {
      result += findPrivateReferences(token.target)
        ? NEUTRALIZED
        : "[" + neutralizeAllowlist(token.text) + "](" + token.target + ")"
    } else if (token.kind === "angle") {
      // The whole autolink goes, angle brackets included: a bare <tracked internally> would render as an HTML tag.
      result += findPrivateReferences(token.target) ? NEUTRALIZED : match
    } else {
      const [url, tail] = splitTrailing(token.target)
      result += findPrivateReferences(url) ? NEUTRALIZED + tail : match
    }
  }
  return result + replacePlainReferences(text.slice(last))
}

// ---------------------------------------------------------------------------------------------------------
// Name-based DENY pass. The allowlist above judges URL shapes; this second layer judges NAMES, so a new URL
// spelling cannot leak a repository the deny list names. The list lives in RELEASE_NOTES_PRIVATE_NAMES
// (newline or comma separated, each entry "owner/repo" or a bare repo name) and is never logged.
// Every entry yields its repo NAME (the part after the last "/") and, when qualified, its full owner/name. A token
// (markdown link, autolink, URL token or plain word) is replaced WHOLE when a name occurs in it between characters
// outside [a-z0-9_-] (the start or end of the token counts; "." and "/" are boundaries), in its raw form or in
// either normalized form. There is no reference-context requirement: a name that is also an ordinary word is
// over-redacted on purpose, because a missed private name is worse than a hidden common word.
// verifyNoPrivateNames is the runtime backstop: it re-checks the final text and the entry points refuse to publish
// when a line still names a private repository.
// ---------------------------------------------------------------------------------------------------------
const DENY_ENV = "RELEASE_NOTES_PRIVATE_NAMES"
const DENY_REQUIRE_ENV = "CI_RELEASE_NOTES_REQUIRE_DENY"
const HTML_ENTITIES: Readonly<Record<string, string>> = {
  sol: "/",
  bsol: "\\",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  num: "#",
  colon: ":",
  period: ".",
  lowbar: "_",
  hyphen: "-",
  dash: "-",
  ast: "*",
  grave: "`",
  tilde: "~",
}
const DENY_NAME_CHAR = /[a-z0-9_-]/
const DENY_NORMALIZE_PASSES = 8
const ZERO_WIDTH = /[\u200b-\u200d\u2060\ufeff]/g
const HTML_TAG = /<\/?[a-z][^<>]*>/gi

let cachedDenyRaw: string | undefined
let cachedNeedles: string[] = []

function readDenyNames(): string[] {
  return (process.env[DENY_ENV] ?? "")
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

/** The strings searched for: each entry's repo name and, when qualified, its full owner/name, in raw and normalized spelling. */
function denyNeedles(names: readonly string[]): string[] {
  const needles = new Set<string>()
  for (const name of names) {
    const entry = name.trim().toLowerCase()
    if (!entry) continue
    for (const form of new Set([entry, normalizeForDeny(entry)])) {
      const qualified = form.replace(/^\/+/, "").replace(/\/+$/, "")
      if (!qualified) continue
      needles.add(qualified)
      const repo = qualified.slice(qualified.lastIndexOf("/") + 1)
      if (repo) needles.add(repo)
    }
  }
  return [...needles]
}

function currentNeedles(): string[] {
  const raw = process.env[DENY_ENV] ?? ""
  if (raw !== cachedDenyRaw) {
    cachedDenyRaw = raw
    cachedNeedles = denyNeedles(readDenyNames())
  }
  return cachedNeedles
}

/**
 * Fail closed in the release job: with CI_RELEASE_NOTES_REQUIRE_DENY=1 an unset or empty deny list throws, so a
 * release can never publish notes that only the allowlist protected. Call it from entry points, not libraries.
 */
export function assertDenyListConfigured(): void {
  if (process.env[DENY_REQUIRE_ENV] !== "1") return
  if (denyNeedles(readDenyNames()).length === 0) {
    throw new Error(DENY_ENV + " is unset or empty, but " + DENY_REQUIRE_ENV + "=1 requires a deny list")
  }
}

function decodeEntity(match: string, body: string): string {
  if (body.startsWith("#")) {
    const hex = body.charAt(1) === "x" || body.charAt(1) === "X"
    const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10)
    if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return match
    return lineSafe(String.fromCodePoint(code))
  }
  return HTML_ENTITIES[body.toLowerCase()] ?? match
}

/** A decoded line break would shift line numbers, so it becomes a space. */
function lineSafe(char: string): string {
  return char === "\n" || char === "\r" ? " " : char
}

function keepNewlines(span: string): string {
  return span.replace(/[^\n]/g, "")
}

/** Drop HTML comments in one linear pass, keeping their line breaks. An unterminated comment is left alone. */
function stripHtmlComments(text: string): string {
  let result = ""
  let at = 0
  for (;;) {
    const open = text.indexOf("<!--", at)
    if (open < 0) break
    const close = text.indexOf("-->", open + 4)
    if (close < 0) break
    result += text.slice(at, open) + keepNewlines(text.slice(open, close + 3))
    at = close + 3
  }
  return result + text.slice(at)
}

/**
 * The line-preserving half of the normalizer: NFKC, then (until stable, bounded) percent- and HTML-entity-decoding,
 * zero-width characters, HTML comments and HTML tags removed. The number of lines never changes.
 */
function foldForDeny(text: string): string {
  let current = text
  for (let pass = 0; pass < DENY_NORMALIZE_PASSES; pass++) {
    const next = stripHtmlTags(
      stripHtmlComments(
        current
          .normalize("NFKC")
          .replace(/%([0-9a-f]{2})/gi, (_, hex: string) => lineSafe(String.fromCharCode(Number.parseInt(hex, 16))))
          .replace(/&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});/g, decodeEntity)
          .replace(ZERO_WIDTH, ""),
      ),
    )
    if (next === current) break
    current = next
  }
  return current
}

function stripHtmlTags(text: string): string {
  return text.replace(HTML_TAG, keepNewlines)
}

function finishLine(line: string): string {
  const slashed = line
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .replace(/[\\\u2044\u2215\uff0f]/g, "/")
    .replace(/[_*~`]/g, "")
    .replace(/\/{2,}/g, "/")
  return resolveDotSegments(slashed)
    .replace(/(?<=[a-z0-9])\.+(?=[/:])/gi, "")
    .replace(/\.git(?![a-z0-9_-])/gi, "")
    .toLowerCase()
}

function finishFolded(folded: string): string {
  return folded.split("\n").map(finishLine).join("\n")
}

/**
 * A normalized copy of text for NAME detection only: NFKC, percent- and HTML-entity-decoded until stable
 * (bounded), zero-width characters, HTML comments and tags removed, markdown-unescaped, backslashes and fullwidth
 * solidi turned into slashes, repeated slashes collapsed, dot segments resolved, a ".git" suffix and a root dot
 * after a hostname dropped, lowercased. Every step is linear and line breaks are preserved.
 */
function normalizeForDeny(text: string): string {
  return finishFolded(foldForDeny(text))
}

/** The views of a text a name is searched in: raw, folded (before path resolution) and fully normalized. */
function denyViews(text: string): string[] {
  const folded = foldForDeny(text)
  return [text.toLowerCase(), folded.toLowerCase(), finishFolded(folded)]
}

/** True when the needle sits in the text between characters outside [a-z0-9_-] (text start and end count). */
function hasBoundedName(text: string, needle: string): boolean {
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
    const before = at > 0 ? text.charAt(at - 1) : ""
    const after = text.charAt(at + needle.length)
    if ((before === "" || !DENY_NAME_CHAR.test(before)) && (after === "" || !DENY_NAME_CHAR.test(after))) return true
  }
  return false
}

function viewsHoldNeedle(views: readonly string[], needles: readonly string[]): boolean {
  return needles.some((needle) => views.some((view) => hasBoundedName(view, needle)))
}

/** True when a link, autolink, URL token or plain word names a deny entry. */
function isDenied(token: string, needles: readonly string[]): boolean {
  return viewsHoldNeedle(denyViews(token), needles)
}

const WORD_WRAPPERS = EMPHASIS_CHARS + "([{<\"'"
const WORD_TAIL_WRAPPERS = EMPHASIS_CHARS + TRAILING_CHARS + ")]}>\"'"

// U+FEFF counts as whitespace to \\s but is invisible, so it must not split a word.
function denyPlainText(text: string, needles: readonly string[]): string {
  return text.replace(/(?:\S|\ufeff)+/g, (word) => {
    let start = 0
    let end = word.length
    while (start < end && WORD_WRAPPERS.includes(word.charAt(start))) start++
    while (end > start && WORD_TAIL_WRAPPERS.includes(word.charAt(end - 1))) end--
    const core = word.slice(start, end)
    return core && isDenied(core, needles) ? word.slice(0, start) + NEUTRALIZED + word.slice(end) : word
  })
}

/** Second layer: per token (same tokenizer as the allowlist pass), replace anything that names a deny entry. */
function neutralizeDenied(text: string, needles: readonly string[]): string {
  let result = ""
  let last = 0
  for (const token of scanTokens(text)) {
    result += denyPlainText(text.slice(last, token.start), needles)
    last = token.end
    if (token.kind === "url") {
      const [url, tail] = splitTrailing(token.target)
      result += isDenied(url, needles) ? NEUTRALIZED + tail : text.slice(token.start, token.end)
    } else {
      const match = text.slice(token.start, token.end)
      result += isDenied(match, needles) ? NEUTRALIZED : match
    }
  }
  return result + denyPlainText(text.slice(last), needles)
}

/**
 * Replace private references in published release text: the allowlist pass first, then the name-based deny pass
 * (a no-op when no deny list is configured).
 */
export function neutralizeCrossRepoReferences(text: string): string {
  const allowed = neutralizeAllowlist(text)
  const needles = currentNeedles()
  return needles.length === 0 ? allowed : neutralizeDenied(allowed, needles)
}

/**
 * The runtime backstop. Normalizes the whole final text the same way the redactor does and returns the 1-based
 * numbers of the lines that still hold a repo name or owner/name from `names` (raw, folded or normalized). It
 * never returns the text or the name.
 */
export function verifyNoPrivateNames(finalText: string, names: readonly string[]): number[] {
  const needles = denyNeedles(names)
  if (needles.length === 0) return []
  const folded = foldForDeny(finalText)
  const raw = finalText.toLowerCase().split("\n")
  const foldedLines = folded.toLowerCase().split("\n")
  const finished = finishFolded(folded).split("\n")
  const lines: number[] = []
  for (let index = 0; index < raw.length; index++) {
    const views = [raw[index] ?? "", foldedLines[index] ?? "", finished[index] ?? ""]
    if (viewsHoldNeedle(views, needles)) lines.push(index + 1)
  }
  return lines
}

/** Thrown when the final body still names a private repository. Its message carries line numbers only. */
export class PrivateNameLeakError extends Error {}

/** Refuse a final published text that still names a deny-list repository. Reads the deny list from the environment. */
export function assertNoPrivateNames(finalText: string): void {
  const lines = verifyNoPrivateNames(finalText, readDenyNames())
  if (lines.length > 0) {
    throw new PrivateNameLeakError(
      "release notes still name a private repository on line(s) " + lines.join(",") + " - refusing to publish",
    )
  }
}

/**
 * Release body = authored notes, then the contributor block, then the install footer. The finished body is
 * verified against the deny list before it is returned; `redact` is injectable so the backstop can be tested.
 */
export function composeReleaseBody(
  notes: string,
  contributors: string,
  installFooter: string,
  redact: (text: string) => string = neutralizeCrossRepoReferences,
): string {
  const parts = [redact(notes.trim())]
  if (contributors.trim()) parts.push(redact(contributors.trim()))
  if (installFooter.trim()) parts.push(installFooter.trim())
  const body = parts.join("\n\n") + "\n"
  assertNoPrivateNames(body)
  return body
}
