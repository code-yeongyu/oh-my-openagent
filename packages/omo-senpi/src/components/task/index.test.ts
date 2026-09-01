import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OmoTaskSettingsSchema, loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import { createRuntimeState, transitionRuntimeState } from "@oh-my-opencode/team-core/team-state-store"
import {
  createTaskRecordStore,
  normalizeSenpiTeamSpec,
  teamStorageBaseDir,
  toTeamCoreConfig,
  type TaskRecord,
} from "@oh-my-opencode/senpi-task"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { composeTaskEngine, type TaskEngine } from "./engine"
import { createTaskComponent, wireEventBridge } from "./index"
import * as taskComponentModule from "./index"
import type { CapturedUi } from "./runtime-context"
import { createSessionTransitionBridge } from "./session-transition-bridge"

const TASK_TOOL_NAMES = ["task", "task_send", "task_cancel", "task_output", "workflow"]
const TEAM_TOOL_NAMES = [
  "team_create",
  "team_delete",
  "task_create",
  "task_get",
  "task_list",
  "task_update",
]
const ALL_TOOL_NAMES = [...TASK_TOOL_NAMES, ...TEAM_TOOL_NAMES]
const TASK_EVENTS = [
  "session_start",
  "session_before_reload",
  "session_before_switch",
  "session_before_compact",
  "session_compact",
  "session_shutdown",
  "model_select",
  "before_agent_start",
  "agent_end",
]
const SKILL_INVOCATION_TRACKER_EVENTS = ["input", "tool_result", "session_shutdown"]
const DAG_LIFECYCLE_EVENTS = ["session_start", "session_before_switch", "session_shutdown", "session_shutdown"]
const TASK_COMMANDS = ["dag", "task-kill", "tasks"]

interface RecordedLog {
  level: "info" | "warn" | "error"
  message: string
}

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-senpi-task-"))
  tempRoots.push(dir)
  return dir
}

function createLogger(): ComponentLogger & { entries: RecordedLog[] } {
  const entries: RecordedLog[] = []
  return {
    entries,
    info: (message) => entries.push({ level: "info", message }),
    warn: (message) => entries.push({ level: "warn", message }),
    error: (message) => entries.push({ level: "error", message }),
  }
}

function ctxFor(pi: FakeExtensionAPI, logger: ComponentLogger): ComponentContext {
  return {
    logger,
    config: { getFlag: (name) => pi.getFlag(name) },
    getCapturedTools: () => [],
  }
}

function fakeUi(): CapturedUi {
  return {
    notify: () => {},
    setStatus: () => {},
    setWidget: () => {},
    select: async () => undefined,
    confirm: async () => false,
  }
}

const noopStatusUi = { scheduleSync: () => {}, syncNow: () => {}, dispose: () => {} }
const noopResumptionChannels = {
  emitSessionStart: () => Promise.resolve(),
  emitShutdown: () => Promise.resolve(),
}

// Build the real engine and wire its event bridge over a fake ExtensionAPI so tests can drive the
// registered handlers and observe the captured-ui bridge (todo 18: cleared on switch/shutdown).
function wiredBridge(): {
  pi: FakeExtensionAPI
  engine: ReturnType<typeof composeTaskEngine>
  reconcileCalls: { count: number }
  leadCalls: { ticks: number; shutdowns: number }
} {
  const cwd = tempProject()
  const pi = new FakeExtensionAPI()
  const logger = createLogger()
  const engine = composeTaskEngine({ pi, omoConfig: loadOmoConfig({ cwd }).config, cwd, sharedParentTools: () => [] })
  const transitions = createSessionTransitionBridge({ runtime: engine.runtime, notifier: engine.notifier })
  const reconcileCalls = { count: 0 }
  const leadCalls = { ticks: 0, shutdowns: 0 }
  wireEventBridge(pi, ctxFor(pi, logger), engine, noopStatusUi, transitions, {
    reconcileTeamMailbox: () => {
      reconcileCalls.count += 1
      return Promise.resolve()
    },
    leadPollers: {
      tick: () => {
        leadCalls.ticks += 1
        return Promise.resolve()
      },
      shutdown: () => { leadCalls.shutdowns += 1 },
    },
    resumptionChannels: noopResumptionChannels,
  })
  return { pi, engine, reconcileCalls, leadCalls }
}

