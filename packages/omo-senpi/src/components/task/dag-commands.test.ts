import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import {
  registerDagCommands,
  type DagCommandManager,
  type DagCommandNode,
  type DagCommandRunSnapshot,
  type DagCommandRunSummary,
  type DagCommandTaskRecord,
} from "./dag-commands"

interface FakeCommandUi {
  readonly notifications: Array<{ message: string; type?: string }>
  readonly selectCalls: Array<{ title: string; options: string[] }>
  select: (title: string, options: string[]) => Promise<string | undefined>
  confirm: (title: string, message: string) => Promise<boolean>
  notify: (message: string, type?: string) => void
}

function commandCtx(
  sessionId: string | undefined,
  select?: (title: string, options: string[]) => Promise<string | undefined>,
): { ctx: unknown; ui: FakeCommandUi } {
  const notifications: Array<{ message: string; type?: string }> = []
  const selectCalls: Array<{ title: string; options: string[] }> = []
  const uiImpl: FakeCommandUi = {
    notifications,
    selectCalls,
    select: (title, options) => {
      selectCalls.push({ title, options })
      return (select ?? (() => Promise.resolve(undefined)))(title, options)
    },
    confirm: () => Promise.resolve(true),
    notify: (message, type) => notifications.push({ message, type }),
  }
  const ctx = {
    mode: "tui",
    ui: uiImpl,
    sessionManager: { getSessionId: () => sessionId ?? "unknown" },
  }
  return { ctx, ui: uiImpl }
}

function node(overrides: Partial<DagCommandNode> & { id: string }): DagCommandNode {
  return {
    state: "completed",
    route: { kind: "category", category: "quick" },
    dependsOn: [],
    attempt: 1,
    ...overrides,
  }
}

// A diamond: seed fans out to left/right, both feed join. left is the slow arm, so the critical
// path runs seed -> left -> join and left is the bottleneck blocking join.
function diamondSnapshot(): DagCommandRunSnapshot {
  return {
    runId: "dag_diamond",
    name: "release audit",
    status: "running",
    createdAt: "2026-08-14T00:00:00.000Z",
    nodes: [
      node({
        id: "seed",
        label: "collect inputs",
        state: "completed",
        route: { kind: "category", category: "quick" },
        taskId: "st_seed",
        startedAt: "2026-08-14T00:00:00.000Z",
        completedAt: "2026-08-14T00:00:02.000Z",
      }),
      node({
        id: "left",
        label: "deep review",
        state: "running",
        route: { kind: "agent", agent: "reviewer", model: "anthropic/claude-opus-4-1" },
        dependsOn: ["seed"],
        taskId: "st_left",
        attempt: 2,
        startedAt: "2026-08-14T00:00:02.000Z",
      }),
      node({
        id: "right",
        label: "quick lint",
        state: "failed",
        route: { kind: "category", category: "quick" },
        dependsOn: ["seed"],
        taskId: "st_right",
        startedAt: "2026-08-14T00:00:02.000Z",
        completedAt: "2026-08-14T00:00:03.000Z",
        error: { code: "task_error", message: "lint exited 1" },
      }),
      node({ id: "join", label: "merge report", state: "blocked", dependsOn: ["left", "right"] }),
    ],
    edges: [
      { from: "seed", to: "left" },
      { from: "seed", to: "right" },
      { from: "left", to: "join" },
      { from: "right", to: "join" },
    ],
    waves: [
      { index: 0, nodeIds: ["seed"] },
      { index: 1, nodeIds: ["left", "right"] },
      { index: 2, nodeIds: ["join"] },
    ],
    criticalPath: ["seed", "left", "join"],
    bottlenecks: [{ nodeId: "left", blockedCount: 1 }],
  }
}

function fakeManager(
  summaries: readonly DagCommandRunSummary[],
  snapshots: Readonly<Record<string, DagCommandRunSnapshot>> = {},
  tasks: Readonly<Record<string, DagCommandTaskRecord>> = {},
): DagCommandManager {
  return {
    list: (parentSessionId) => summaries.filter((summary) => summary.parentSessionId === parentSessionId),
    snapshot: (runId, parentSessionId) => {
      const found = snapshots[runId]
      if (found === undefined) throw new Error(`unknown dag run "${runId}"`)
      const owner = summaries.find((summary) => summary.runId === runId)?.parentSessionId
      if (owner !== undefined && owner !== parentSessionId) throw new Error(`dag run "${runId}" belongs to another session`)
      return found
    },
    taskRecord: (taskId) => tasks[taskId],
  }
}

function summary(overrides: Partial<DagCommandRunSummary> & { runId: string }): DagCommandRunSummary {
  return {
    name: "run",
    parentSessionId: "session-a",
    status: "running",
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:05.000Z",
    counts: { total: 4, completed: 1, running: 1, failed: 0 },
    ...overrides,
  }
}

