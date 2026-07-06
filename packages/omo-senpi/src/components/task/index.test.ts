import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { createTaskComponent } from "./index"

const TASK_TOOL_NAMES = ["task", "task_send", "task_wait", "task_interrupt", "task_cancel", "task_list", "task_output"]
const TASK_EVENTS = ["session_start", "session_shutdown", "model_select", "before_agent_start"]

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

function toolNames(pi: FakeExtensionAPI): string[] {
  return pi.tools
    .map((tool) => tool["name"])
    .filter((name): name is string => typeof name === "string")
    .sort()
}

describe("omo-senpi task component wiring", () => {
  it("#given a fake ExtensionAPI boot #when the task component registers #then 7 tools, a renderer, and 4 event handlers are wired", () => {
    // given
    const pi = new FakeExtensionAPI()
    const logger = createLogger()

    // when
    createTaskComponent({ resolveCwd: () => tempProject() }).register(pi, ctxFor(pi, logger))

    // then the 7 task tools registered
    expect(toolNames(pi)).toEqual([...TASK_TOOL_NAMES].sort())
    // the completion renderer registered
    expect(pi.messageRenderers.map((entry) => entry.customType)).toEqual(["senpi-task.completion"])
    // exactly the 4 task event handlers
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
