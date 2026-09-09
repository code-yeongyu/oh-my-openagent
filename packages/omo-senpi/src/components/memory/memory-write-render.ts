// Shared call/result frame for memory writes.
//
// The model still receives the plain "Memory <command> committed locally (<sha7>)." string; this
// module only replaces what the HUMAN sees with the house notice contract (buildNoticeBox, the
// same shape senpi's cache-warm notice uses): a bold accent title, a dim prose "why", visible
// quantitative extra lines carrying their own tone, and a dim expanded-only detail line.
//
// Every field of the payload is optional because gathering is best-effort: a missing field drops
// its own fragment, and a wholly missing payload (gate off, error result, degraded gather) falls
// back to the plain message so the row never renders emptier than it did before.

import type { AgentToolResult, Theme, ToolDefinition } from "@code-yeongyu/senpi"
import { Box, Text } from "@earendil-works/pi-tui"
import { buildNoticeBox, type NoticeSpec } from "@oh-my-opencode/senpi-task/notice-box"
import { normalizeRendererText } from "@oh-my-opencode/senpi-task/renderer-text"
import { linesComponent } from "@oh-my-opencode/senpi-task/task-renderers"
import type { Static } from "typebox"

import { formatRelativeAge } from "./status"
import { MEMORY_TOOL_NAME } from "./tool-metadata"
import type { MemoryToolParams, MemoryToolResultDetails, MemoryWriteNotice } from "./tools"
import { joinFields, type EntryRenderTheme } from "./worker/entry-renderers"

/** A consolidation older than this reads as neglect, not cadence. */
const STALE_CONSOLIDATION_MS = 7 * 24 * 60 * 60 * 1_000
/** Matches the default reflection step trigger: at this backlog a reflection is overdue. */
const UNREFLECTED_WARN_STEPS = 25
/** Below this many bytes a one-decimal K reads as precision; above it the decimal is noise. */
const DECIMAL_KB_LIMIT = 10 * 1_024

type RenderComponent = { render(width: number): string[]; invalidate(): void }

export interface MemoryWriteRenderDeps {
  /** memory.write_notice.enabled for the active identity; false renders the plain message. */
  readonly enabled: () => boolean
  /** Injectable clock so age fragments are deterministic under test. */
  readonly now?: () => number
}

type MemoryRenderArgs = Partial<Static<typeof MemoryToolParams>>
type MemoryRenderContext = Parameters<NonNullable<ToolDefinition<
  typeof MemoryToolParams, MemoryToolResultDetails, { callComponent?: Box }
>["renderCall"]>>[2]

function getMemoryCallComponent(context: MemoryRenderContext): Box {
  const component = context.lastComponent instanceof Box
    ? context.lastComponent
    : context.state.callComponent ?? new Box(1, 1)
  context.state.callComponent = component
  return component
}

function buildMemoryCall(component: Box, args: MemoryRenderArgs, theme: Theme): void {
  const argument = args.file_path ?? args.old_path ?? args.new_path ?? args.reason
  const summary = [args.command, argument].filter((part) => typeof part === "string").join(" ")
  // pi-tui 0.84's clear() detaches children without disposing them (Senpi calls it detachAll()).
  component.clear()
  component.addChild(new Text(`${theme.bold(MEMORY_TOOL_NAME)} ${normalizeRendererText(summary)}`.trimEnd(), 0, 0))
}

export function renderMemoryWriteCall(args: MemoryRenderArgs, theme: Theme, context: MemoryRenderContext): RenderComponent {
  const component = getMemoryCallComponent(context)
  if (!context.hasResult) component.setBgFn((text) => theme.bg("toolPendingBg", text))
  buildMemoryCall(component, args, theme)
  // Senpi mounts the call and result slots separately; only the result slot may mount this Box.
  return context.hasResult ? linesComponent([]) : component
}

