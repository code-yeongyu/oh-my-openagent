// Frame tests for the memory tool row: which Box owns the pending line, the settled notice, and the
// gate-off plain message. Notice wording lives in memory-notice-spec.test.ts. Expectations are
// LITERAL strings so a corrupted helper cannot keep them green.
import { describe, expect, test } from "bun:test"

import type { Theme, ThemeColor, ToolDefinition } from "@code-yeongyu/senpi"
import { Box, Container, Text } from "@earendil-works/pi-tui"

import { createMemoryWriteRenderResult, renderMemoryWriteNotice } from "./memory-write-render"
import { createMemoryTools, MEMORY_TOOL_NAME, type MemoryToolExecutionResult, type MemoryToolParams, type MemoryToolResultDetails, type MemoryWriteNotice } from "./tools"

const BOLD = "\u001b[1m"
const BOLD_OFF = "\u001b[22m"
function bold(text: string): string {
  return `${BOLD}${text}${BOLD_OFF}`
}

const PLAIN_THEME = {
  fg: (_color: ThemeColor, text: string) => text,
  bg: (_color: "customMessageBg", text: string) => text,
}

const WIDE = 200
const NOW = Date.parse("2026-08-19T12:00:00.000Z")

const MESSAGE = "Memory str_replace committed locally (a1b2c3d)."

function notice(over: Partial<MemoryWriteNotice> = {}): MemoryWriteNotice {
  return {
    sha: "a1b2c3d4e5f6a7b8",
    subject: "Track the deploy runbook",
    identity: "project-a1b2c3d4",
    affected: [{ path: "knowledge/deploy.md", insertions: 47, deletions: 0 }],
    size: { systemBytes: 2048, totalBytes: 33_792, fileCount: 12 },
    timeline: {
      entriesToday: 4,
      previousEntryAtISO: "2026-08-19T11:55:00.000Z",
      lastConsolidationAtISO: "2026-08-13T12:00:00.000Z",
      unreflectedSteps: 3,
    },
    ...over,
  }
}

function render(
  details: MemoryToolResultDetails | undefined,
  options: {
    readonly expanded?: boolean
    readonly isError?: boolean
    readonly enabled?: boolean
    readonly theme?: unknown
  } = {},
): string[] {
  const renderResult = createMemoryWriteRenderResult({ enabled: () => options.enabled ?? true, now: () => NOW })
  const component = renderResult(
    { content: [{ type: "text", text: details?.message ?? MESSAGE }], details } as never,
    { expanded: options.expanded ?? false, isPartial: false },
    { bold, ...(options.theme ?? PLAIN_THEME) as object } as Theme,
    { ...callContext(), isError: options.isError ?? false, hasResult: true },
  )
  const lines = (component as { render(width: number): string[] }).render(WIDE)
  // Strip the Box's one-line top/bottom padding and one-column left padding.
  return lines.slice(1, -1).map((line) => line.slice(1).trimEnd())
}

const CALL_ARGS = { command: "str_replace" as const, reason: "Track deploy", file_path: "knowledge/deploy.md" }
const FRAME_THEME = {
  ...PLAIN_THEME,
  bold,
  bg: (color: string, text: string) => `<${color}>${text}</${color}>`,
} as Theme

function callContext(): Parameters<NonNullable<ToolDefinition<
  typeof MemoryToolParams, MemoryToolResultDetails, { callComponent?: Box }
>["renderCall"]>>[2] {
  return {
    args: CALL_ARGS, toolCallId: "memory-frame", state: {}, lastComponent: undefined,
    cwd: "/tmp", executionStarted: true, argsComplete: true, isPartial: false,
    expanded: false, showImages: false, isError: false, hasResult: false,
    invalidate() {},
  }
}

function framedTool(enabled = true) {
  const [tool] = createMemoryTools(() => undefined, { writeNotice: { enabled } })
  const renderCall = tool.renderCall
  const renderResult = tool.renderResult
  if (renderCall === undefined || renderResult === undefined) throw new Error("memory call/result renderers missing")
  return { renderCall, renderResult }
}

function assertBackground(lines: string[], color: string): void {
  expect(lines.length).toBeGreaterThan(2)
  for (const line of lines) {
    expect(line.startsWith(`<${color}>`)).toBe(true)
    expect(line.endsWith(`</${color}>`)).toBe(true)
    for (const other of ["toolPendingBg", "toolErrorBg", "customMessageBg", "toolSuccessBg"]) {
      expect(line.split(`<${other}>`).length - 1).toBe(other === color ? 1 : 0)
    }
  }
}

