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
const RELATIVE_OWNER_REPO = /(?:\.\.\/)+([\w.-]+)\/([\w.-]*[\w-])/g
const REPO_REFERENCE_HASH = /#\d+(?![A-Za-z0-9])/g
const EMPHASIS_CHARS = "_*~`"
const TRAILING_CHARS = ".,;:!?*_~"

// The tokenizer. One pass, left to right, so the inside of a kept public token is never rewritten again.
// Groups: 1-2 markdown link (text, target; the target may hold one level of balanced parentheses), 3 an angle
// autolink holding a URL, 4 a URL token. Plain-text repo#N references live in the gaps between tokens and are
// found by scanRepoReferences, a linear scanner (a single regex for them backtracks quadratically).
// A URL token starts at http(s)://, at another clone scheme, at a protocol-relative "//" or at a bare GitHub host,
// and runs to whitespace or a closing bracket, quote or backtick; trailing sentence punctuation and emphasis
// delimiters stay outside it.
const MARKDOWN_LINK = String.raw`\[([^\]]*)\]\(((?:[^\s()]|\([^\s()]*\))*)\)`
const ANGLE_URL = String.raw`<(?=[^\s<>]*(?:\/\/|github\.com|githubusercontent\.com))([^\s<>]+)>`
const URL_START = String.raw`https?(?::\/\/|%3a%2f%2f)|(?<![\w./+-])(?:ssh|git|ftp|svn|git\+ssh):\/\/|(?<![A-Za-z0-9.-])(?=(?:[a-z0-9-]+\.)*(?:github\.com|[a-z0-9-]+\.githubusercontent\.com)\.*(?::\d+)?(?:[/:]|%2f|%3a))`
const URL_TOKEN = "(?:" + URL_START + ')[^\\s)\\]<>"`]*'
const TOKEN_PATTERN = new RegExp([MARKDOWN_LINK, ANGLE_URL, "(" + URL_TOKEN + ")"].join("|"), "gi")

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
 * <owner>:<repo> (compare links read main...<owner>:<repo>:branch) and relative ../<owner>/<repo> paths.
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
  for (const relative of text.slice(from).matchAll(RELATIVE_OWNER_REPO)) {
    const [, owner, repo] = relative
    if (owner === undefined || repo === undefined) continue
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
  const text = normalizeForDetection(token)
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
  for (const found of text.matchAll(TOKEN_PATTERN)) {
    const [match, linkText, linkTarget, angleUrl, urlToken] = found
    result += replacePlainReferences(text.slice(last, found.index))
    last = found.index + match.length
    if (linkTarget !== undefined) {
      result += findPrivateReferences(linkTarget)
        ? NEUTRALIZED
        : "[" + neutralizeAllowlist(linkText ?? "") + "](" + linkTarget + ")"
    } else if (angleUrl !== undefined) {
      // The whole autolink goes, angle brackets included: a bare <tracked internally> would render as an HTML tag.
      result += findPrivateReferences(angleUrl) ? NEUTRALIZED : match
    } else if (urlToken !== undefined) {
      const [url, tail] = splitTrailing(urlToken)
      result += findPrivateReferences(url) ? NEUTRALIZED + tail : match
    } else {
      result += match
    }
  }
  return result + replacePlainReferences(text.slice(last))
}

// ---------------------------------------------------------------------------------------------------------
// Name-based DENY pass. The allowlist above judges URL shapes; this second layer judges NAMES, so a new URL
// spelling cannot leak a repository the deny list names. The list lives in RELEASE_NOTES_PRIVATE_NAMES
// (newline or comma separated, each entry "owner/repo" or a bare repo name) and is never logged.
// An "owner/repo" entry matches anywhere. A bare name is often an ordinary word (docs, api), so it matches only in
// reference contexts: inside a link, autolink or URL token, as the repo part of name#N, or inside a GitHub-host or
// relative-path word - never as a free-standing prose word.
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
const DENY_NAME_CHAR = /[a-z0-9._-]/
const DENY_NORMALIZE_PASSES = 8
const REFERENCE_CONTEXT = /github\.com|githubusercontent\.com|:\/\/|\.\.\/|^\/\//

interface DenyEntry {
  raw: string
  normalized: string
}

interface DenyList {
  qualified: DenyEntry[]
  bare: DenyEntry[]
}

let cachedDenyRaw: string | undefined
let cachedDenyList: DenyList = { qualified: [], bare: [] }

function parseDenyList(raw: string): DenyList {
  const list: DenyList = { qualified: [], bare: [] }
  const seen = new Set<string>()
  for (const part of raw.split(/[\n,]/)) {
    const entry = part.trim().toLowerCase()
    if (!entry || seen.has(entry)) continue
    seen.add(entry)
    const normalized = normalizeForDeny(entry)
    if (!normalized) continue
    ;(entry.includes("/") ? list.qualified : list.bare).push({ raw: entry, normalized })
  }
  return list
}

function denyList(): DenyList {
  const raw = process.env[DENY_ENV] ?? ""
  if (raw !== cachedDenyRaw) {
    cachedDenyRaw = raw
    cachedDenyList = parseDenyList(raw)
  }
  return cachedDenyList
}

/**
 * Fail closed in the release job: with CI_RELEASE_NOTES_REQUIRE_DENY=1 an unset or empty deny list throws, so a
 * release can never publish notes that only the allowlist protected. Call it from entry points, not libraries.
 */
