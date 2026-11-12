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
// may carry a scheme, a protocol-relative "//", an scp-style "git@" prefix, or nothing at all.
// A scheme-less host is recognized after any separator, a URL path slash included, and only skipped when glued to a word or host label (notgithub.com).
const GITHUB_HOST = String.raw`((?:[a-z0-9-]+\.)*github\.com|(?:[a-z0-9-]+\.)+githubusercontent\.com)(?::\d+)?[/:]`
const GITHUB_URL_START = new RegExp(String.raw`(?<![\w.-])` + GITHUB_HOST, "gi")
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
const OWNER_REPO_PATH = /^([\w.-]+)\/([\w.-]*[\w-])/
const REPO_REFERENCE = /\b(?:([\w.-]+)\/)?([A-Za-z][\w.-]*)#\d+\b/g

// The tokenizer. One pass, left to right, so the inside of a kept public token is never rewritten again.
// Groups: 1-2 markdown link (text, target; the target may hold one level of balanced parentheses), 3 an angle
// autolink holding a URL, 4 a URL token, 5-6 an (optionally owner-qualified) repo#N reference in plain text.
// A URL token starts at http(s)://, at another clone scheme, at a protocol-relative "//" or at a bare GitHub host,
// and runs to whitespace or a closing bracket, quote or backtick; trailing sentence punctuation stays outside it.
const MARKDOWN_LINK = String.raw`\[([^\]]*)\]\(((?:[^\s()]|\([^\s()]*\))*)\)`
const ANGLE_URL = String.raw`<(?=[^\s<>]*(?:\/\/|github\.com|githubusercontent\.com))([^\s<>]+)>`
const URL_START = String.raw`https?:\/\/|(?<![\w./+-])(?:ssh|git|ftp|svn|git\+ssh):\/\/|(?<![\w.-])(?=(?:[a-z0-9-]+\.)*(?:github\.com|[a-z0-9-]+\.githubusercontent\.com)(?::\d+)?[/:])`
const URL_TOKEN = "(?:" + URL_START + ')[^\\s)\\]<>"`]*'
const CROSS_REPO_PATTERN = new RegExp(
  [MARKDOWN_LINK, ANGLE_URL, "(" + URL_TOKEN + ")", REPO_REFERENCE.source].join("|"),
  "gi",
)

function isPublicPair(owner: string, repo: string): boolean {
  return PUBLIC_QUALIFIED_REPOS.has((owner + "/" + repo).toLowerCase())
}

// An (optionally owner-qualified) repo#N reference is private unless its repo is public. PR#/GH#-style
// shorthand and names ending in "-" or "." are not references.
function isPrivateRepoReference(owner: string | undefined, repo: string | undefined): boolean {
  if (repo === undefined || /[-.]$/.test(repo) || NON_REPO_TOKENS.has(repo.toLowerCase())) return false
  return owner === undefined ? !PUBLIC_UNQUALIFIED_REPOS.has(repo.toLowerCase()) : !isPublicPair(owner, repo)
}

function isPrivateGithubUrl(host: string, rest: string): boolean {
  const lowerHost = host.toLowerCase()
  if (NON_REPO_GITHUB_HOSTS.has(lowerHost)) return false
  let path = rest
  if (lowerHost === "api.github.com") {
    if (!/^repos\//i.test(path)) return false
    path = path.slice("repos/".length)
  }
  const named = OWNER_REPO_PATH.exec(path)
  if (!named) return false
  const [, owner, repo] = named
  if (owner === undefined || repo === undefined) return false
  // Reserved product-page paths exist only on the github.com web host; everywhere else the first segment is an owner.
  if (
    (lowerHost === "github.com" || lowerHost === "www.github.com") &&
    RESERVED_GITHUB_PATHS.has(owner.toLowerCase())
  ) {
    return false
  }
  // A trailing .git is the clone-URL spelling of the same repo.
  return !isPublicPair(owner, repo.replace(/\.git$/i, ""))
}

/**
 * True when the text holds ANY private reference anywhere inside it: a GitHub URL (any GitHub host, with or
 * without a scheme, at any nesting depth) whose owner/repo is not on the public allowlist, or an owner/repo#N
 * or repo#N reference that is not public. This is the single definition of "private" for neutralization.
 */
export function findPrivateReferences(token: string): boolean {
  for (const found of token.matchAll(GITHUB_URL_START)) {
    const host = found[1]
    if (host !== undefined && isPrivateGithubUrl(host, token.slice(found.index + found[0].length))) return true
  }
  for (const reference of token.matchAll(REPO_REFERENCE)) {
    if (isPrivateRepoReference(reference[1], reference[2])) return true
  }
  return false
}

/**
 * Replace private references in published release text. Markdown links, autolinks and URL tokens are judged
 * WHOLE (target and anything nested in it): one private reference anywhere replaces the entire token. A link whose
 * target is clean but whose text names a private repo#N keeps the target and neutralizes only the text. Plain-text
 * references are replaced one by one. Public text comes out byte-identical.
 */
export function neutralizeCrossRepoReferences(text: string): string {
  return text.replace(
    CROSS_REPO_PATTERN,
    (
      match: string,
      linkText: string | undefined,
      linkTarget: string | undefined,
      angleUrl: string | undefined,
      urlToken: string | undefined,
      refOwner: string | undefined,
      refRepo: string | undefined,
    ) => {
      if (linkTarget !== undefined) {
        if (findPrivateReferences(linkTarget)) return NEUTRALIZED
        return "[" + neutralizeCrossRepoReferences(linkText ?? "") + "](" + linkTarget + ")"
      }
      // The whole autolink goes, angle brackets included: a bare <tracked internally> would render as an HTML tag.
      if (angleUrl !== undefined) return findPrivateReferences(angleUrl) ? NEUTRALIZED : match
      if (urlToken !== undefined) {
        const tail = /[.,;:!?]+$/.exec(urlToken)?.[0] ?? ""
        return findPrivateReferences(urlToken.slice(0, urlToken.length - tail.length)) ? NEUTRALIZED + tail : match
      }
      return isPrivateRepoReference(refOwner, refRepo) ? NEUTRALIZED : match
    },
  )
}

/** Release body = authored notes, then the contributor block, then the install footer. */
export function composeReleaseBody(notes: string, contributors: string, installFooter: string): string {
  const parts = [neutralizeCrossRepoReferences(notes.trim())]
  if (contributors.trim()) parts.push(neutralizeCrossRepoReferences(contributors.trim()))
  if (installFooter.trim()) parts.push(installFooter.trim())
  return `${parts.join("\n\n")}\n`
}
