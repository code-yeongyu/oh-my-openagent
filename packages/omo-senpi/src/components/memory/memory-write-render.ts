// Shared call/result frame for memory writes.
//
// The model still receives the plain "Memory <command> committed locally (<sha7>)." string; this
// module only replaces what the HUMAN sees with the memory notice family from memory-notice-spec.ts
// (the house buildNoticeBox contract): while the call runs a single "Remembering <path>" line, and
// once it settles one notice - "Remembered", "Let go", or a calm "Not remembered" for a refusal.
//
// Every field of the payload is optional because gathering is best-effort: a missing field drops
// its own fragment, and a wholly missing payload degrades to a statless notice. With the write
// notice gate off the row keeps the plain call line and message.

import type { AgentToolResult, Theme, ToolDefinition } from "@code-yeongyu/senpi"
import { Box, Text } from "@earendil-works/pi-tui"
import { buildNoticeBox, type NoticeSpec } from "@oh-my-opencode/senpi-task/notice-box"
import { normalizeRendererText } from "@oh-my-opencode/senpi-task/renderer-text"
import { linesComponent } from "@oh-my-opencode/senpi-task/task-renderers"
import type { Static } from "typebox"

import {
  memoryDegradedNoticeSpec,
  memoryFailureNoticeSpec,
  memoryPendingLine,
  memoryWriteNoticeSpec,
  type MemoryNoticeArgs,
} from "./memory-notice-spec"
import { MEMORY_TOOL_NAME } from "./tool-metadata"
import type { MemoryToolParams, MemoryToolResultDetails, MemoryWriteNotice } from "./tools"
import type { EntryRenderTheme } from "./worker/entry-renderers"

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
  if (!context.hasResult) {
    component.setBgFn((text) => theme.bg("toolPendingBg", text))
    component.clear()
    component.addChild(new Text(theme.fg("dim", memoryPendingLine(args)), 0, 0))
  }
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
    const args: MemoryNoticeArgs = "args" in context ? context.args : {}
    const spec = deps.enabled() ? resultNoticeSpec(result, context.isError === true, args, (deps.now ?? Date.now)()) : undefined
    // Result-only consumers have no call frame; preserve the standalone callback contract.
    if (!("state" in context)) {
      return spec === undefined
        ? linesComponent(normalizeRendererText(resultText(result)).split("\n"))
        : buildNoticeBox(spec, options, theme)
    }
    const component = getMemoryCallComponent(context)
    if (spec === undefined) {
      buildMemoryCall(component, context.args, theme)
      component.setBgFn((text) => theme.bg(context.isError ? "toolErrorBg" : "toolSuccessBg", text))
      component.addChild(new Text(resultText(result).split("\n").map(normalizeRendererText).join("\n"), 0, 0))
      return component
    }
    component.clear()
    component.setBgFn((text) => theme.bg("customMessageBg", text))
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

function resultNoticeSpec(
  result: AgentToolResult<MemoryToolResultDetails>,
  isError: boolean,
  args: MemoryNoticeArgs,
  now: number,
): NoticeSpec {
  if (isError) return memoryFailureNoticeSpec(resultText(result), args)
  const notice = result.details?.writeNotice
  return notice === undefined ? memoryDegradedNoticeSpec(args) : memoryWriteNoticeSpec(notice, now, args)
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
