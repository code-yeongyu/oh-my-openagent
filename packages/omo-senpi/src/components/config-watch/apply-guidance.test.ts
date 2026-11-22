/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import { createConfigWatchComponent } from "./index"

type Handler = (payload: unknown, ctx?: unknown) => unknown

function systemPromptForSession(): (mode: string, surface?: string) => string | undefined {
  const handlers = new Map<string, Handler>()
  const pi: SenpiExtensionAPI = {
    events: { emit() {}, on: () => () => {} },
    on(name, handler) {
      handlers.set(name, handler)
    },
    registerTool() {},
    registerCommand() {},
    registerFlag() {},
    getFlag: () => undefined,
    sendMessage() {},
    sendUserMessage() {},
  }
  const ctx: ComponentContext = {
    config: { getFlag: () => undefined },
    logger: { info() {}, warn() {}, error() {} },
  }
  createConfigWatchComponent({
    resolveCwd: () => "/project",
    resolveTargets: () => [],
    createValidator: () => ({ validate: () => ({ ok: true }) }),
  }).register(pi, ctx)
  return (mode, surface) => {
    const handler = handlers.get("before_agent_start")
    if (handler === undefined) throw new Error("config-watch registered no before_agent_start handler")
    const result = handler(
      {
        type: "before_agent_start",
        prompt: "change the quick category model",
        systemPrompt: "BASE",
        systemPromptOptions: { cwd: "/project", ...(surface === undefined ? {} : { surface }) },
      },
      { mode },
    )
    if (typeof result !== "object" || result === null || !("systemPrompt" in result)) return undefined
    return typeof result.systemPrompt === "string" ? result.systemPrompt : undefined
  }
}

// `/reload` is the senpi terminal UI's slash command; `task` is the tool that starts a new task.
describe("config apply guidance by surface (#10021)", () => {
  it("#given a desktop app session #when a turn starts #then the prompt names the task step and never the /reload command", () => {
    const prompt = systemPromptForSession()("rpc", "app")

    expect(prompt).toStartWith("BASE")
    expect(prompt).not.toContain("/reload")
    expect(prompt).toContain("`task`")
  })

  it("#given a terminal UI session #when a turn starts #then the prompt still offers /reload", () => {
    expect(systemPromptForSession()("tui", "terminal")).toContain("/reload")
  })

  it("#given a headless rpc client or a one-shot run #when a turn starts #then the prompt names no /reload command", () => {
    const promptFor = systemPromptForSession()

    for (const mode of ["rpc", "print", "json"]) {
      const prompt = promptFor(mode)
      expect(prompt).toStartWith("BASE")
      expect(prompt).not.toContain("/reload")
    }
  })

  it("#given a host mode it does not know #when a turn starts #then the prompt is left alone", () => {
    expect(systemPromptForSession()("unknown")).toBeUndefined()
  })
})
