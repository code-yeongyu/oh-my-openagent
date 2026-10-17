/** Deterministic, fail-closed operations for the generated current release section. */
const START = "<!-- omo:current-releases:start -->"
const END = "<!-- omo:current-releases:end -->"

export function stampCurrentSection(changelog: string, section: string): string {
  if (typeof changelog !== "string" || typeof section !== "string" || !section.trim()) throw new Error("changelog and section are required")
  if (changelog.includes(START) || changelog.includes(END)) throw new Error("current release section already exists")
  return `${changelog.trimEnd()}\n\n${START}\n${section.trim()}\n${END}\n`
}

export function extractCurrentSection(changelog: string): string {
  const start = changelog.indexOf(START)
  const end = changelog.indexOf(END)
  if (start < 0 || end < 0 || end <= start) throw new Error("current release section markers are missing or malformed")
  const content = changelog.slice(start + START.length, end).trim()
  if (!content) throw new Error("current release section is empty")
  return content
}

export const currentSectionMarkers = { start: START, end: END } as const
