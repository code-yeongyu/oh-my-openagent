/**
 * Per-PR changelog fragments (#9961).
 *
 * A user-facing PR describes its change in `changes/unreleased/<pr>.md` — one file per PR, named by
 * the PR number, body = the exact paragraphs that belong under CHANGELOG.md's `## [Unreleased]`.
 * Release-state preparation assembles every fragment into that section, stamps it into the
 * released version's section, and deletes the consumed fragments in the release commit, so two PRs
 * never edit the same changelog lines again.
 *
 * Fail-closed everywhere: a malformed fragment name, an empty fragment, a duplicated PR id, or an
 * empty fragment set at release time is an error, never a silently partial changelog.
 */

export const FRAGMENT_DIR = "changes/unreleased"

/** Files allowed in the fragment directory besides `<pr>.md`. */
const NON_PR_ALLOWLIST = new Set(["README.md"])

export type Fragment = { readonly pr: number; readonly content: string }

export function fragmentPath(pr: number): string {
  return `${FRAGMENT_DIR}/${pr}.md`
}

/** Parse one fragment file. `null` for allowlisted non-fragment files; throws on anything malformed. */
export function parseFragment(name: string, content: string): Fragment | null {
  if (NON_PR_ALLOWLIST.has(name)) return null
  const pr = /^(\d+)\.md$/.exec(name)?.[1]
  if (pr === undefined) throw new Error(`changelog fragment must be named <pr-number>.md, got: ${name}`)
  const trimmed = content.trim()
  if (!trimmed) throw new Error(`changelog fragment ${name} is empty`)
  return { pr: Number(pr), content: trimmed }
}

/**
 * Read and validate a whole fragment directory, newest PR first. Leading-zero aliases of an
 * existing id (`042.md` beside `42.md`) are refused as duplicates rather than merged.
 */
export function readFragments(names: readonly string[], read: (name: string) => string): Fragment[] {
  const fragments: Fragment[] = []
  const seen = new Set<number>()
  for (const name of names) {
    const fragment = parseFragment(name, read(name))
    if (!fragment) continue
    if (seen.has(fragment.pr)) throw new Error(`duplicate changelog fragment for PR #${fragment.pr}`)
    seen.add(fragment.pr)
    fragments.push(fragment)
  }
  fragments.sort((left, right) => right.pr - left.pr)
  return fragments
}

/** The Unreleased section body: fragments joined newest-first with one blank line between entries. */
export function assembleUnreleasedBody(fragments: readonly Fragment[]): string {
  return fragments.map((fragment) => fragment.content).join("\n\n")
}

const UNRELEASED_HEADING = "## [Unreleased]"

/** Body between the Unreleased heading and the next `## ` heading, without the heading itself. */
export function unreleasedBody(changelog: string): string {
  const index = changelog.indexOf(UNRELEASED_HEADING)
  if (index < 0) throw new Error(`changelog has no ${UNRELEASED_HEADING} heading`)
  const rest = changelog.slice(index + UNRELEASED_HEADING.length)
  const next = rest.search(/^## /m)
  return (next < 0 ? rest : rest.slice(0, next)).trim()
}

/**
 * Replace the Unreleased section body with `body`; everything outside the section is untouched.
 * An empty `body` reopens an empty Unreleased block in the same shape `stampUnreleased` produces.
 */
export function mergeUnreleased(changelog: string, body: string): string {
  const index = changelog.indexOf(UNRELEASED_HEADING)
  if (index < 0) throw new Error(`changelog has no ${UNRELEASED_HEADING} heading to fill`)
  const rest = changelog.slice(index + UNRELEASED_HEADING.length)
  const next = rest.search(/^## /m)
  const tail = next < 0 ? "" : rest.slice(next)
  const trimmed = body.trim()
  const filled = trimmed ? `${UNRELEASED_HEADING}\n\n${trimmed}\n\n${tail}` : `${UNRELEASED_HEADING}\n\n${tail}`
  return changelog.slice(0, index) + filled
}