function frameResult(writeNotice?: MemoryWriteNotice): MemoryToolExecutionResult {
  return { content: [{ type: "text", text: MESSAGE }], details: { message: MESSAGE, writeNotice } }
}

describe("memory tool row framing", () => {
  test("#when pending #then one padded Box owns a single remembering line on the pending background", () => {
    const { renderCall } = framedTool()
    const context = callContext()
    const component = renderCall(CALL_ARGS, FRAME_THEME, context)
    expect(component).toBeInstanceOf(Box)
    expect(context.state.callComponent === component).toBe(true)
    const lines = component.render(WIDE)
    assertBackground(lines, "toolPendingBg")
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain("◌ Remembering · knowledge/deploy.md")
    expect(lines[1]).not.toContain(MEMORY_TOOL_NAME)
  })

  test("#when a result errors #then the same Box turns into a calm not-remembered notice", () => {
    const { renderCall, renderResult } = framedTool()
    const context = callContext()
    const call = renderCall(CALL_ARGS, FRAME_THEME, context)
    context.isError = true
    context.hasResult = true
    const message = "memory: create: block already exists at knowledge/deploy.md"
    const result = { content: [{ type: "text" as const, text: message }], details: { message }, isError: true }
    const component = renderResult(result, { expanded: false, isPartial: false }, FRAME_THEME, context)
    expect(component).toBe(call)
    const lines = component.render(WIDE)
    assertBackground(lines, "customMessageBg")
    expect(lines).toHaveLength(4)
    expect(lines[1]).toContain(bold("○ Not remembered"))
    expect(lines[2]).toContain("knowledge/deploy.md already exists.")
    expect(lines.join("\n")).not.toContain("memory: create:")
  })

  test.each([false, true])("#when a notice is enabled (expanded=%s) #then the settled row is exactly the notice", (expanded) => {
    const { renderCall } = framedTool()
    const renderResult = createMemoryWriteRenderResult({ enabled: () => true, now: () => NOW })
    const context = callContext()
    const call = renderCall(CALL_ARGS, FRAME_THEME, context)
    context.hasResult = true
    const payload = notice()
    const component = renderResult(frameResult(payload), { expanded, isPartial: false }, FRAME_THEME, context)
    expect(component).toBe(call)
    const lines = component.render(WIDE)
    assertBackground(lines, "customMessageBg")
    expect(lines).toEqual(renderMemoryWriteNotice(payload, { expanded }, FRAME_THEME, NOW).render(WIDE))
    expect((component as Box).children.every((child) => child instanceof Text)).toBe(true)
  })

  test("#when a write committed but its facts could not be gathered #then the row is a statless remembered notice", () => {
    const { renderCall, renderResult } = framedTool()
    const context = callContext()
    renderCall(CALL_ARGS, FRAME_THEME, context)
    context.hasResult = true
    const lines = renderResult(frameResult(), { expanded: false, isPartial: false }, FRAME_THEME, context).render(WIDE)
    assertBackground(lines, "customMessageBg")
    expect(lines).toHaveLength(4)
    expect(lines[1]).toContain(bold("● Remembered"))
    expect(lines[2]).toContain("Saved knowledge/deploy.md.")
  })

  test("#when the notice gate is off #then the same Box keeps the plain call line and success message", () => {
    const { renderCall, renderResult } = framedTool(false)
    const context = callContext()
    const call = renderCall(CALL_ARGS, FRAME_THEME, context)
    context.hasResult = true
    const component = renderResult(frameResult(notice()), { expanded: false, isPartial: false }, FRAME_THEME, context)
    expect(component).toBe(call)
    const lines = component.render(WIDE)
    assertBackground(lines, "toolSuccessBg")
    expect(lines[1]).toContain(`${bold(MEMORY_TOOL_NAME)} ${CALL_ARGS.command} ${CALL_ARGS.file_path}`)
    expect(lines[2]).toContain(MESSAGE)
  })

  test("#when Senpi mounts both slots on redraw #then the call yields and the result appears exactly once", () => {
    const { renderCall, renderResult } = framedTool()
    const context = callContext()
    const original = renderCall(CALL_ARGS, FRAME_THEME, context)
    context.lastComponent = original
    context.hasResult = true
    const callSlot = renderCall(CALL_ARGS, FRAME_THEME, context)
    expect(callSlot.render(WIDE)).toEqual([])
    context.lastComponent = undefined
    const resultSlot = renderResult(frameResult(notice()), { expanded: false, isPartial: false }, FRAME_THEME, context)
    expect(resultSlot).toBe(original)
    const surface = new Container()
    surface.addChild(callSlot)
    surface.addChild(resultSlot)
    const lines = surface.render(WIDE)
    expect(lines.join("\n").split("Remembered")).toHaveLength(2)
    context.lastComponent = resultSlot
    renderResult(frameResult(notice()), { expanded: false, isPartial: false }, FRAME_THEME, context)
    expect(surface.render(WIDE)).toEqual(lines)
  })

  test("#when redrawn with a previous Box #then it is reused without leaking between calls", () => {
    const { renderCall } = framedTool()
    const context = callContext()
    const prior = new Box(1, 1)
    prior.addChild(new Text("stale", 0, 0))
    context.lastComponent = prior
    expect(renderCall(CALL_ARGS, FRAME_THEME, context)).toBe(prior)
    expect(context.state.callComponent).toBe(prior)
    expect(prior.children).toHaveLength(1)
    context.lastComponent = undefined
    expect(renderCall(CALL_ARGS, FRAME_THEME, context)).toBe(prior)
    expect(renderCall(CALL_ARGS, FRAME_THEME, callContext())).not.toBe(prior)
  })

  test("#when a rename streams multiline arguments #then its old path stays on one pending line", () => {
    const { renderCall } = framedTool()
    const component = renderCall({ command: "rename", reason: "rename", old_path: "knowledge/old\nname.md" }, FRAME_THEME, callContext())
    expect(component.render(WIDE)).toHaveLength(3)
    expect(component.render(WIDE)[1]).toContain("◌ Moving · knowledge/old name.md")
  })
})

