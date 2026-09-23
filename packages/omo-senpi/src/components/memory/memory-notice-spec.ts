// The one visible vocabulary for "memory changed" rows: memory tool writes, reflection merges, and
// soul edits all read as the agent remembering something, in the same accent tone and the same
// compact frame (bold title, one dim sentence, dim quantitative lines, one expanded-only detail).
//
// Every spec is plain data for `buildNoticeBox`; this module never touches a theme or a component.

import type { NoticeSpec } from "@oh-my-opencode/senpi-task/notice-box"
import { normalizeRendererText } from "@oh-my-opencode/senpi-task/renderer-text"

import { formatRelativeAge } from "./status"
import type { MemoryWriteNotice } from "./tools"
import { joinFields } from "./worker/entry-renderers"

export const REMEMBERED_TITLE = "Remembered"
export const LET_GO_TITLE = "Let go"

/** A consolidation older than this reads as neglect, not cadence. */
const STALE_CONSOLIDATION_MS = 7 * 24 * 60 * 60 * 1_000
/** Matches the default reflection step trigger: at this backlog a reflection is overdue. */
const UNREFLECTED_WARN_STEPS = 25
/** Below this many bytes a one-decimal K reads as precision; above it the decimal is noise. */
const DECIMAL_KB_LIMIT = 10 * 1_024

export interface MemoryNoticeArgs {
  readonly command?: string
  readonly file_path?: string
  readonly old_path?: string
  readonly new_path?: string
}

export function rememberedTitle(detail?: string): string {
  return `● ${joinFields([REMEMBERED_TITLE, detail])}`
}

export function memoryWriteNoticeSpec(notice: MemoryWriteNotice, now: number, args: MemoryNoticeArgs = {}): NoticeSpec {
  const size = sizeLine(notice)
  const timeline = timelineLine(notice, now)
  const detail = joinFields([shortSha(notice.sha), optional(notice.identity), optional(notice.subject)])
  return {
    title: `● ${titleLine(notice, args)}`,
    tone: "accent",
    why: whyLine(notice, args),
    extra: [
      ...(size === undefined ? [] : [{ text: size, tone: "dim" as const }]),
      ...(timeline === undefined ? [] : [timeline]),
    ],
    ...(detail.length === 0 ? {} : { expandedLine: detail }),
  }
}

/** A committed write whose facts could not be gathered: the same notice, without the stat lines. */
export function memoryDegradedNoticeSpec(args: MemoryNoticeArgs = {}): NoticeSpec {
  return memoryWriteNoticeSpec({ sha: "", subject: "", identity: "", affected: [], timeline: {} }, 0, args)
}

/** A refused write: calm and dim, one plain sentence; the raw engine message stays expanded-only. */
export function memoryFailureNoticeSpec(message: string, args: MemoryNoticeArgs = {}): NoticeSpec {
  const raw = normalizeRendererText(message)
  return {
    title: args.command === "delete" ? "○ Couldn't let go" : "○ Not remembered",
    tone: "dim",
    why: friendlyFailure(raw),
    ...(raw.length === 0 ? {} : { expandedLine: raw }),
  }
}

export function memoryPendingLine(args: MemoryNoticeArgs): string {
  if (args.command === "delete") return joinFields(["◌ Letting go", optional(args.file_path)])
  if (args.command === "rename") {
    const from = optional(args.old_path)
    const to = optional(args.new_path)
    return joinFields(["◌ Moving", from !== undefined && to !== undefined ? `${from} → ${to}` : from ?? to])
  }
  return joinFields(["◌ Remembering", optional(args.file_path)])
}

/** "Remembered · 4th entry today"; the count drops out when the commit walk failed. */
function titleLine(notice: MemoryWriteNotice, args: MemoryNoticeArgs): string {
  const title = args.command === "delete" ? LET_GO_TITLE : REMEMBERED_TITLE
  const entries = notice.timeline.entriesToday
  if (entries === undefined || !Number.isFinite(entries) || entries <= 0) return title
  return joinFields([title, `${ordinal(Math.floor(entries))} entry today`])
}

/** English ordinals: 1st/2nd/3rd/4th, with the 11-13 exception. */
export function ordinal(value: number): string {
  const teens = value % 100
  const suffix = teens >= 11 && teens <= 13
    ? "th"
    : value % 10 === 1
      ? "st"
      : value % 10 === 2
        ? "nd"
        : value % 10 === 3
          ? "rd"
          : "th"
  return `${value}${suffix}`
}

/**
 * One full sentence. A deletion or a move says what happened to which path; a single file whose
 * change is pure insertion reads as growth ("Added 47 lines"); anything else lists the touched paths.
 */
