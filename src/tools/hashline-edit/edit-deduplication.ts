import type { HashlineEdit } from "./types"
import { toNewLines } from "./edit-text-normalization"

function normalizeEditPayload(payload: string | string[]): string {
  return toNewLines(payload).join("\n")
}

function buildDedupeKey(edit: HashlineEdit): string {
  switch (edit.op) {
    case "replace":
      return `replace|${edit.pos}|${edit.end ?? ""}|${normalizeEditPayload(edit.lines)}`
    case "append":
      return `append|${edit.pos ?? ""}|${normalizeEditPayload(edit.lines)}`
    case "prepend":
      return `prepend|${edit.pos ?? ""}|${normalizeEditPayload(edit.lines)}`
    default:
      return JSON.stringify(edit)
  }
}

export function dedupeEdits(edits: HashlineEdit[]): { edits: HashlineEdit[]; deduplicatedEdits: number } {
  const seen = new Set<string>()
  const deduped: HashlineEdit[] = []
  let deduplicatedEdits = 0

  for (const edit of edits) {
    const key = buildDedupeKey(edit)
    if (seen.has(key)) {
      deduplicatedEdits += 1
      continue
    }
    seen.add(key)
    deduped.push(edit)
  }

  return { edits: deduped, deduplicatedEdits }
}