describe("memory tool result rendering", () => {
  test("#when rendered with a background theme #then every padded line carries customMessageBg", () => {
    const renderResult = createMemoryWriteRenderResult({ enabled: () => true, now: () => NOW })
    const component = renderResult(frameResult(notice()), { expanded: false, isPartial: false }, {
      bold,
      fg: (_color: ThemeColor, text: string) => text,
      bg: (_color: "customMessageBg", text: string) => `<notice-bg>${text}</notice-bg>`,
    } as unknown as Theme, { isError: false })
    for (const line of component.render(WIDE)) expect(line).toMatch(/^<notice-bg>.*<\/notice-bg>$/u)
  })

  test("#when a write settles #then the row reads as a dated remembered entry with no command jargon", () => {
    const lines = render({ message: MESSAGE, writeNotice: notice() })
    expect(lines).toEqual([
      bold("● Remembered · 4th entry today"),
      "Added 47 lines to knowledge/deploy.md.",
      "system 2.0K injected · 33K total · 12 files",
      "last entry 5m ago · last consolidation 6d ago · 3 steps unreflected",
    ])
    const output = lines.join("\n")
    expect(output).not.toContain("committed locally")
    for (const command of ["str_replace", "create", "insert", "delete", "rename", "update_description"]) {
      expect(output).not.toContain(command)
    }
  })

  test("#when it renders expanded #then the detail row carries sha7, identity and subject", () => {
    expect(render({ message: MESSAGE, writeNotice: notice() }, { expanded: true })[4])
      .toBe("a1b2c3d · project-a1b2c3d4 · Track the deploy runbook")
  })

  test("#when the gate is off #then the plain call line and tool message are rendered verbatim", () => {
    expect(render({ message: MESSAGE, writeNotice: notice() }, { enabled: false })).toEqual([
      `${bold(MEMORY_TOOL_NAME)} ${CALL_ARGS.command} ${CALL_ARGS.file_path}`,
      MESSAGE,
    ])
  })

  test("#when a refused write is expanded #then the raw engine message stays available on the detail row", () => {
    const message = "memory: str_replace: old_string was not found in the target memory block"
    expect(render({ message }, { isError: true, expanded: true })).toEqual([
      bold("○ Not remembered"),
      "The text to replace was not in that memory.",
      message,
    ])
  })

  test("#when a result-only consumer renders with the gate off #then the tool text content is rendered", () => {
    const renderResult = createMemoryWriteRenderResult({ enabled: () => false })
    const component = renderResult({ content: [{ type: "text", text: MESSAGE }] } as never, { expanded: false, isPartial: false }, { bold, ...PLAIN_THEME } as unknown as Theme, { isError: false })
    expect(component.render(WIDE)).toEqual([MESSAGE])
  })
})