async function seedTeamRuntime(cwd: string, leadSessionId: string, memberName = "crash"): Promise<string> {
  const loaded = loadOmoConfig({ cwd }).config
  const settings = loaded.task ?? OmoTaskSettingsSchema.parse({})
  const stateDir = { project_dir: cwd }
  const config = toTeamCoreConfig(settings, teamStorageBaseDir(stateDir))
  const spec = normalizeSenpiTeamSpec({
    members: [{ name: memberName, kind: "category", category: "quick", prompt: "member" }],
  }, "liveness-test")
  const runtime = await createRuntimeState(spec, leadSessionId, "project", config)
  await transitionRuntimeState(runtime.teamRunId, (state) => ({ ...state, status: "active" }), config)
  return runtime.teamRunId
}

function terminalRecord(teamRunId: string, memberName = "crash"): TaskRecord {
  return {
    task_id: "st_00000009",
    name: `team:${teamRunId}:${memberName}`,
    parent_session_id: "lead-session",
    root_session_id: "lead-session",
    depth: 1,
    execution_mode: "process",
    model: "omo-mock/mock-1",
    status: "error",
    residency_state: "resident",
    created_at: "2026-07-29T00:00:00.000Z",
    updated_at: "2026-07-29T00:00:01.000Z",
    error_message: "RPC child exited with code 1",
    notification: { run_epoch: 0, notified_epoch: 0 },
    notify_on_terminal: false,
  }
}

function toolNames(pi: FakeExtensionAPI): string[] {
  return pi.tools
    .map((tool) => tool["name"])
    .filter((name): name is string => typeof name === "string")
    .sort()
}