async function invoke(pi: FakeExtensionAPI, args: string, ctx: unknown): Promise<void> {
  const command = pi.commands.find((entry) => entry.name === "dag")
  if (command === undefined) throw new Error("command dag not registered")
  const handler = command.options["handler"] as (args: string, ctx: unknown) => Promise<void>
  await handler(args, ctx)
}

describe("registerDagCommands", () => {
  it("#given the component registers commands #when inspecting the api #then /dag exists", () => {
    // given
    const pi = new FakeExtensionAPI()

    // when
    registerDagCommands(pi, fakeManager([]))

    // then
    expect(pi.commands.map((entry) => entry.name)).toEqual(["dag"])
  })

  it("#given runs in two sessions #when /dag runs with no argument #then this session's runs print with statuses", async () => {
    // given
    const mine = summary({ runId: "dag_mine", name: "release audit", status: "running" })
    const done = summary({ runId: "dag_done", name: "nightly sweep", status: "completed", counts: { total: 3, completed: 3, running: 0, failed: 0 } })
    const other = summary({ runId: "dag_other", name: "foreign", parentSessionId: "session-b" })
    const pi = new FakeExtensionAPI()
    registerDagCommands(pi, fakeManager([mine, done, other]))
    const { ctx, ui } = commandCtx("session-a")

    // when
    await invoke(pi, "", ctx)

    // then
    const printed = ui.notifications.map((entry) => entry.message).join("\n")
    expect(printed).toContain("dag_mine")
    expect(printed).toContain("release audit")
    expect(printed).toContain("running")
    expect(printed).toContain("dag_done")
    expect(printed).toContain("completed")
    expect(printed).not.toContain("dag_other")
  })

  it("#given a diamond run #when /dag <id> runs #then waves group nodes with dependency annotations", async () => {
    // given
    const snapshot = diamondSnapshot()
    const pi = new FakeExtensionAPI()
    registerDagCommands(pi, fakeManager([summary({ runId: "dag_diamond", name: "release audit" })], { dag_diamond: snapshot }))
    const { ctx, ui } = commandCtx("session-a")

    // when
    await invoke(pi, "dag_diamond", ctx)

    // then the tree is wave-grouped and every dependent node names what it waits on
    const lines = ui.notifications.map((entry) => entry.message).join("\n").split("\n")
    const waveHeaders = lines.filter((line) => line.startsWith("wave "))
    expect(waveHeaders).toEqual(["wave 1/3", "wave 2/3", "wave 3/3"])
    const seedLine = lines.find((line) => line.includes("collect inputs"))
    const leftLine = lines.find((line) => line.includes("deep review"))
    const joinLine = lines.find((line) => line.includes("merge report"))
    expect(seedLine).not.toContain("after ")
    expect(leftLine).toContain("after seed")
    expect(joinLine).toContain("after left, right")
    // and node rows are indented under their wave header
    expect(leftLine?.startsWith("  ")).toBe(true)
  })

  it("#given a diamond run #when /dag <id> runs #then per-node state, route, model, attempt, duration and error render", async () => {
    // given
    const snapshot = diamondSnapshot()
    const pi = new FakeExtensionAPI()
    const tasks: Record<string, DagCommandTaskRecord> = {
      st_left: { model: "anthropic/claude-opus-4-1", resolved_model: { display: "opus-4.1-high" } },
    }
    registerDagCommands(pi, fakeManager([summary({ runId: "dag_diamond" })], { dag_diamond: snapshot }, tasks))
    const { ctx, ui } = commandCtx("session-a")

    // when
    await invoke(pi, "dag_diamond", ctx)

    // then
    const lines = ui.notifications.map((entry) => entry.message).join("\n").split("\n")
    const leftLine = lines.find((line) => line.includes("deep review")) ?? ""
    expect(leftLine).toContain("running")
    expect(leftLine).toContain("agent:reviewer")
    expect(leftLine).toContain("model:opus-4.1-high")
    expect(leftLine).toContain("x2")
    const seedLine = lines.find((line) => line.includes("collect inputs")) ?? ""
    expect(seedLine).toContain("category:quick")
    expect(seedLine).toContain("2.0s")
    const rightLine = lines.find((line) => line.includes("quick lint")) ?? ""
    expect(rightLine).toContain("error: task_error lint exited 1")
  })

  it("#given a diamond run #when /dag <id> runs #then the critical path and bottleneck are marked", async () => {
    // given the slow arm (left) carries the critical path and blocks join
    const snapshot = diamondSnapshot()
    const pi = new FakeExtensionAPI()
    registerDagCommands(pi, fakeManager([summary({ runId: "dag_diamond" })], { dag_diamond: snapshot }))
    const { ctx, ui } = commandCtx("session-a")

    // when
    await invoke(pi, "dag_diamond", ctx)

    // then only critical-path nodes carry the marker
    const printed = ui.notifications.map((entry) => entry.message).join("\n")
    const lines = printed.split("\n")
    expect(lines.find((line) => line.includes("deep review"))).toContain("*critical*")
    expect(lines.find((line) => line.includes("quick lint"))).not.toContain("*critical*")
    expect(printed).toContain("critical path: seed -> left -> join")
    expect(printed).toContain("bottleneck: left blocks 1")
  })

  it("#given a retried run #when /dag <id> runs #then only re-run nodes carry the xN badge and the failure line names its code", async () => {
    // given left is on attempt 2 after a retry, seed and right never re-ran
    const pi = new FakeExtensionAPI()
    registerDagCommands(pi, fakeManager([summary({ runId: "dag_diamond" })], { dag_diamond: diamondSnapshot() }))
    const { ctx, ui } = commandCtx("session-a")

    // when
    await invoke(pi, "dag_diamond", ctx)

    // then
    const lines = ui.notifications.map((entry) => entry.message).join("\n").split("\n")
    expect(lines.find((line) => line.includes("deep review"))).toContain("x2")
    expect(lines.find((line) => line.includes("collect inputs"))).not.toContain("x2")
    expect(lines.find((line) => line.includes("quick lint"))).toContain("error: task_error lint exited 1")
  })

  it("#given an amended run #when /dag <id> runs #then the header carries an amended xN marker", async () => {
    // given the definition was amended twice
    const snapshot = { ...diamondSnapshot(), amendHistory: [{ at: "2026-08-14T00:01:00.000Z" }, { at: "2026-08-14T00:02:00.000Z" }] }
    const pi = new FakeExtensionAPI()
    registerDagCommands(pi, fakeManager([summary({ runId: "dag_diamond" })], { dag_diamond: snapshot }))
    const { ctx, ui } = commandCtx("session-a")

    // when
    await invoke(pi, "dag_diamond", ctx)

    // then
    const header = ui.notifications.map((entry) => entry.message).join("\n").split("\n")[0] ?? ""
    expect(header).toContain("amended x2")
  })

  it("#given a run that was never amended #when /dag <id> runs #then no amended marker renders", async () => {
    // given
    const pi = new FakeExtensionAPI()
    registerDagCommands(pi, fakeManager([summary({ runId: "dag_diamond" })], { dag_diamond: { ...diamondSnapshot(), amendHistory: [] } }))
    const { ctx, ui } = commandCtx("session-a")

    // when
    await invoke(pi, "dag_diamond", ctx)

    // then
    expect(ui.notifications.map((entry) => entry.message).join("\n")).not.toContain("amended")
  })

  it("#given an unknown run id #when /dag <id> runs #then it notifies instead of throwing", async () => {
    // given a manager that only knows another run
    const pi = new FakeExtensionAPI()
    registerDagCommands(pi, fakeManager([summary({ runId: "dag_known" })], { dag_known: diamondSnapshot() }))
    const { ctx, ui } = commandCtx("session-a")

    // when
    await invoke(pi, "dag_nope", ctx)

    // then
    expect(ui.notifications).toHaveLength(1)
    expect(ui.notifications[0]?.message).toContain("dag_nope")
    expect(ui.notifications[0]?.message).toContain("No dag run")
    expect(ui.notifications[0]?.type).toBe("warning")
  })

  it("#given a session with zero runs #when /dag runs #then the empty state prints", async () => {
    // given
    const pi = new FakeExtensionAPI()
    registerDagCommands(pi, fakeManager([summary({ runId: "dag_other", parentSessionId: "session-b" })]))
    const { ctx, ui } = commandCtx("session-a")

    // when
    await invoke(pi, "", ctx)

    // then
    expect(ui.notifications).toHaveLength(1)
    expect(ui.notifications[0]?.message).toBe("No dag runs in this session.")
  })

  it("#given no session id #when /dag runs #then the empty state prints and the manager is never queried", async () => {
    // given a context whose session manager is missing entirely
    let listed = 0
    const pi = new FakeExtensionAPI()
    registerDagCommands(pi, {
      list: (parentSessionId) => {
        listed += 1
        void parentSessionId
        return []
      },
      snapshot: () => {
        throw new Error("unreachable")
      },
      taskRecord: () => undefined,
    })
    const notifications: string[] = []
    const ctx = { mode: "tui", ui: { notify: (message: string) => notifications.push(message), select: () => Promise.resolve(undefined), confirm: () => Promise.resolve(true) } }

    // when
    await invoke(pi, "", ctx)

    // then
    expect(listed).toBe(0)
    expect(notifications).toEqual(["No dag runs in this session."])
  })
})
