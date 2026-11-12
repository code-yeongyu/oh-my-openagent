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
])

// A GitHub URL is ANY URL to a repository: optional www., case-insensitive host, owner/repo, then optionally any
// path, query or fragment (bare repo URLs, /blob/, /tree/, /discussions/, /releases/ are all covered).
const HOST = String.raw`(?:www\.)?github\.com\/`
const REPO = String.raw`([\w.-]+)\/([\w.-]*[\w-])`
const URL_TAIL = String.raw`(?:[/?#](?:[^\s)\]>]*[^\s)\]>.,;:!?])?)?`

// One pass, so the inside of a kept public URL is never rewritten again. Alternatives, in order (the capture
// groups are consumed positionally by the replacer): 1-4 markdown link, 5-6 autolink, 7-8 URL with an explicit
// http(s):// scheme (matched wherever it appears), 9-10 scheme-less URL (only when not glued to a URL or word),
// 11-12 an (optionally owner-qualified) repo#N reference.
const MARKDOWN_LINK = String.raw`\[([^\]]*)\]\(((?:https?:\/\/)?` + HOST + REPO + String.raw`[^\s)]*)\)`
const AUTOLINK = String.raw`<(?:https?:\/\/)?` + HOST + REPO + String.raw`[^\s>]*>`
const SCHEME_URL = String.raw`https?:\/\/` + HOST + REPO + URL_TAIL
const SCHEMELESS_URL = String.raw`(?<![\w./-])` + HOST + REPO + URL_TAIL
const REPO_REFERENCE = String.raw`\b(?:([\w.-]+)\/)?([A-Za-z][\w.-]*)#\d+\b`
const CROSS_REPO_PATTERN = new RegExp(
  [MARKDOWN_LINK, AUTOLINK, SCHEME_URL, SCHEMELESS_URL, REPO_REFERENCE].join("|"),
  "gi",
)

// Keep (do not neutralize) a GitHub URL that is a public repo or not a repo at all. A trailing .git is the
// clone-URL spelling of the same repo.
function keepsGithubUrl(owner: string, repo: string): boolean {
  if (RESERVED_GITHUB_PATHS.has(owner.toLowerCase())) return true
  return isPublicPair(owner, repo.replace(/\.git$/i, ""))
}

function isPublicPair(owner: string, repo: string): boolean {
  return PUBLIC_QUALIFIED_REPOS.has((owner + "/" + repo).toLowerCase())
}

export function neutralizeCrossRepoReferences(text: string): string {
  return text.replace(
    CROSS_REPO_PATTERN,
    (
      match: string,
      linkText: string | undefined,
      linkUrl: string | undefined,
      linkOwner: string | undefined,
      linkRepo: string | undefined,
      autoOwner: string | undefined,
      autoRepo: string | undefined,
      schemeOwner: string | undefined,
      schemeRepo: string | undefined,
      bareOwner: string | undefined,
      bareRepo: string | undefined,
      refOwner: string | undefined,
      refRepo: string | undefined,
    ) => {
      if (linkOwner !== undefined && linkRepo !== undefined) {
        if (!keepsGithubUrl(linkOwner, linkRepo)) return NEUTRALIZED
        return "[" + neutralizeCrossRepoReferences(linkText ?? "") + "](" + linkUrl + ")"
      }
      // The whole autolink goes, angle brackets included: a bare <tracked internally> would render as an HTML tag.
      if (autoOwner !== undefined && autoRepo !== undefined)
        return keepsGithubUrl(autoOwner, autoRepo) ? match : NEUTRALIZED
      const urlOwner = schemeOwner ?? bareOwner
      const urlRepo = schemeRepo ?? bareRepo
      if (urlOwner !== undefined && urlRepo !== undefined)
        return keepsGithubUrl(urlOwner, urlRepo) ? match : NEUTRALIZED
      if (refRepo === undefined || /[-.]$/.test(refRepo) || NON_REPO_TOKENS.has(refRepo.toLowerCase())) return match
      const isPublic =
        refOwner === undefined ? PUBLIC_UNQUALIFIED_REPOS.has(refRepo.toLowerCase()) : isPublicPair(refOwner, refRepo)
      return isPublic ? match : NEUTRALIZED
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
