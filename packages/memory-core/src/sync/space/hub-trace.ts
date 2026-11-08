// Hub-trace folding (plan todo 5): exactly two transformations, no others.
// T1: a file `<stem>.sync-conflict-<YYYYMMDD>-<label><ext>` (the Mini hub's
// worktree-merge keepSideCopy shape) belongs to the item of `<stem><ext>`; its text is
// adopted insert-only by planAdoption and the side file is removed once the commit
// carrying its text lands. T2: a body block in the hub's md-merge-driver pickFrontmatter
// comment shape is parsed with the item frontmatter grammar and adopted per key,
// insert-only, then removed from the body; a block that does not parse stays untouched.
// Text deletion is never produced here.

import { splitItem, type FmEntry } from "../item/frontmatter"
import { normalizeItemKey } from "../item/key"

export interface SyncConflictName {
  readonly target: string
  readonly day: string
  readonly label: string
}

const T1_RE = /^(.*)\.sync-conflict-(\d{8})-([A-Za-z0-9-]*)(\.[^/.]*)?$/

export function parseSyncConflictName(path: string): SyncConflictName | null {
  const m = T1_RE.exec(path)
  if (m === null) return null
  const stem = m[1] ?? ""
  if (stem === "") return null
  return { target: `${stem}${m[4] ?? ""}`, day: m[2] ?? "", label: m[3] ?? "" }
}

export function groupByItemKey(paths: readonly string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const path of paths) {
    const side = parseSyncConflictName(path)
    const key = normalizeItemKey(side?.target ?? path)
    if (key === null) continue
    const list = groups.get(key)
    if (list === undefined) groups.set(key, [path])
    else list.push(path)
  }
  return groups
}

export interface T2Strip {
  readonly body: string
  readonly entries: readonly FmEntry[]
  /** Blocks that matched the marker shape but did not parse; they stay in the body verbatim. */
  readonly malformed: readonly string[]
}

const T2_SOURCE =
  "(?<=^|\\n)\\n?<!-- memory-sync \\d{4}-\\d{2}-\\d{2}: the other machine had different frontmatter for (.+?); kept here so no fact is lost:\\n([\\s\\S]*?(?:\\n|---))-->\\n"

export function stripT2Blocks(body: string): T2Strip {
  const re = new RegExp(T2_SOURCE, "g")
  const entries: FmEntry[] = []
  const malformed: string[] = []
  let out = ""
  let cursor = 0
  for (const match of body.matchAll(re)) {
    const index = match.index
    out += body.slice(cursor, index)
    cursor = index + match[0].length
    const kept = (match[2] ?? "").replace(/-- >/g, "-->")
    const parsed = splitItem(kept)
    if (parsed.fm === null || parsed.body !== "") {
      malformed.push(match[0])
      out += match[0]
      continue
    }
    for (const entry of parsed.fm) {
      if (entry.value.kind !== "remove") entries.push(entry)
    }
  }
  out += body.slice(cursor)
  return { body: out, entries, malformed }
}
