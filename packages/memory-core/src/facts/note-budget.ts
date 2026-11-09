// Size budget for the monthly facts notes (#10884). The facts lane appends to `notes/facts/<YYYY-MM>.md`
// and nothing bounded a note between dreams, so a busy month grew past a thousand lines of mostly
// day-only state. A note over this budget is what starts a pressure dream and what that dream is told
// to consolidate; the budget itself is `memory.facts_note_max_bytes` (`0` disables it).

import { join } from "node:path"

import { readdir, readFile } from "../fs/resilient"

export const DEFAULT_FACTS_NOTE_MAX_BYTES = 48 * 1024

const FACTS_NOTE_PATH = /^notes\/facts\/[^/]+\.md$/

export interface FactsNoteSize {
  readonly path: string
  readonly bytes: number
  readonly lines: number
}

/** A committed monthly facts note: markdown directly under `notes/facts/`, never in a subdirectory. */
export function isFactsNotePath(path: string): boolean {
  return FACTS_NOTE_PATH.test(path)
}

export function measureFactsNote(path: string, content: string): FactsNoteSize {
  if (content.length === 0) return { path, bytes: 0, lines: 0 }
  const newlines = content.split("\n").length - 1
  return { path, bytes: Buffer.byteLength(content, "utf8"), lines: content.endsWith("\n") ? newlines : newlines + 1 }
}

/** Every facts note in a checked-out memory repo, sorted by path; a repo without `notes/facts/` has none. */
export async function measureFactsNotesInDir(repoDir: string): Promise<FactsNoteSize[]> {
  let names: string[]
  try {
    names = await readdir(join(repoDir, "notes", "facts"))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
  const paths = names.map((name) => `notes/facts/${name}`).filter(isFactsNotePath).sort()
  return Promise.all(paths.map(async (path) => measureFactsNote(path, await readFile(join(repoDir, path), "utf8"))))
}

/** Notes strictly over `maxBytes`, largest first; a budget of `0` or less disables the check. */
export function factsNotesOverBudget(notes: readonly FactsNoteSize[], maxBytes: number): FactsNoteSize[] {
  if (maxBytes <= 0) return []
  return notes.filter((note) => note.bytes > maxBytes).sort((left, right) => right.bytes - left.bytes || left.path.localeCompare(right.path))
}