export function assertDenyListConfigured(): void {
  if (process.env[DENY_REQUIRE_ENV] !== "1") return
  const list = parseDenyList(process.env[DENY_ENV] ?? "")
  if (list.qualified.length + list.bare.length === 0) {
    throw new Error(DENY_ENV + " is unset or empty, but " + DENY_REQUIRE_ENV + "=1 requires a deny list")
  }
}

function decodeEntity(match: string, body: string): string {
  if (body.startsWith("#")) {
    const hex = body.charAt(1) === "x" || body.charAt(1) === "X"
    const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10)
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
  }
  return HTML_ENTITIES[body.toLowerCase()] ?? match
}

/**
 * A normalized copy of text for NAME detection only: percent-decoded and HTML-entity-decoded until stable
 * (bounded), markdown-unescaped, backslashes turned into slashes, repeated slashes collapsed, emphasis markers
 * stripped, a root dot after a hostname collapsed, lowercased. Every step is linear.
 */
export function normalizeForDeny(text: string): string {
  let current = text
  for (let pass = 0; pass < DENY_NORMALIZE_PASSES; pass++) {
    const next = current
      .replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
      .replace(/&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});/g, decodeEntity)
    if (next === current) break
    current = next
  }
  return current
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .replace(/\\/g, "/")
    .replace(/[_*~`]/g, "")
    .replace(/\/{2,}/g, "/")
    .replace(/(?<=[a-z0-9])\.+(?=[/:])/gi, "")
    .toLowerCase()
}

/** True when the entry sits in the text between non-name characters (a trailing sentence dot counts as one). */
function hasBoundedEntry(text: string, entry: string): boolean {
  if (!entry) return false
  for (let at = text.indexOf(entry); at >= 0; at = text.indexOf(entry, at + 1)) {
    if (at > 0 && DENY_NAME_CHAR.test(text.charAt(at - 1))) continue
    const end = at + entry.length
    const after = text.charAt(end)
    if (after === "" || !DENY_NAME_CHAR.test(after)) return true
    if (after === "." && (end + 1 >= text.length || !DENY_NAME_CHAR.test(text.charAt(end + 1)))) return true
  }
  return false
}

function matchesAny(raw: string, normalized: string, entries: readonly DenyEntry[]): boolean {
  return entries.some((entry) => hasBoundedEntry(raw, entry.raw) || hasBoundedEntry(normalized, entry.normalized))
}

/** True when a link, autolink or URL token (always a reference context) names a deny entry. */
function tokenIsDenied(token: string, list: DenyList): boolean {
  const raw = token.toLowerCase()
  const normalized = normalizeForDeny(token)
  return matchesAny(raw, normalized, list.qualified) || matchesAny(raw, normalized, list.bare)
}

/** True when a plain-text word names a deny entry: owner/repo anywhere, a bare name only in a reference context. */
function wordIsDenied(word: string, list: DenyList): boolean {
  const raw = word.toLowerCase()
  const normalized = normalizeForDeny(word)
  if (matchesAny(raw, normalized, list.qualified)) return true
  if (list.bare.length === 0) return false
  if (REFERENCE_CONTEXT.test(raw) || REFERENCE_CONTEXT.test(normalized)) return matchesAny(raw, normalized, list.bare)
  return scanRepoReferences(normalized).some((reference) =>
    list.bare.some((entry) => reference.repo === entry.normalized),
  )
}

const WORD_WRAPPERS = EMPHASIS_CHARS + "([{<\"'"
const WORD_TAIL_WRAPPERS = EMPHASIS_CHARS + TRAILING_CHARS + ")]}>\"'"

function denyPlainText(text: string, list: DenyList): string {
  return text.replace(/\S+/g, (word) => {
    let start = 0
    let end = word.length
    while (start < end && WORD_WRAPPERS.includes(word.charAt(start))) start++
    while (end > start && WORD_TAIL_WRAPPERS.includes(word.charAt(end - 1))) end--
    const core = word.slice(start, end)
    return core && wordIsDenied(core, list) ? word.slice(0, start) + NEUTRALIZED + word.slice(end) : word
  })
}

/** Second layer: per token (same tokenizer as the allowlist pass), replace anything that names a deny entry. */
function neutralizeDenied(text: string, list: DenyList): string {
  let result = ""
  let last = 0
  for (const found of text.matchAll(TOKEN_PATTERN)) {
    const [match, , linkTarget, angleUrl, urlToken] = found
    result += denyPlainText(text.slice(last, found.index), list)
    last = found.index + match.length
    if (linkTarget !== undefined || angleUrl !== undefined) {
      result += tokenIsDenied(match, list) ? NEUTRALIZED : match
    } else if (urlToken !== undefined) {
      const [url, tail] = splitTrailing(urlToken)
      result += tokenIsDenied(url, list) ? NEUTRALIZED + tail : match
    } else {
      result += match
    }
  }
  return result + denyPlainText(text.slice(last), list)
}

/**
 * Replace private references in published release text: the allowlist pass first, then the name-based deny pass
 * (a no-op when no deny list is configured).
 */
export function neutralizeCrossRepoReferences(text: string): string {
  const allowed = neutralizeAllowlist(text)
  const list = denyList()
  return list.qualified.length + list.bare.length === 0 ? allowed : neutralizeDenied(allowed, list)
}

/** Release body = authored notes, then the contributor block, then the install footer. */
export function composeReleaseBody(notes: string, contributors: string, installFooter: string): string {
  const parts = [neutralizeCrossRepoReferences(notes.trim())]
  if (contributors.trim()) parts.push(neutralizeCrossRepoReferences(contributors.trim()))
  if (installFooter.trim()) parts.push(installFooter.trim())
  return `${parts.join("\n\n")}\n`
}
