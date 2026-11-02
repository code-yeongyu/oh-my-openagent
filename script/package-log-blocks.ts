/**
 * Change-log blocks inside per-PR fragments (#9961, #10841).
 *
 * `changes/unreleased/<pr>.md` starts with the CHANGELOG text (the preamble, assembled at release)
 * and may carry one block per log it would have prepended to (`changes.md` or a package's):
 *
 *   <!-- changes-log: packages/omo-senpi/changes.md -->
 *   ## 2026-10-20 - Title (#123)
 *   ...
 *
 * The marker and heading grammar is the omo-desktop-app one (#3072). At the release cut,
 * `compileBlocks` writes every block into its log, newest PR on top, and leaves each fragment with
 * its preamble only.
 */

import { mergeNotes } from "./changelog-release-assembly.ts"

const MARKER = /^<!-- changes-log: (\S+) -->$/
// The root changes.md, or one plain package segment: no ".", "..", "%" escapes or other characters a URL resolver could reinterpret.
const CHANGE_LOG = /^(?:changes\.md|packages\/(?!\.\.?\/)[A-Za-z0-9_][A-Za-z0-9._-]*\/changes\.md)$/
const DATED_HEADING = /^## \d{4}-\d{2}-\d{2} (?:-|—) \S/
const CONFLICT_MARKER = /^(?:<{7}|\|{7}|={7}|>{7})(?:\s|$)/m

export type Block = { readonly log: string; readonly body: string }
export type SplitFragment = { readonly preamble: string; readonly blocks: readonly Block[]; readonly reasons: readonly string[] }

export const markerLine = (log: string): string => `<!-- changes-log: ${log} -->`

export function splitFragment(content: string): SplitFragment {
  const lines = content.replace(/\r\n/g, "\n").split("\n")
  const preamble: string[] = []
  const raw: { log: string; lines: string[] }[] = []
  for (const line of lines) {
    const target = MARKER.exec(line)
    if (target) raw.push({ log: target[1] ?? "", lines: [] })
    else (raw.at(-1)?.lines ?? preamble).push(line)
  }
  const reasons: string[] = []
  if (CONFLICT_MARKER.test(content)) reasons.push("the fragment holds a merge-conflict marker")
  const blocks = raw.map(({ log, lines: body }) => ({ log, body: body.join("\n").trim() }))
  const seen = new Set<string>()
  for (const block of blocks) {
    if (!CHANGE_LOG.test(block.log)) reasons.push(`\`${block.log}\` is not a change log (changes.md or packages/<name>/changes.md)`)
    if (seen.has(block.log)) reasons.push(`\`${block.log}\` has two blocks; write one`)
    seen.add(block.log)
    if (!DATED_HEADING.test(block.body.split("\n")[0] ?? "")) reasons.push(`the block for \`${block.log}\` must start with \`## YYYY-MM-DD - <title>\``)
  }
  return { preamble: preamble.join("\n").trim(), blocks, reasons }
}

/**
 * One fragment from several, in the given order: their preambles joined, and one block per log whose body is every
 * input's entry for that log. Used when a branch gains entries (from-diff) or a batch absorbs its cars (fold-batch).
 */
export function combineFragments(contents: readonly string[]): string {
  const preambles: string[] = []
  const byLog = new Map<string, string[]>()
  for (const content of contents) {
    const split = splitFragment(content)
    if (split.reasons.length > 0) throw new Error(split.reasons.join("; "))
    if (split.preamble !== "") preambles.push(split.preamble)
    for (const block of split.blocks) byLog.set(block.log, [...(byLog.get(block.log) ?? []), block.body])
  }
  const blocks = [...byLog].map(([log, bodies]) => `${markerLine(log)}\n${bodies.join("\n\n")}`)
  return `${[mergeNotes(preambles), ...blocks].filter((part) => part !== "").join("\n\n")}\n`
}

/** Puts `entries` (newest first) on top of a log, below a leading `# title` line when it has one. */
export function prependToLog(log: string, entries: readonly string[]): string {
  const text = entries.join("\n\n")
  const title = /^# [^\n]*\n+/.exec(log)
  if (!title) return `${text}\n\n${log.replace(/^\n+/, "")}`
  return `${title[0].trimEnd()}\n\n${text}\n\n${log.slice(title[0].length)}`
}

export type CompileResult = {
  /** New content per package log. */
  readonly logs: ReadonlyMap<string, string>
  /** Per fragment: the content to keep (its preamble), or null to delete the file. */
  readonly fragments: ReadonlyMap<number, string | null>
}

/** All-or-nothing: any invalid fragment or missing log throws before anything is written. */
export function compileBlocks(fragments: readonly { readonly pr: number; readonly content: string }[], readLog: (path: string) => string | null): CompileResult {
  const byLog = new Map<string, string[]>()
  const kept = new Map<number, string | null>()
  for (const fragment of [...fragments].sort((left, right) => right.pr - left.pr)) {
    const split = splitFragment(fragment.content)
    if (split.reasons.length > 0) throw new Error(`fragment #${fragment.pr}: ${split.reasons.join("; ")}`)
    if (split.blocks.length === 0) continue
    for (const block of split.blocks) byLog.set(block.log, [...(byLog.get(block.log) ?? []), block.body])
    kept.set(fragment.pr, split.preamble === "" ? null : `${split.preamble}\n`)
  }
  const logs = new Map<string, string>()
  for (const [path, entries] of byLog) {
    const current = readLog(path)
    if (current === null) throw new Error(`fragment block names \`${path}\`, which does not exist`)
    logs.set(path, prependToLog(current, entries))
  }
  return { logs, fragments: kept }
}

/**
 * Converts a branch that still prepends to package logs: the lines it added above the base's first
 * line become blocks. Returns null when the log was edited anywhere but its top.
 */
export function blockFromPrepend(log: string, base: string, head: string): Block | null {
  const baseBody = base.replace(/^# [^\n]*\n+/, "")
  const title = /^# [^\n]*\n+/.exec(head)?.[0] ?? ""
  const headBody = head.slice(title.length)
  if (!headBody.endsWith(baseBody)) return null
  const added = headBody.slice(0, headBody.length - baseBody.length).trim()
  return added === "" ? null : { log, body: added }
}