describe("omo-senpi task component wiring", () => {
  it("#given an explicit team member process #when the task component registers #then no lead task surface is wired", async () => {
    // given
    const previousMember = process.env.SENPI_TASK_MEMBER
    process.env.SENPI_TASK_MEMBER = "11111111-1111-4111-8111-111111111111::alice"
    const pi = new FakeExtensionAPI()
    const logger = createLogger()

    try {
      // when
      await createTaskComponent({ resolveCwd: () => tempProject() }).register(pi, ctxFor(pi, logger))
    } finally {
      if (previousMember === undefined) delete process.env.SENPI_TASK_MEMBER
      else process.env.SENPI_TASK_MEMBER = previousMember
    }

    // then
    expect(toolNames(pi)).toEqual([])
    expect(pi.commands).toEqual([])
    expect(pi.messageRenderers).toEqual([])
    expect(pi.handlers).toEqual([])
  })

  it("#given a fake ExtensionAPI boot #when the task component registers #then tools, commands, the completion renderer, and event handlers are wired", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const logger = createLogger()

    // when
    await createTaskComponent({ resolveCwd: () => tempProject() }).register(pi, ctxFor(pi, logger))

    expect(toolNames(pi)).toEqual([...ALL_TOOL_NAMES].sort())
    // the /tasks and /task-kill commands registered
    expect(pi.commands.map((entry) => entry.name).sort()).toEqual([...TASK_COMMANDS].sort())
    // Peer mail is a plain injected turn; completion, member liveness, and the dead-chain category
    // warning use structured renderers.
    expect(pi.messageRenderers.map((entry) => entry.customType)).toEqual([
      "senpi-task.completion",
      "senpi-task.team-member-liveness",
      "senpi-task.category-unavailable",
    ])
    // exactly the task event handlers (session lifecycle + transition-buffer edges), the
    // skill-invocation tracker subscriptions feeding the plan-gated agent gate, plus the
    // unconditional T16 hygiene sweep handler, which registers its own session_start listener
    expect(pi.handlers.map((handler) => handler.event).sort()).toEqual(
      [...TASK_EVENTS, ...SKILL_INVOCATION_TRACKER_EVENTS, ...DAG_LIFECYCLE_EVENTS, "session_start"].sort(),
    )
  })

  it("#given task and DAG lifecycle handlers #when startup and shutdown dispatch #then task reconciliation precedes DAG resume while DAG pause precedes task suspension and DAG disposal", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const order: string[] = []
    const wireDagLifecycle = Reflect.get(taskComponentModule, "wireDagLifecycle")
    expect(typeof wireDagLifecycle).toBe("function")
    if (typeof wireDagLifecycle !== "function") return
    wireDagLifecycle(pi, {
      attach: async () => { order.push("dag-resume") },
      detach: () => undefined,
      pauseForShutdown: () => { order.push("dag-pause") },
      dispose: () => { order.push("dag-dispose") },
    }, () => {
      pi.on("session_start", () => { order.push("task-reconcile") })
      pi.on("session_shutdown", () => { order.push("task-suspend") })
    })

    // when
    await pi.dispatch("session_start", {})
    await pi.dispatch("session_shutdown", {})

    // then
    expect(order).toEqual([
      "task-reconcile",
      "dag-resume",
      "dag-pause",
      "task-suspend",
      "dag-dispose",
    ])
  })

  it("#given a fake ExtensionAPI boot #when the task component registers #then only injection-driven lead team tools are wired", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const logger = createLogger()

    // when
    await createTaskComponent({ resolveCwd: () => tempProject() }).register(pi, ctxFor(pi, logger))

    const registered = toolNames(pi)
    for (const teamTool of TEAM_TOOL_NAMES) expect(registered).toContain(teamTool)
    expect(registered).not.toContain("team_wait")
  })

  it("#given the removed-tool hint capability #when the task component registers #then team_wait receives steer guidance", async () => {
    // given
    const pi = new FakeExtensionAPI() as FakeExtensionAPI & {
      registerRemovedToolHint: (name: string, hint: string) => void
    }
    const hints: Array<{ name: string; hint: string }> = []
    pi.registerRemovedToolHint = (name, hint) => hints.push({ name, hint })
    const logger = createLogger()

    // when
    await createTaskComponent({ resolveCwd: () => tempProject() }).register(pi, ctxFor(pi, logger))

    // then
    expect(hints).toEqual([{
      name: "team_wait",
      hint: "team_wait was removed - team messages arrive as steered notifications; send updates with task_send and end your turn.",
    }])
  })

  it("#given the omo-task flag is false #when the component registers #then only the unconditional hygiene sweep handler is wired", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    pi.setFlag("omo-task", false)

    // when
    await createTaskComponent({ resolveCwd: () => tempProject() }).register(pi, ctxFor(pi, logger))

    // then
    expect(pi.tools).toEqual([])
    expect(pi.handlers.map((handler) => handler.event)).toEqual(["session_start"])
    expect(pi.messageRenderers).toEqual([])
    expect(logger.entries).toContainEqual({ level: "info", message: "omo-senpi task component disabled by flag" })
  })

  it("#given a malformed omo.json #when the component registers #then it boots with defaults and still wires the tools", async () => {
    // given a project whose .omo/omo.json is invalid JSON
    const project = tempProject()
    mkdirSync(join(project, ".omo"), { recursive: true })
    writeFileSync(join(project, ".omo", "omo.json"), "{ not valid json ", "utf8")
    const pi = new FakeExtensionAPI()
    const logger = createLogger()

    // when
    await createTaskComponent({ resolveCwd: () => project }).register(pi, ctxFor(pi, logger))

    // then it never crashed: all tools still registered
    expect(toolNames(pi)).toEqual([...ALL_TOOL_NAMES].sort())
    // diagnostics are surfaced once by the dedicated config-startup component on session_start.
    expect(logger.entries).toEqual([])
  })

  it("#given a wired bridge #when session_start fires repeatedly #then the team mailbox is reconciled on every start", async () => {
    // given
    const { pi, reconcileCalls, leadCalls } = wiredBridge()
    const liveCtx = { ui: fakeUi(), mode: "tui", sessionManager: { getSessionId: () => "session-a" } }

    // when the session starts twice
    await pi.dispatch("session_start", {}, liveCtx)
    await pi.dispatch("session_start", {}, liveCtx)

    // then
    expect(reconcileCalls.count).toBe(2)
    expect(leadCalls.ticks).toBe(2)
  })

  it("#given a session start #when reconciliation runs #then reattach, cleanup, mailbox reclaim, notification retry, and lead polling stay ordered", async () => {
    // given
    const cwd = tempProject()
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    const base = composeTaskEngine({ pi, omoConfig: loadOmoConfig({ cwd }).config, cwd, sharedParentTools: () => [] })
    const order: string[] = []
    const engine: TaskEngine = {
      ...base,
      lifecycle: {
        ...base.lifecycle,
        reconcileOnSessionStart: async (sessionId) => {
          order.push(`reattach:${sessionId}`)
          return { outcomes: [] }
        },
        cleanupExpiredRecords: async () => {
          order.push("cleanup")
          return { deleted: [], retained: [] }
        },
      },
      notifier: {
        ...base.notifier,
        reconcileUnnotifiedNotifications: () => { order.push("notify") },
      },
    }
    const transitions = createSessionTransitionBridge({ runtime: engine.runtime, notifier: engine.notifier })
    wireEventBridge(pi, ctxFor(pi, logger), engine, noopStatusUi, transitions, {
      reconcileTeamMailbox: () => {
        order.push("reclaim")
        return Promise.resolve()
      },
      leadPollers: {
        tick: () => {
          order.push("poll")
          return Promise.resolve()
        },
        shutdown: () => undefined,
      },
      resumptionChannels: noopResumptionChannels,
    })

    // when
    await pi.dispatch("session_start", {}, {
      ui: fakeUi(),
      mode: "tui",
      sessionManager: { getSessionId: () => "session-a" },
    })

    // then
    expect(order).toEqual(["reattach:session-a", "reclaim", "notify", "cleanup", "poll"])
  })

  it("#given a terminal member owned by lead A #when lead B reconciles then lead A reconciles #then only the owning lead receives replay", async () => {
    const cwd = tempProject()
    const teamRunId = await seedTeamRuntime(cwd, "lead-a")
    const terminal = terminalRecord(teamRunId)
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    const base = composeTaskEngine({ pi, omoConfig: loadOmoConfig({ cwd }).config, cwd, sharedParentTools: () => [] })
    const engine: TaskEngine = {
      ...base,
      manager: {
        ...base.manager,
        get: () => terminal,
        list: (scope) => base.manager.list(scope),
      },
      lifecycle: {
        ...base.lifecycle,
        reconcileOnSessionStart: async () => ({ outcomes: [{ task_id: terminal.task_id, kind: "resumed" }] }),
        cleanupExpiredRecords: async () => ({ deleted: [], retained: [] }),
      },
    }
    const transitions = createSessionTransitionBridge({ runtime: engine.runtime, notifier: engine.notifier })
    wireEventBridge(pi, ctxFor(pi, logger), engine, noopStatusUi, transitions, {
      reconcileTeamMailbox: () => Promise.resolve(),
      leadPollers: { tick: () => Promise.resolve(), shutdown: () => undefined },
      resumptionChannels: noopResumptionChannels,
    })

    await pi.dispatch("session_start", {}, {
      sessionManager: { getSessionId: () => "lead-b" },
    })
    expect(pi.messages).toEqual([])

    await pi.dispatch("session_start", {}, {
      sessionManager: { getSessionId: () => "lead-a" },
    })
    expect(pi.messages).toHaveLength(1)
    expect(pi.messages[0]?.message.customType).toBe("senpi-task.team-member-liveness")
  })

  it("#given a liveness send before host persistence #when the process crashes and restarts #then no early ack suppresses replay and agent_end later commits the exact persisted marker", async () => {
    const cwd = tempProject()
    const teamRunId = await seedTeamRuntime(cwd, "lead-session")
    const terminal = terminalRecord(teamRunId)
    const store = createTaskRecordStore({ project_dir: cwd })
    store.save(terminal)

    const firstPi = new FakeExtensionAPI()
    const firstEngine = composeTaskEngine({
      pi: firstPi,
      omoConfig: loadOmoConfig({ cwd }).config,
      cwd,
      sharedParentTools: () => [],
    })
    firstEngine.runtime.captureFrom({ sessionManager: { getSessionId: () => "lead-session" } })
    await firstEngine.notifyOwnedMemberLiveness(terminal)
    expect(firstPi.messages).toHaveLength(1)
    expect(store.load(terminal.task_id)?.notification.liveness_notified_epoch).toBeUndefined()

    const replayPi = new FakeExtensionAPI()
    const logger = createLogger()
    const base = composeTaskEngine({
      pi: replayPi,
      omoConfig: loadOmoConfig({ cwd }).config,
      cwd,
      sharedParentTools: () => [],
    })
    const engine: TaskEngine = {
      ...base,
      manager: {
        ...base.manager,
        get: () => store.load(terminal.task_id) ?? undefined,
        list: (scope) => base.manager.list(scope),
      },
      lifecycle: {
        ...base.lifecycle,
        reconcileOnSessionStart: async () => ({ outcomes: [{ task_id: terminal.task_id, kind: "resumed" }] }),
        cleanupExpiredRecords: async () => ({ deleted: [], retained: [] }),
      },
    }
    const transitions = createSessionTransitionBridge({ runtime: engine.runtime, notifier: engine.notifier })
    wireEventBridge(replayPi, ctxFor(replayPi, logger), engine, noopStatusUi, transitions, {
      reconcileTeamMailbox: () => Promise.resolve(),
      leadPollers: { tick: () => Promise.resolve(), shutdown: () => undefined },
      resumptionChannels: noopResumptionChannels,
    })
    const sessionFile = join(cwd, "lead-session.jsonl")
    const liveContext = {
      sessionManager: {
        getSessionId: () => "lead-session",
        getSessionFile: () => sessionFile,
      },
    }

    await replayPi.dispatch("session_start", {}, liveContext)
    expect(replayPi.messages).toHaveLength(1)
    expect(store.load(terminal.task_id)?.notification.liveness_notified_epoch).toBeUndefined()

    const replayMessage = replayPi.messages[0]?.message
    if (replayMessage === undefined) throw new Error("expected replay liveness message")
    writeFileSync(sessionFile, `${JSON.stringify({ type: "custom_message", ...replayMessage })}\n`, "utf8")
    await replayPi.dispatch("agent_end", {}, liveContext)

    expect(store.load(terminal.task_id)?.notification.liveness_notified_epoch).toBe(0)
  })

  it("#given a captured ui #when session_before_switch fires #then the ui bridge is cleared", async () => {
    // given a wired event bridge over a real engine with a ui captured on session_start
    const { pi, engine } = wiredBridge()
    const liveCtx = { ui: fakeUi(), mode: "tui", sessionManager: { getSessionId: () => "session-a" } }
    await pi.dispatch("session_start", {}, liveCtx)
    expect(engine.runtime.ui()).toBeDefined()

    // when a switch fires while a still-live ui context is present (the real ExtensionContext.ui is
    // non-optional, so captureFrom would otherwise re-capture it)
    await pi.dispatch("session_before_switch", {}, { ...liveCtx, ui: fakeUi() })

    // then the bridge is cleared, so store-driven syncs no-op until the next re-capture
    expect(engine.runtime.ui()).toBeUndefined()
  })

  it("#given a captured ui #when session_shutdown fires #then the ui bridge is cleared", async () => {
    // given a wired event bridge with a ui captured on session_start
    const { pi, engine, leadCalls } = wiredBridge()
    const liveCtx = { ui: fakeUi(), mode: "tui", sessionManager: { getSessionId: () => "session-a" } }
    await pi.dispatch("session_start", {}, liveCtx)
    expect(engine.runtime.ui()).toBeDefined()

    // when the session shuts down
    await pi.dispatch("session_shutdown", {}, { ...liveCtx, ui: fakeUi() })

    // then the bridge is cleared
    expect(engine.runtime.ui()).toBeUndefined()
    expect(leadCalls.shutdowns).toBe(1)
  })

  it("#given an ExtensionAPI missing registerMessageRenderer #when the component registers #then it skips with one warning and never crashes", async () => {
    // given a pi whose registerMessageRenderer capability is absent
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    ;(pi as { registerMessageRenderer?: unknown }).registerMessageRenderer = undefined

    // when
    await createTaskComponent({ resolveCwd: () => tempProject() }).register(pi, ctxFor(pi, logger))

    // then no tools wired; only the unconditional hygiene sweep handler remains
    expect(pi.tools).toEqual([])
    expect(pi.handlers.map((handler) => handler.event)).toEqual(["session_start"])
    const skipWarnings = logger.entries.filter(
      (entry) => entry.level === "warn" && entry.message.includes("missing ExtensionAPI capabilities"),
    )
    expect(skipWarnings).toHaveLength(1)
  })
})
