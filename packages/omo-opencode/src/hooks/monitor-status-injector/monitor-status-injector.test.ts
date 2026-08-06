import { describe, expect, it } from "bun:test"

import type {
  MonitorId,
  MonitorManager,
  MonitorManagerEvent,
  MonitorMode,
  MonitorOutputQuery,
  MonitorOutputResult,
  MonitorRecord,
  MonitorStartOpts,
  MonitorStatus,
} from "../../features/monitor/types"
import { createMonitorStatusInjectorHook } from "."

type TransformOutput = {
  messages: Array<{
    info: { role: string; sessionID: string }
    parts: Array<{ type: string; text?: string; synthetic?: boolean }>
  }>
}

function createCounters(matchedLines: number): MonitorRecord["counters"] {
  return {
    totalLines: matchedLines,
    matchedLines,
    unmatchedLines: 0,
    droppedMatched: 0,
    droppedUnmatched: 0,
    bytesDropped: 0,
    lastSequence: matchedLines,
  }
}

function createRecord(args: {
  id: MonitorId
  command: string
  label: string
  status: MonitorStatus
  matchedLines: number
  parentSessionId?: string
  mode?: MonitorMode
}): MonitorRecord {
  return {
    id: args.id,
    command: args.command,
    label: args.label,
    mode: args.mode ?? "idle",
    parentSessionId: args.parentSessionId ?? "ses_monitor",
    startedAt: new Date("2026-06-15T00:00:00.000Z"),
    status: args.status,
    counters: createCounters(args.matchedLines),
  }
}

function createFakeManager(records: MonitorRecord[]): MonitorManager {
  return {
    start: async (opts: MonitorStartOpts) =>
      createRecord({
        id: "mon_started",
        command: opts.command,
        label: opts.label ?? opts.command,
        status: "running",
        matchedLines: 0,
        parentSessionId: opts.parentSessionId,
      }),
    stop: async (_id: MonitorId) => {},
    list: (sessionId: string) => records.filter((record) => record.parentSessionId === sessionId),
    get: (id: MonitorId) => records.find((record) => record.id === id),
    getOutput: (_id: MonitorId, _opts: MonitorOutputQuery): MonitorOutputResult => ({
      lines: [],
      counters: createCounters(0),
    }),
    stopSessionMonitors: async (_sessionId: string) => {},
    handleEvent: (_event: MonitorManagerEvent) => {},
    shutdown: async () => {},
  }
}

function createOutput(sessionID = "ses_monitor"): TransformOutput {
  return {
    messages: [
      {
        info: { role: "user", sessionID },
        parts: [{ type: "text", text: "continue" }],
      },
    ],
  }
}

function getInjectedText(output: TransformOutput): string {
  const injectedPart = output.messages
    .flatMap((message) => message.parts)
    .find((part) => part.synthetic === true && part.text?.startsWith("Active monitors:"))

  expect(injectedPart?.text).toBeString()
  return injectedPart?.text ?? ""
}

describe("createMonitorStatusInjectorHook", () => {
  it("#given two active monitors #when messages transform runs #then both statuses and stop hint are injected", async () => {
    // given
    const manager = createFakeManager([
      createRecord({
        id: "mon_ab12",
        command: "bun test --watch --raw-secret",
        label: "bun test",
        status: "running",
        matchedLines: 3,
      }),
      createRecord({
        id: "mon_cd34",
        command: "tail -f /tmp/private.log",
        label: "tail -f",
        status: "starting",
        matchedLines: 0,
      }),
      createRecord({
        id: "mon_done",
        command: "ignored raw command",
        label: "ignored label",
        status: "stopped",
        matchedLines: 8,
      }),
    ])
    const hook = createMonitorStatusInjectorHook(manager, { enabled: true })
    const output = createOutput()

    // when
    await hook["experimental.chat.messages.transform"]?.({ sessionID: "ses_monitor" }, output)

    // then
    const injectedText = getInjectedText(output)
    expect(output.messages).toHaveLength(2)
    expect(injectedText).toContain("mon_ab12")
    expect(injectedText).toContain("bun test")
    expect(injectedText).toContain("running")
    expect(injectedText).toContain("3 matched")
    expect(injectedText).toContain("mon_cd34")
    expect(injectedText).toContain("tail -f")
    expect(injectedText).toContain("starting")
    expect(injectedText).toContain("0 matched")
    expect(injectedText).toContain("monitor_stop")
    expect(injectedText).not.toContain("mon_done")
  })

  it("#given no active monitors #when messages transform runs #then output is unchanged", async () => {
    // given
    const manager = createFakeManager([
      createRecord({
        id: "mon_stopped",
        command: "bun test --watch",
        label: "bun test",
        status: "stopped",
        matchedLines: 0,
      }),
    ])
    const hook = createMonitorStatusInjectorHook(manager, { enabled: true })
    const output = createOutput()
    const originalOutput = structuredClone(output)

    // when
    await hook["experimental.chat.messages.transform"]?.({ sessionID: "ses_monitor" }, output)

    // then
    expect(output).toEqual(originalOutput)
  })

  it("#given disabled config with active monitors #when messages transform runs #then output is unchanged", async () => {
    // given
    const manager = createFakeManager([
      createRecord({
        id: "mon_active",
        command: "bun test --watch",
        label: "bun test",
        status: "running",
        matchedLines: 1,
      }),
    ])
    const hook = createMonitorStatusInjectorHook(manager, { enabled: false })
    const output = createOutput()
    const originalOutput = structuredClone(output)

    // when
    await hook["experimental.chat.messages.transform"]?.({ sessionID: "ses_monitor" }, output)

    // then
    expect(output).toEqual(originalOutput)
  })

  it("#given raw command differs from label #when status is injected #then label is shown and command is hidden", async () => {
    // given
    const manager = createFakeManager([
      createRecord({
        id: "mon_label",
        command: "bun test --token super-secret-value",
        label: "safe test label",
        status: "running",
        matchedLines: 2,
      }),
    ])
    const hook = createMonitorStatusInjectorHook(manager, { enabled: true })
    const output = createOutput()

    // when
    await hook["experimental.chat.messages.transform"]?.({ sessionID: "ses_monitor" }, output)

    // then
    const injectedText = getInjectedText(output)
    expect(injectedText).toContain("safe test label")
    expect(injectedText).not.toContain("super-secret-value")
    expect(injectedText).not.toContain("--token")
  })

  it("#given status already injected #when messages transform runs again #then status line does not stack", async () => {
    // given
    const manager = createFakeManager([
      createRecord({
        id: "mon_once",
        command: "bun test --watch",
        label: "bun test",
        status: "running",
        matchedLines: 4,
      }),
    ])
    const hook = createMonitorStatusInjectorHook(manager, { enabled: true })
    const output = createOutput()

    // when
    await hook["experimental.chat.messages.transform"]?.({ sessionID: "ses_monitor" }, output)
    await hook["experimental.chat.messages.transform"]?.({ sessionID: "ses_monitor" }, output)

    // then
    const injectedMessages = output.messages.filter((message) =>
      message.parts.some((part) => part.synthetic === true && part.text?.startsWith("Active monitors:")),
    )
    expect(output.messages).toHaveLength(2)
    expect(injectedMessages).toHaveLength(1)
  })
})