function whyLine(notice: MemoryWriteNotice, args: MemoryNoticeArgs): string {
  const affected = notice.affected
  const only = affected.length === 1 ? affected[0] : undefined
  if (args.command === "delete") {
    const path = optional(args.file_path) ?? (only === undefined ? undefined : normalizeRendererText(only.path))
    const cleared = path === undefined ? "a memory" : lines(path, only?.deletions ?? 0)
    return `Cleared ${cleared}. One less thing to carry.`
  }
  if (args.command === "rename" && optional(args.old_path) !== undefined && optional(args.new_path) !== undefined) {
    return `Moved ${optional(args.old_path)} to ${optional(args.new_path)}.`
  }
  if (affected.length === 0) {
    const path = optional(args.file_path)
    return path === undefined ? "Saved a memory change." : `Saved ${path}.`
  }
  if (only !== undefined && only.deletions === 0 && only.insertions > 0) {
    return `Added ${only.insertions} line${only.insertions === 1 ? "" : "s"} to ${normalizeRendererText(only.path)}.`
  }
  const paths = affected.map((entry) => normalizeRendererText(entry.path)).join(", ")
  return `Updated ${affected.length} memory file${affected.length === 1 ? "" : "s"} (${paths}).`
}

function lines(path: string, count: number): string {
  return count > 0 ? `${path} (${count} line${count === 1 ? "" : "s"})` : path
}

/** Engine refusals rephrased for a person; unknown messages lose only their `memory: <command>:` prefix. */
function friendlyFailure(raw: string): string {
  const message = raw.replace(/^memory:\s*/u, "").replace(/^[a-z_]+:\s+/u, "")
  const exists = /^(?:block|destination) already exists at (.+)$/u.exec(message)
  if (exists?.[1] !== undefined) return `${exists[1]} already exists.`
  if (/^old_string was not found/u.test(message)) return "The text to replace was not in that memory."
  const readOnly = /^(.+) is read_only and cannot be modified$/u.exec(message)
  if (readOnly?.[1] !== undefined) return `${readOnly[1]} is read-only.`
  if (/made no (?:effective )?changes$/u.test(message)) return "Nothing needed to change."
  if (/^no memory identity bound/u.test(message)) return "Memory is not ready for this session yet."
  const missing = /^'([a-z_]+)' must be a non-empty string$/u.exec(message)
  if (missing?.[1] !== undefined) return `The request had no ${missing[1].replace(/_/gu, " ")}.`
  if (message.length === 0) return "Memory was left unchanged."
  const sentence = `${message.charAt(0).toUpperCase()}${message.slice(1)}`
  return /[.!?]$/u.test(sentence) ? sentence : `${sentence}.`
}

/** "system 2.0K injected · 33K total · 12 files"; omitted whole when the tree walk failed. */
function sizeLine(notice: MemoryWriteNotice): string | undefined {
  const size = notice.size
  if (size === undefined) return undefined
  return joinFields([
    `system ${formatBytes(size.systemBytes)} injected`,
    `${formatBytes(size.totalBytes)} total`,
    `${size.fileCount} file${size.fileCount === 1 ? "" : "s"}`,
  ])
}

/**
 * "last entry 5m ago · last consolidation 6d ago · 3 steps unreflected". The line turns warning
 * toned once consolidation is a week stale or the reflection backlog reaches its trigger size,
 * because at that point the numbers are a call to action rather than context.
 */
function timelineLine(
  notice: MemoryWriteNotice,
  now: number,
): { readonly text: string; readonly tone: "warning" | "dim" } | undefined {
  const timeline = notice.timeline
  const entryAge = relativeAge(timeline.previousEntryAtISO, now)
  const consolidationAge = relativeAge(timeline.lastConsolidationAtISO, now)
  const steps = timeline.unreflectedSteps
  const text = joinFields([
    entryAge === undefined ? undefined : `last entry ${entryAge}`,
    consolidationAge === undefined ? undefined : `last consolidation ${consolidationAge}`,
    steps === undefined ? undefined : `${steps} step${steps === 1 ? "" : "s"} unreflected`,
  ])
  if (text.length === 0) return undefined
  const stale = isStaleConsolidation(timeline.lastConsolidationAtISO, now)
  const backlogged = steps !== undefined && steps >= UNREFLECTED_WARN_STEPS
  return { text, tone: stale || backlogged ? "warning" : "dim" }
}

function isStaleConsolidation(iso: string | undefined, now: number): boolean {
  if (iso === undefined) return false
  const at = Date.parse(iso)
  return Number.isFinite(at) && now - at >= STALE_CONSOLIDATION_MS
}

function relativeAge(iso: string | undefined, now: number): string | undefined {
  if (iso === undefined) return undefined
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return undefined
  return formatRelativeAge(at, now) ?? undefined
}

/** One decimal below 10K ("2.0K"), integer above ("33K"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0K"
  const kilobytes = bytes / 1_024
  return bytes < DECIMAL_KB_LIMIT ? `${kilobytes.toFixed(1)}K` : `${Math.round(kilobytes)}K`
}

export function shortSha(sha: string): string | undefined {
  const normalized = normalizeRendererText(sha).slice(0, 7)
  return normalized.length === 0 ? undefined : normalized
}

function optional(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const normalized = normalizeRendererText(value)
  return normalized.length === 0 ? undefined : normalized
}
