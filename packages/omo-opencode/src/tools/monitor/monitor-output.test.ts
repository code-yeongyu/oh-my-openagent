import { describe, expect, test } from "bun:test"
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool"
import type {
  MonitorCounters,
  MonitorManager,
  MonitorManagerEvent,
  MonitorOutputQuery,
  MonitorOutputResult,
  MonitorRecord,
  MonitorStartOpts,
  OutputLine,
} from "../../features/monitor/types"
import { createMonitorOutput } from "./monitor-output"

const CALLING_SESSION_ID = "ses_monitor_owner"
const OTHER_SESSION_ID = "ses_monitor_other"
const TEST_DIRECTORY = "/tmp/monitor-output-test"

const BASE_COUNTERS: MonitorCounters = {
  totalLines: 7,
  matchedLines: 3,
  unmatchedLines: 4,
  droppedMatched: 1,
  droppedUnmatched: 2,
  bytesDropped: 19,
  lastSequence: 9,
}

type GetOutputCall = {
  id: string
  opts: MonitorOutputQuery
}

type MonitorOutputToolResult = MonitorOutputResult & {
  error?: "not_found"
}

function createToolContext(sessionID = CALLING_SESSION_ID): ToolContext {
  return {
    sessionID,
    messageID: "msg_monitor_output",
    agent: "sisyphus",
    directory: TEST_DIRECTORY,
    worktree: TEST_DIRECTORY,
    abort: new AbortController().signal,
    metadata: (_input: { title?: string; metadata?: Record<string, unknown> }) => {},
    ask: (_input: { permission: string; patterns: string[]; always: string[]; metadata: Record<string, unknown> }) =>
      Promise.resolve(),
  }
}

function parseMonitorOutput(result: ToolResult): MonitorOutputToolResult {
  const rawOutput = typeof result === "string" ? result : result.output
  return JSON.parse(rawOutput) as MonitorOutputToolResult
}

function createLine(seq: number, text: string): OutputLine {
  return { stream: "stdout", seq, text }
}

function createRecord(id: string, parentSessionId = CALLING_SESSION_ID): MonitorRecord {
  return {
    id,
    command: "bun test",
    label: "tests",
    mode: "idle",
    parentSessionId,
    startedAt: new Date("2026-06-15T00:00:00.000Z"),
    status: "running",
    counters: BASE_COUNTERS,
  }
}

function createFakeManager(records: MonitorRecord[], lines: OutputLine[]): MonitorManager & { calls: GetOutputCall[] } {
  const calls: GetOutputCall[] = []

  return {
    calls,
    start: (_opts: MonitorStartOpts) => Promise.resolve(records[0] ?? createRecord("mon_created")),
    stop: (_id: string) => Promise.resolve(),
    list: (sessionId: string) => records.filter((record) => record.parentSessionId === sessionId),
    get: (id: string) => records.find((record) => record.id === id),
    getOutput: (id: string, opts: MonitorOutputQuery): MonitorOutputResult => {
      calls.push({ id, opts })
      const stream = opts.stream ?? "all"
      const streamFilteredLines = stream === "all" ? lines : lines.filter((line) => line.text.startsWith(stream))
      const sinceSequence = opts.since_sequence
      const sinceFilteredLines =
        sinceSequence === undefined ? streamFilteredLines : streamFilteredLines.filter((line) => line.seq > sinceSequence)
      const limitedLines = opts.limit === undefined ? sinceFilteredLines : sinceFilteredLines.slice(-opts.limit)

      return {
        lines: limitedLines,
        counters: BASE_COUNTERS,
      }
    },
    stopSessionMonitors: (_sessionId: string) => Promise.resolve(),
    handleEvent: (_event: MonitorManagerEvent) => {},
    shutdown: () => Promise.resolve(),
  }
}

