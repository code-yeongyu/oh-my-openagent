import { describe, expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type {
  MonitorManager,
  MonitorManagerEvent,
  MonitorOutputQuery,
  MonitorOutputResult,
  MonitorRecord,
  MonitorStartOpts,
} from "../../features/monitor"
import { createMonitorStop } from "./monitor-stop"
import type { MonitorStopResult } from "./monitor-stop"

const SESSION_ID = "session-1"

const TOOL_CONTEXT: ToolContext = {
  sessionID: SESSION_ID,
  messageID: "message-1",
  agent: "test-agent",
  directory: "/tmp",
  worktree: "/tmp",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

function createRecord(overrides: Partial<MonitorRecord> = {}): MonitorRecord {
  return {
    id: "monitor-1",
    command: "bun test",
    label: "tests",
    mode: "idle",
    parentSessionId: SESSION_ID,
    startedAt: new Date("2026-06-15T00:00:00.000Z"),
    status: "running",
    counters: {
      totalLines: 0,
      matchedLines: 0,
      unmatchedLines: 0,
      droppedMatched: 0,
      droppedUnmatched: 0,
      bytesDropped: 0,
      lastSequence: 0,
    },
    ...overrides,
  }
}

class FakeMonitorManager implements MonitorManager {
  readonly stopCalls: string[] = []
  private records = new Map<string, MonitorRecord>()

  constructor(records: MonitorRecord[] = []) {
    for (const record of records) {
      this.records.set(record.id, record)
    }
  }

  async start(_opts: MonitorStartOpts): Promise<MonitorRecord> {
    throw new Error("not implemented in monitor_stop tests")
  }

  async stop(id: string): Promise<void> {
    this.stopCalls.push(id)
    const record = this.records.get(id)
    if (record) {
      record.status = "stopped"
    }
  }

  list(sessionId: string): MonitorRecord[] {
    return [...this.records.values()].filter((record) => record.parentSessionId === sessionId)
  }

  get(id: string): MonitorRecord | undefined {
    return this.records.get(id)
  }

  getOutput(_id: string, _opts: MonitorOutputQuery): MonitorOutputResult {
    return {
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
    }
  }

  async stopSessionMonitors(_sessionId: string): Promise<void> {}

  handleEvent(_event: MonitorManagerEvent): void {}

  async shutdown(): Promise<void> {}
}

function parseResult(result: unknown): MonitorStopResult {
  if (typeof result !== "string") {
    throw new Error("monitor_stop result must be a JSON string")
  }

  return JSON.parse(result) as MonitorStopResult
}

describe("monitor_stop tool", () => {
  test("stops a running monitor owned by the calling session", async () => {
    // given
    const manager = new FakeMonitorManager([createRecord()])
    const tool = createMonitorStop(manager)

    // when
    const result = parseResult(await tool.execute({ monitor_id: "monitor-1" }, TOOL_CONTEXT))

    // then
    expect(result).toEqual({ status: "stopped", monitor_id: "monitor-1" })
    expect(manager.stopCalls).toEqual(["monitor-1"])
  })

  test("returns already-stopped for an unknown monitor without throwing", async () => {
    // given
    const manager = new FakeMonitorManager()
    const tool = createMonitorStop(manager)

    // when
    const result = parseResult(await tool.execute({ monitor_id: "missing" }, TOOL_CONTEXT))

    // then
    expect(result).toEqual({ status: "already-stopped", monitor_id: "missing" })
    expect(manager.stopCalls).toEqual([])
  })

  test("returns one stopped result and one already-stopped result for concurrent stop calls", async () => {
    // given
    const manager = new FakeMonitorManager([createRecord()])
    const tool = createMonitorStop(manager)

    // when
    const [firstResult, secondResult] = (await Promise.all([
      tool.execute({ monitor_id: "monitor-1" }, TOOL_CONTEXT),
      tool.execute({ monitor_id: "monitor-1" }, TOOL_CONTEXT),
    ])).map(parseResult)

    // then
    expect([firstResult, secondResult]).toEqual([
      { status: "stopped", monitor_id: "monitor-1" },
      { status: "already-stopped", monitor_id: "monitor-1" },
    ])
    expect(manager.stopCalls).toEqual(["monitor-1"])
  })

  test("denies stopping a monitor owned by another session", async () => {
    // given
    const manager = new FakeMonitorManager([
      createRecord({ id: "other-monitor", parentSessionId: "other-session" }),
    ])
    const tool = createMonitorStop(manager)

    // when
    const result = parseResult(await tool.execute({ monitor_id: "other-monitor" }, TOOL_CONTEXT))

    // then
    expect(result).toEqual({ status: "denied", monitor_id: "other-monitor" })
    expect(manager.stopCalls).toEqual([])
  })
})
