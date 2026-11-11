// The exact text each apply action adds, so the planner's budget delta and the applier's writes agree byte for byte.

import { parseMemoryFile, renderMemoryFile } from "../memfs/frontmatter"
import { FRONTMATTER_RE, isPlainSafeScalar } from "../memfs/frontmatter-scalar"
import { CONFLICTS_WITH_KEY, conflictsWithOf } from "./conflicts"
import type { CleanupNote } from "./corpus"
import type { CleanupAction, MemoryCleanupFinding } from "./types"

type MergeAction = Extract<CleanupAction, { kind: "merge" }>
type ArchiveAction = Extract<CleanupAction, { kind: "archive" }>

const ARCHIVE_DESCRIPTION =
  "Archived memory notes: retired by cleanup or reflection with the reason and the note that replaced each one."

function dayOf(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

function mergeSection(action: MergeAction, now: number): string {
  return `\n\n## Merged from ${action.from} (memory cleanup ${dayOf(now)})\n\n${action.paragraphs.join("\n\n")}\n`
}

export function mergeSectionBytes(action: MergeAction, now: number): number {
  return Buffer.byteLength(mergeSection(action, now), "utf8")
}

export function appendMerge(content: string, action: MergeAction, now: number): string {
  return `${content.replace(/\s+$/, "")}${mergeSection(action, now)}`
}

export function markLineBytes(other: string): number {
  return Buffer.byteLength(`${CONFLICTS_WITH_KEY}: ${other}\n`, "utf8")
}

/** The note with `other` added to its `conflicts_with` header key; every other byte of the file is left as written. */
export function withConflictMark(note: Pick<CleanupNote, "content" | "frontmatter">, other: string): string {
  const existing = conflictsWithOf(note)
  const values = existing.includes(other) ? existing : [...existing, other]
  const joined = values.join(" ")
  const scalar = isPlainSafeScalar(joined) ? joined : JSON.stringify(joined)
  const line = `${CONFLICTS_WITH_KEY}: ${scalar}`
  const match = FRONTMATTER_RE.exec(note.content)
  if (match === null) throw new Error(`cannot mark ${CONFLICTS_WITH_KEY}: file has no frontmatter`)
  const header = match[1] ?? ""
  const keyLine = new RegExp(`^${CONFLICTS_WITH_KEY}:.*$`, "m")
  const nextHeader = keyLine.test(header) ? header.replace(keyLine, line) : `${header}\n${line}`
  const marked = note.content.replace(header, () => nextHeader)
  const parsed = parseMemoryFile(marked)
  if (!conflictsWithOf({ frontmatter: parsed.frontmatter }).includes(other)) {
    throw new Error(`cannot mark ${CONFLICTS_WITH_KEY}: header did not read back`)
  }
  return marked
}

export function archiveSection(
  note: CleanupNote,
  action: ArchiveAction,
  finding: MemoryCleanupFinding,
  now: number,
): string {
  const lines = [
    `## Archived ${note.path} (memory cleanup ${dayOf(now)})`,
    "",
    `- Reason: ${action.reason}`,
    ...(action.successor === undefined ? [] : [`- Replaced by: [[${action.successor}]]`]),
    ...finding.evidence.map(
      (item) => `- Evidence (${item.kind})${item.at === undefined ? "" : ` at ${item.at}`}: ${item.detail}`,
    ),
    `- Original description: ${note.frontmatter.description}`,
    ...headerExtras(note),
    "",
    note.body.replace(/\s+$/, ""),
    "",
  ]
  return lines.join("\n")
}

function headerExtras(note: CleanupNote): string[] {
  const extras = Object.entries(note.frontmatter.extra ?? {})
  const kind = note.frontmatter.kind === undefined ? [] : [`kind: ${note.frontmatter.kind}`]
  const aliases = note.frontmatter.aliases === undefined ? [] : [`aliases: ${JSON.stringify(note.frontmatter.aliases)}`]
  const all = [...kind, ...aliases, ...extras.map(([key, value]) => `${key}: ${value}`)]
  return all.length === 0 ? [] : [`- Original frontmatter: ${all.join("; ")}`]
}

export function appendToArchive(existing: string | undefined, sections: readonly string[]): string {
  const base =
    existing === undefined || existing.trim() === ""
      ? renderMemoryFile({ description: ARCHIVE_DESCRIPTION }, "# Archive\n")
      : existing
  return `${base.replace(/\s+$/, "")}\n\n${sections.join("\n")}`
}
