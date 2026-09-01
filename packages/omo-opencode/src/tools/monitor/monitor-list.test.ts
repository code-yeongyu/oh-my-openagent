import { describe, expect, it } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { createMonitorList } from "./monitor-list"
import type {
  MonitorManager,
  MonitorOutputQuery,
  MonitorOutputResult,
  MonitorRecord,
  MonitorStartOpts,
} from "../../features/monitor"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

class FakeMonitorManager implements MonitorManager {
  public readonly listedSessionIds: string[] = []

  constructor(private readonly recordsBySession: Map<string, MonitorRecord[]>) {}

  async start(_opts: MonitorStartOpts): Promise<MonitorRecord> {
    throw new Error("not implemented")
  }

  async stop(_id: string): Promise<void> {}

  list(sessionId: string): MonitorRecord[] {
    this.listedSessionIds.push(sessionId)
    return this.recordsBySession.get(sessionId) ?? []
  }

  get(_id: string): MonitorRecord | undefined {
    return undefined
  }

  getOutput(_id: string, _opts: MonitorOutputQuery): MonitorOutputResult {
    return {
      lines: [],
      counters: createCounters(),
    }
  }

  async stopSessionMonitors(_sessionId: string): Promise<void> {}

  handleEvent(): void {}

  async shutdown(): Promise<void> {}
}

function createCounters(overrides: Partial<MonitorRecord["counters"]> = {}): MonitorRecord["counters"] {
  return {
    totalLines: 12,
    matchedLines: 3,
    unmatchedLines: 9,
    droppedMatched: 1,
    droppedUnmatched: 2,
    bytesDropped: 64,
    lastSequence: 42,
    ...overrides,
  }
}

function createRecord(overrides: Partial<MonitorRecord> = {}): MonitorRecord {
  return {
    id: "monitor-1",
    command: "printf secret-token-123",
    label: "safe label",
    mode: "idle",
    parentSessionId: "session-a",
    startedAt: new Date("2026-06-15T10:00:00.000Z"),
    status: "running",
    counters: createCounters(),
    ...overrides,
  }
}

function createToolContext(sessionID: string): ToolContext {
  return unsafeTestValue<ToolContext>({
    sessionID,
    messageID: "message-1",
    agent: "sisyphus",
    directory: "/tmp/project",
    worktree: "/tmp/project",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  })
}

function resultOutput(result: Awaited<ReturnType<ReturnType<typeof createMonitorList>["execute"]>>): string {
  if (typeof result === "string") {
    return result
  }

  return result.output
}

describe("createMonitorList", () => {
  it("lists only monitors from the current session", async () => {
    //#given
    const currentSessionRecord = createRecord({ id: "current", parentSessionId: "session-a" })
    const otherSessionRecord = createRecord({ id: "other", parentSessionId: "session-b" })
    const manager = new FakeMonitorManager(
      new Map([
        ["session-a", [currentSessionRecord]],
        ["session-b", [otherSessionRecord]],
      ])
    )
    const tool = createMonitorList(manager, { sessionID: "session-a" })

    //#when
    const result = resultOutput(await tool.execute({}, createToolContext("ignored-session")))

    //#then
    const parsed = JSON.parse(result)
    expect(manager.listedSessionIds).toEqual(["session-a"])
    expect(parsed.monitors.map((monitor: { id: string }) => monitor.id)).toEqual(["current"])
  })

  it("returns rows with id, label, mode, startedAt, status, and all counter fields", async () => {
    //#given
    const manager = new FakeMonitorManager(
      new Map([
        [
          "session-a",
          [
            createRecord({
              id: "monitor-1",
              label: "build watcher",
              mode: "live_safe",
              status: "running",
              counters: createCounters({
                matchedLines: 5,
                unmatchedLines: 7,
                droppedMatched: 2,
                droppedUnmatched: 4,
                bytesDropped: 128,
                lastSequence: 99,
              }),
            }),
          ],
        ],
      ])
    )
    const tool = createMonitorList(manager, { sessionID: "session-a" })

    //#when
    const result = resultOutput(await tool.execute({}, createToolContext("session-a")))

    //#then
    const parsed = JSON.parse(result)
    expect(parsed.monitors).toEqual([
      {
        id: "monitor-1",
        label: "build watcher",
        mode: "live_safe",
        startedAt: "2026-06-15T10:00:00.000Z",
        status: "running",
        counters: {
          matched: 5,
          unmatched: 7,
          droppedMatched: 2,
          droppedUnmatched: 4,
          bytesDropped: 128,
          lastSequence: 99,
        },
      },
    ])
  })

  it("does not include the raw command in output", async () => {
    //#given
    const manager = new FakeMonitorManager(
      new Map([["session-a", [createRecord({ command: "deploy --token secret-token-123" })]]])
    )
    const tool = createMonitorList(manager, { sessionID: "session-a" })

    //#when
    const result = resultOutput(await tool.execute({}, createToolContext("session-a")))

    //#then
    expect(result).toContain("safe label")
    expect(result).not.toContain("deploy --token")
    expect(result).not.toContain("secret-token-123")
    expect(JSON.parse(result).monitors[0]).not.toHaveProperty("command")
  })

  it("hides exited monitors by default and includes them when requested", async () => {
    //#given
    const manager = new FakeMonitorManager(
      new Map([
        [
          "session-a",
          [
            createRecord({ id: "running", status: "running" }),
            createRecord({ id: "exited", status: "exited" }),
            createRecord({ id: "stopped", status: "stopped" }),
            createRecord({ id: "failed", status: "failed" }),
          ],
        ],
      ])
    )
    const tool = createMonitorList(manager, { sessionID: "session-a" })

    //#when
    const defaultResult = resultOutput(await tool.execute({}, createToolContext("session-a")))
    const includeExitedResult = resultOutput(
      await tool.execute({ include_exited: true }, createToolContext("session-a"))
    )

    //#then
    expect(JSON.parse(defaultResult).monitors.map((monitor: { id: string }) => monitor.id)).toEqual([
      "running",
    ])
    expect(JSON.parse(includeExitedResult).monitors.map((monitor: { id: string }) => monitor.id)).toEqual([
      "running",
      "exited",
      "stopped",
      "failed",
    ])
  })
})
