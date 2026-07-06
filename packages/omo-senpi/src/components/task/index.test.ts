import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { composeTaskEngine } from "./engine"
import { createTaskComponent, wireEventBridge } from "./index"
import type { CapturedUi } from "./runtime-context"
import { createSessionTransitionBridge } from "./session-transition-bridge"

const TASK_TOOL_NAMES = ["task", "task_send", "task_wait", "task_interrupt", "task_cancel", "task_list", "task_output"]
const TASK_EVENTS = [
  "session_start",
  "session_before_switch",
  "session_before_compact",
  "session_compact",
  "session_shutdown",
  "model_select",
  "before_agent_start",
]
const TASK_COMMANDS = ["task-kill", "tasks"]

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

const noopStatusUi = { scheduleSync: () => {}, syncNow: () => {} }

// Build the real engine and wire its event bridge over a fake ExtensionAPI so tests can drive the
// registered handlers and observe the captured-ui bridge (todo 18: cleared on switch/shutdown).
function wiredBridge(): { pi: FakeExtensionAPI; engine: ReturnType<typeof composeTaskEngine> } {
  const cwd = tempProject()
  const pi = new FakeExtensionAPI()
  const logger = createLogger()
  const engine = composeTaskEngine({ pi, omoConfig: loadOmoConfig({ cwd }).config, cwd, sharedParentTools: () => [] })
  const transitions = createSessionTransitionBridge({ runtime: engine.runtime, notifier: engine.notifier })
  wireEventBridge(pi, ctxFor(pi, logger), engine, noopStatusUi, transitions, { warnDualConfig: false })
  return { pi, engine }
}

function toolNames(pi: FakeExtensionAPI): string[] {
  return pi.tools
    .map((tool) => tool["name"])
    .filter((name): name is string => typeof name === "string")
    .sort()
}

describe("omo-senpi task component wiring", () => {
  it("#given a fake ExtensionAPI boot #when the task component registers #then tools, commands, a renderer, and the event handlers are wired", () => {
    // given
    const pi = new FakeExtensionAPI()
    const logger = createLogger()

    // when
    createTaskComponent({ resolveCwd: () => tempProject() }).register(pi, ctxFor(pi, logger))

    // then the 7 task tools registered
    expect(toolNames(pi)).toEqual([...TASK_TOOL_NAMES].sort())
    // the /tasks and /task-kill commands registered
    expect(pi.commands.map((entry) => entry.name).sort()).toEqual([...TASK_COMMANDS].sort())
    // the completion renderer registered
    expect(pi.messageRenderers.map((entry) => entry.customType)).toEqual(["senpi-task.completion"])
    // exactly the task event handlers (session lifecycle + transition-buffer edges)
    expect(pi.handlers.map((handler) => handler.event).sort()).toEqual([...TASK_EVENTS].sort())
  })

  it("#given the omo-task flag is false #when the component registers #then nothing is wired", () => {
    // given
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    pi.setFlag("omo-task", false)

    // when
    createTaskComponent({ resolveCwd: () => tempProject() }).register(pi, ctxFor(pi, logger))

    // then
    expect(pi.tools).toEqual([])
    expect(pi.handlers).toEqual([])
    expect(pi.messageRenderers).toEqual([])
    expect(logger.entries).toContainEqual({ level: "info", message: "omo-senpi task component disabled by flag" })
  })

  it("#given a malformed omo.json #when the component registers #then it boots with defaults, warns once, and still wires the tools", () => {
    // given a project whose .omo/omo.json is invalid JSON
    const project = tempProject()
    mkdirSync(join(project, ".omo"), { recursive: true })
    writeFileSync(join(project, ".omo", "omo.json"), "{ not valid json ", "utf8")
    const pi = new FakeExtensionAPI()
    const logger = createLogger()

    // when
    createTaskComponent({ resolveCwd: () => project }).register(pi, ctxFor(pi, logger))

    // then it never crashed: all tools still registered
    expect(toolNames(pi)).toEqual([...TASK_TOOL_NAMES].sort())
    // and exactly one config-load warning was emitted
    const configWarnings = logger.entries.filter(
      (entry) => entry.level === "warn" && entry.message.includes("using default config after omo.json load issues"),
    )
    expect(configWarnings).toHaveLength(1)
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
    const { pi, engine } = wiredBridge()
    const liveCtx = { ui: fakeUi(), mode: "tui", sessionManager: { getSessionId: () => "session-a" } }
    await pi.dispatch("session_start", {}, liveCtx)
    expect(engine.runtime.ui()).toBeDefined()

    // when the session shuts down
    await pi.dispatch("session_shutdown", {}, { ...liveCtx, ui: fakeUi() })

    // then the bridge is cleared
    expect(engine.runtime.ui()).toBeUndefined()
  })

  it("#given an ExtensionAPI missing registerMessageRenderer #when the component registers #then it skips with one warning and never crashes", () => {
    // given a pi whose registerMessageRenderer capability is absent
    const pi = new FakeExtensionAPI()
    const logger = createLogger()
    ;(pi as { registerMessageRenderer?: unknown }).registerMessageRenderer = undefined

    // when
    createTaskComponent({ resolveCwd: () => tempProject() }).register(pi, ctxFor(pi, logger))

    // then no tools or events wired
    expect(pi.tools).toEqual([])
    expect(pi.handlers).toEqual([])
    const skipWarnings = logger.entries.filter(
      (entry) => entry.level === "warn" && entry.message.includes("missing ExtensionAPI capabilities"),
    )
    expect(skipWarnings).toHaveLength(1)
  })
})