describe("monitor_output tool", () => {
  test("returns only unmatched lines when stream is unmatched", async () => {
    //#given
    const manager = createFakeManager([createRecord("mon_1")], [
      createLine(1, "matched: boot"),
      createLine(2, "unmatched: warning"),
      createLine(3, "matched: done"),
      createLine(4, "unmatched: trace"),
    ])
    const monitorOutput = createMonitorOutput(manager)

    //#when
    const result = parseMonitorOutput(
      await monitorOutput.execute({ monitor_id: "mon_1", stream: "unmatched" }, createToolContext())
    )

    //#then
    expect(result.lines.map((line) => line.text)).toEqual(["unmatched: warning", "unmatched: trace"])
    expect(manager.calls).toEqual([{ id: "mon_1", opts: { stream: "unmatched" } }])
  })

  test("returns only lines newer than since_sequence", async () => {
    //#given
    const manager = createFakeManager([createRecord("mon_2")], [
      createLine(4, "unmatched: old"),
      createLine(5, "matched: boundary"),
      createLine(6, "unmatched: new"),
      createLine(7, "matched: latest"),
    ])
    const monitorOutput = createMonitorOutput(manager)

    //#when
    const result = parseMonitorOutput(
      await monitorOutput.execute({ monitor_id: "mon_2", since_sequence: 5 }, createToolContext())
    )

    //#then
    expect(result.lines.map((line) => line.seq)).toEqual([6, 7])
    expect(manager.calls).toEqual([{ id: "mon_2", opts: { stream: "all", since_sequence: 5 } }])
  })

  test("caps returned lines with limit", async () => {
    //#given
    const manager = createFakeManager([createRecord("mon_3")], [
      createLine(1, "unmatched: one"),
      createLine(2, "unmatched: two"),
      createLine(3, "unmatched: three"),
      createLine(4, "unmatched: four"),
      createLine(5, "unmatched: five"),
    ])
    const monitorOutput = createMonitorOutput(manager)

    //#when
    const result = parseMonitorOutput(await monitorOutput.execute({ monitor_id: "mon_3", limit: 3 }, createToolContext()))

    //#then
    expect(result.lines.map((line) => line.seq)).toEqual([3, 4, 5])
    expect(manager.calls).toEqual([{ id: "mon_3", opts: { stream: "all", limit: 3 } }])
  })

  test("returns counters with the output lines", async () => {
    //#given
    const manager = createFakeManager([createRecord("mon_4")], [createLine(9, "matched: final")])
    const monitorOutput = createMonitorOutput(manager)

    //#when
    const result = parseMonitorOutput(await monitorOutput.execute({ monitor_id: "mon_4" }, createToolContext()))

    //#then
    expect(result.lines).toEqual([createLine(9, "matched: final")])
    expect(result.counters).toEqual({
      totalLines: 7,
      matchedLines: 3,
      unmatchedLines: 4,
      droppedMatched: 1,
      droppedUnmatched: 2,
      bytesDropped: 19,
      lastSequence: 9,
    })
  })

  test("returns a clean not-found object for an unknown monitor_id", async () => {
    //#given
    const manager = createFakeManager([], [createLine(1, "unmatched: hidden")])
    const monitorOutput = createMonitorOutput(manager)

    //#when
    const result = parseMonitorOutput(await monitorOutput.execute({ monitor_id: "missing_monitor" }, createToolContext()))

    //#then
    expect(result).toEqual({
      lines: [],
      counters: {
        totalLines: 0,
        matchedLines: 0,
        unmatchedLines: 0,
        droppedMatched: 0,
        droppedUnmatched: 0,
        bytesDropped: 0,
        lastSequence: 0,
      },
      error: "not_found",
    })
    expect(manager.calls).toEqual([])
  })

  test("does not expose output from another session's monitor", async () => {
    //#given
    const manager = createFakeManager([createRecord("foreign_monitor", OTHER_SESSION_ID)], [
      createLine(1, "unmatched: secret"),
    ])
    const monitorOutput = createMonitorOutput(manager)

    //#when
    const result = parseMonitorOutput(
      await monitorOutput.execute({ monitor_id: "foreign_monitor" }, createToolContext(CALLING_SESSION_ID))
    )

    //#then
    expect(result.error).toBe("not_found")
    expect(result.lines).toEqual([])
    expect(manager.calls).toEqual([])
  })
})
