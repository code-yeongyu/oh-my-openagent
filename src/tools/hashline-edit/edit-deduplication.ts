import type { HashlineEdit } from "./types"
import { toNewLines } from "./edit-text-normalization"

function normalizeEditPayload(payload: string | string[]): string {
  return toNewLines(payload).join("\n")
}

function buildDedupeKey(edit: HashlineEdit): string {
  switch (edit.type) {
    case "set_line":
      return `set_line|${edit.line}|${normalizeEditPayload(edit.text)}`
    case "replace_lines":
      return `replace_lines|${edit.start_line}|${edit.end_line}|${normalizeEditPayload(edit.text)}`
    case "insert_after":
      return `insert_after|${edit.line}|${normalizeEditPayload(edit.text)}`
    case "insert_before":
      return `insert_before|${edit.line}|${normalizeEditPayload(edit.text)}`
    case "insert_between":
      return `insert_between|${edit.after_line}|${edit.before_line}|${normalizeEditPayload(edit.text)}`
    case "replace":
      return `replace|${edit.old_text}|${normalizeEditPayload(edit.new_text)}`
    case "append":
      return `append|${normalizeEditPayload(edit.text)}`
    case "prepend":
      return `prepend|${normalizeEditPayload(edit.text)}`
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