/** Builds the memory tool's result renderer, completing its shared call frame. */
export function createMemoryWriteRenderResult(
  deps: MemoryWriteRenderDeps,
): (
  result: AgentToolResult<MemoryToolResultDetails>,
  options: { readonly expanded: boolean; readonly isPartial: boolean },
  theme: Theme,
  context: MemoryRenderContext | { readonly isError?: boolean },
) => RenderComponent {
  return (result, options, theme, context) => {
    const notice = context.isError || !deps.enabled() ? undefined : result.details?.writeNotice
    // Result-only consumers have no call frame; preserve the standalone callback contract.
    if (!("state" in context)) {
      return notice === undefined
        ? linesComponent(normalizeRendererText(resultText(result)).split("\n"))
        : renderMemoryWriteNotice(notice, options, theme, (deps.now ?? Date.now)())
    }
    const component = getMemoryCallComponent(context)
    buildMemoryCall(component, context.args, theme)
    if (notice === undefined) {
      component.setBgFn((text) => theme.bg(context.isError ? "toolErrorBg" : "toolSuccessBg", text))
      component.addChild(new Text(resultText(result).split("\n").map(normalizeRendererText).join("\n"), 0, 0))
      return component
    }
    component.setBgFn((text) => theme.bg("customMessageBg", text))
    const spec = memoryWriteNoticeSpec(notice, (deps.now ?? Date.now)())
    component.addChild(new Text(theme.fg(spec.tone ?? "accent", `\u001b[1m${spec.title}\u001b[22m`), 0, 0))
    component.addChild(new Text(theme.fg("dim", spec.why), 0, 0))
    for (const line of spec.extra ?? []) {
      component.addChild(new Text(theme.fg(line.tone ?? "dim", line.text), 0, 0))
    }
    if (options.expanded && spec.expandedLine !== undefined) {
      component.addChild(new Text(theme.fg("dim", spec.expandedLine), 0, 0))
    }
    return component
  }
}

function resultText(result: AgentToolResult<MemoryToolResultDetails>): string {
  const message = result.details?.message
  if (typeof message === "string" && message.length > 0) return message
  for (const part of result.content) {
    if (part.type === "text" && typeof part.text === "string" && part.text.length > 0) return part.text
  }
  return ""
}

/**
 * Standalone notice frame for the MCP surface's `omo-memory:write-updated` transcript entry.
 * Its content matches the tool notice, without the tool's call line.
 */
export function renderMemoryWriteNotice(
  notice: MemoryWriteNotice,
  options: { readonly expanded: boolean },
  theme: EntryRenderTheme,
  now: number,
): RenderComponent {
  return buildNoticeBox(memoryWriteNoticeSpec(notice, now), options, theme)
}

function memoryWriteNoticeSpec(notice: MemoryWriteNotice, now: number): NoticeSpec {
  const size = sizeLine(notice)
  const timeline = timelineLine(notice, now)
  const detail = joinFields([shortSha(notice.sha), optional(notice.identity), optional(notice.subject)])
  return {
    title: `● ${titleLine(notice)}`,
    tone: "accent",
    why: whyLine(notice),
    extra: [
      ...(size === undefined ? [] : [{ text: size, tone: "dim" as const }]),
      ...(timeline === undefined ? [] : [timeline]),
    ],
    ...(detail.length === 0 ? {} : { expandedLine: detail }),
  }
}

/** "Memory updated · 4th entry today"; the count drops out when the commit walk failed. */
function titleLine(notice: MemoryWriteNotice): string {
  const entries = notice.timeline.entriesToday
  if (entries === undefined || !Number.isFinite(entries) || entries <= 0) return "Memory updated"
  return joinFields(["Memory updated", `${ordinal(Math.floor(entries))} entry today`])
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
 * One full sentence. A single file whose change is pure insertion reads as growth ("Added 47
 * lines"); anything else reads as an update listing the touched paths.
 */
function whyLine(notice: MemoryWriteNotice): string {
  const affected = notice.affected
  if (affected.length === 0) return "Memory was updated."
  const only = affected[0]
  if (affected.length === 1 && only !== undefined && only.deletions === 0 && only.insertions > 0) {
    return `Added ${only.insertions} line${only.insertions === 1 ? "" : "s"} to ${normalizeRendererText(only.path)}.`
  }
  const paths = affected.map((entry) => normalizeRendererText(entry.path)).join(", ")
  return `Updated ${affected.length} memory file${affected.length === 1 ? "" : "s"} (${paths}).`
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

function shortSha(sha: string): string | undefined {
  const normalized = normalizeRendererText(sha).slice(0, 7)
  return normalized.length === 0 ? undefined : normalized
}

function optional(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const normalized = normalizeRendererText(value)
  return normalized.length === 0 ? undefined : normalized
}
