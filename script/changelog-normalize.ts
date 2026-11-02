/**
 * Repairs a backfilled changelog so every release section is self-contained.
 *
 * Release bodies were imported verbatim, so many carry their own `## ` headings. Because a
 * section ends at the next `## `, those strays truncate the release notes - 27 of 51 sections
 * lost most of their body. Demoting them one level keeps the text and restores the boundary.
 *
 * The accumulated pre-backfill ledger is moved out of [Unreleased] into a labelled section, so
 * [Unreleased] means "notes for the next release" and a release can never publish stale history.
 */

const VERSION_HEADING = /^## \[[^\]]+\][^\n]*$/
const UNRELEASED_HEADING = "## [Unreleased]"
const LEGACY_HEADING = "## Development ledger (pre-backfill, unversioned)"

/** Heading lines inside a fenced code block are content, not structure. */
function demoteStrayHeadings(body: string): string {
  const out: string[] = []
  let fence: string | null = null
  for (const line of body.split("\n")) {
    const fenceMatch = /^(`{3,}|~{3,})/.exec(line.trim())
    if (fenceMatch) {
      const marker = fenceMatch[1] as string
      if (fence === null) fence = marker[0] as string
      else if (marker[0] === fence) fence = null
      out.push(line)
      continue
    }
    if (fence === null && /^#{2,5} /.test(line)) out.push(`#${line}`)
    else out.push(line)
  }
  return out.join("\n")
}

export function normalizeReleaseSections(changelog: string): string {
  const lines = changelog.split("\n")
  const starts: number[] = []
  let fence: string | null = null
  lines.forEach((line, index) => {
    const fenceMatch = /^(`{3,}|~{3,})/.exec(line.trim())
    if (fenceMatch) {
      const marker = (fenceMatch[1] as string)[0] as string
      if (fence === null) fence = marker
      else if (marker === fence) fence = null
      return
    }
    if (fence === null && VERSION_HEADING.test(line) && line !== UNRELEASED_HEADING) starts.push(index)
  })
  if (starts.length === 0) return changelog

  const result = lines.slice(0, starts[0] as number)
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i] as number
    const end = i + 1 < starts.length ? (starts[i + 1] as number) : lines.length
    result.push(lines[start] as string)
    result.push(...demoteStrayHeadings(lines.slice(start + 1, end).join("\n")).split("\n"))
  }
  return result.join("\n")
}

/** Move the accumulated [Unreleased] body into a labelled ledger, leaving [Unreleased] empty. */
export function extractLegacyLedger(changelog: string): string {
  const index = changelog.indexOf(UNRELEASED_HEADING)
  if (index < 0) return changelog
  const after = index + UNRELEASED_HEADING.length
  const rest = changelog.slice(after)
  const nextRelative = rest.search(/^## /m)
  const body = (nextRelative < 0 ? rest : rest.slice(0, nextRelative)).trim()
  if (!body) return changelog
  const tail = nextRelative < 0 ? "" : rest.slice(nextRelative)
  const ledger = [
    "",
    "",
    LEGACY_HEADING,
    "",
    "Accumulated before the release sections below were backfilled from the published releases.",
    "Kept verbatim; it was never attributed to a single release and is not release notes.",
    "",
    body,
    "",
  ].join("\n")
  return `${changelog.slice(0, after)}\n\n${tail.trimEnd()}${ledger}`
}
