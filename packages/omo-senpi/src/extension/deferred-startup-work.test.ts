/// <reference types="bun-types" />

import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"

import { FakeExtensionAPI } from "../../test-support/fake-extension-api"
import * as formatterModule from "../components/formatter/formatter"
import { createInitDeepAdvisorComponent } from "../components/init-deep-advisor"
import { createLspComponent } from "../components/lsp"
import { composeOmoSenpiExtension } from "./compose"
import { deferUntilAfterFirstPaint } from "./startup-deferral"
import type { ComponentContext, ComponentLogger, OmoSenpiComponent } from "./types"

const LSP_TOOL_NAMES = [
  "lsp_diagnostics",
  "lsp_find_references",
  "lsp_goto_definition",
  "lsp_prepare_rename",
  "lsp_rename",
  "lsp_symbols",
] as const

const silentLogger: ComponentLogger = { info: () => {}, warn: () => {}, error: () => {} }

function componentContext(pi: FakeExtensionAPI): ComponentContext {
  return { logger: silentLogger, config: { getFlag: (name) => pi.getFlag(name) } }
}

function toolNames(pi: FakeExtensionAPI): string[] {
  return pi.tools.map((tool) => String(tool["name"])).sort()
}

function mutationToolResult(): Record<string, unknown> {
  return {
    toolCallId: "call-1",
    toolName: "edit",
    input: { filePath: "/repo/a.ts" },
    content: [],
    isError: false,
  }
}

function inertFormatter(): ReturnType<typeof formatterModule.createFormatterStep> {
  return async () => ({ content: undefined, error: undefined })
}

type Scheduled = { readonly run: () => void; cancelled: boolean }

function recordingScheduler(scheduled: Scheduled[]): (run: () => void) => () => void {
  return (run) => {
    const entry: Scheduled = { run, cancelled: false }
    scheduled.push(entry)
    return () => {
      entry.cancelled = true
    }
  }
}

afterEach(() => {
  mock.restore()
})

describe("deferred startup construction", () => {
  it("#given a session that never yields a tool result #when the lsp component registers #then its formatter is never constructed and the tool surface is complete", () => {
    // given
    const createFormatterStep = spyOn(formatterModule, "createFormatterStep")
    const pi = new FakeExtensionAPI()

    // when
    createLspComponent().register(pi, componentContext(pi))

    // then
    expect(createFormatterStep).not.toHaveBeenCalled()
    expect(toolNames(pi)).toEqual([...LSP_TOOL_NAMES])
    expect([...new Set(pi.handlers.map((handler) => handler.event))].sort()).toEqual([
      "session_compact",
      "session_shutdown",
      "session_start",
      "tool_result",
    ])
  })

  it("#given a registered lsp component #when mutation tool results arrive #then the formatter is constructed once and reused", async () => {
    // given
    const createFormatterStep = spyOn(formatterModule, "createFormatterStep").mockImplementation(inertFormatter)
    const pi = new FakeExtensionAPI()
    createLspComponent().register(pi, componentContext(pi))
    pi.setFlag("omo-senpi-lsp-post-edit-diagnostics-enabled", false)

    // when
    await pi.dispatch("tool_result", mutationToolResult(), undefined)
    await pi.dispatch("tool_result", mutationToolResult(), undefined)

    // then
    expect(createFormatterStep).toHaveBeenCalledTimes(1)
  })
})

describe("deferred session_start work", () => {
  it("#given a component that defers startup work #when session_start fires #then the work runs on the scheduled tick and not on the dispatch path", async () => {
    // given
    const scheduled: Scheduled[] = []
    const pi = new FakeExtensionAPI()
    let ran = 0
    const probe: OmoSenpiComponent = {
      name: "probe",
      register(api, ctx) {
        api.registerTool({ name: "probe_tool" })
        api.on("session_start", () => {
          deferUntilAfterFirstPaint(ctx, "probe", () => {
            ran += 1
          })
        })
      },
    }

    // when
    await composeOmoSenpiExtension([probe], {
      logger: silentLogger,
      scheduleStartupWork: recordingScheduler(scheduled),
    })(pi)
    await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, { ui: {} })

    // then
    expect(toolNames(pi)).toEqual(["probe_tool"])
    expect(ran).toBe(0)
    expect(scheduled).toHaveLength(1)

    // when
    scheduled[0]?.run()

    // then
    expect(ran).toBe(1)
  })

  it("#given deferred startup work #when the session shuts down before its tick #then the pending work is cancelled", async () => {
    // given
    const scheduled: Scheduled[] = []
    const pi = new FakeExtensionAPI()
    let ran = 0
    const probe: OmoSenpiComponent = {
      name: "probe",
      register(_api, ctx) {
        _api.on("session_start", () => {
          deferUntilAfterFirstPaint(ctx, "probe", () => {
            ran += 1
          })
        })
      },
    }
    await composeOmoSenpiExtension([probe], {
      logger: silentLogger,
      scheduleStartupWork: recordingScheduler(scheduled),
    })(pi)
    await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, { ui: {} })

    // when
    await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, undefined)
    scheduled[0]?.run()

    // then
    expect(scheduled[0]?.cancelled).toBe(true)
    expect(ran).toBe(0)
  })

  it("#given the production first-paint gate #when session_start fires #then the work waits for the first post-paint edge", async () => {
    // given
    const pi = new FakeExtensionAPI()
    let ran = 0
    const probe: OmoSenpiComponent = {
      name: "probe",
      register(api, ctx) {
        api.on("session_start", () => {
          deferUntilAfterFirstPaint(ctx, "probe", () => {
            ran += 1
          })
        })
      },
    }
    await composeOmoSenpiExtension([probe], { logger: silentLogger })(pi)

    expect(pi.handlers.find((registration) => registration.event === "before_agent_start")?.options).toEqual({ previewSafe: true })

    // when
    await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, { ui: {} })

    // then
    expect(ran).toBe(0)

    // when
    await pi.dispatch("before_agent_start", { type: "before_agent_start", preview: true }, { ui: {} })

    // then
    expect(ran).toBe(0)

    // when
    await pi.dispatch("before_agent_start", { type: "before_agent_start" }, { ui: {} })

    // then
    expect(ran).toBe(1)
  })

  it("#given the init-deep advisor #when session_start fires #then its preflight is scheduled instead of running on the dispatch path", async () => {
    // given
    const scheduled: Scheduled[] = []
    const pi = new FakeExtensionAPI()
    let advisorRuns = 0
    const advisor = createInitDeepAdvisorComponent({
      runAfterPreflight: async () => {
        advisorRuns += 1
      },
    })

    // when
    await composeOmoSenpiExtension([advisor], {
      logger: silentLogger,
      scheduleStartupWork: recordingScheduler(scheduled),
    })(pi)
    await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, { ui: {}, hasUI: false })

    // then
    expect(advisorRuns).toBe(0)
    expect(scheduled).toHaveLength(1)
  })
})
