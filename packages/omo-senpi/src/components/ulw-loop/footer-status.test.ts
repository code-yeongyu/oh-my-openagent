import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentLogger } from "../../extension/types"
import { createUlwLoopComponent } from "./index"
import { activeStatus, completeStatus, createLogger, sessionEventCtx } from "./ulw-loop.test-support"

type StatusCall = {
  readonly key: string
  readonly text: string | undefined
}

function recordingUi(): {
  readonly calls: StatusCall[]
  readonly setStatus: (key: string, text: string | undefined) => void
} {
  const calls: StatusCall[] = []
  return {
    calls,
    setStatus: (key, text) => calls.push({ key, text }),
  }
}

function fakeTimers(): {
  readonly activeCount: () => number
  readonly fire: () => void
  readonly set: (callback: () => void, intervalMs: number) => number
  readonly clear: (handle: number) => void
} {
  const callbacks = new Map<number, () => void>()
  let nextHandle = 1
  return {
    activeCount: () => callbacks.size,
    fire: () => {
      for (const callback of [...callbacks.values()]) callback()
    },
    set: (callback, _intervalMs) => {
      const handle = nextHandle
      nextHandle += 1
      callbacks.set(handle, callback)
      return handle
    },
    clear: (handle) => {
      callbacks.delete(handle)
    },
  }
}

async function registerFooterScenario(input: {
  readonly goalActive: () => boolean
  readonly outputs: string[]
  readonly timers: ReturnType<typeof fakeTimers>
  readonly logger?: ComponentLogger
}): Promise<FakeExtensionAPI> {
  const pi = new FakeExtensionAPI()
  await createUlwLoopComponent({
    resolveOmoBin: () => "/tmp/omo",
    planExists: () => true,
    runCommand: async () => ({ code: 0, stdout: input.outputs.shift() ?? activeStatus() }),
    footerStatus: {
      isGoalActive: input.goalActive,
      timers: input.timers,
    },
  }).register(pi, {
    logger: input.logger ?? createLogger(),
    config: { getFlag: () => false },
  })
  return pi
}

function visibleFrame(text: string | undefined): string | undefined {
  return text?.replaceAll("\u2800", "")
}

async function defaultFooterScenario(sessionId: string, outputs = [activeStatus(), activeStatus()]) {
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-footer-"))
  const cwd = join(root, "project")
  const sessionDir = join(root, "session")
  const goalDir = join(cwd, ".omo", "goal")
  mkdirSync(goalDir, { recursive: true })
  mkdirSync(sessionDir, { recursive: true })
  const timers = fakeTimers()
  const ui = recordingUi()
  const pi = new FakeExtensionAPI()
  await createUlwLoopComponent({
    resolveOmoBin: () => "/tmp/omo",
    planExists: () => true,
    runCommand: async () => ({ code: 0, stdout: outputs.shift() ?? activeStatus() }),
    footerStatus: { timers },
  }).register(pi, {
    logger: createLogger(),
    config: { getFlag: () => false },
  })
  return {
    context: {
      cwd,
      ui,
      sessionManager: {
        getSessionFile: () => join(sessionDir, "session.json"),
        getSessionDir: () => sessionDir,
        getSessionId: () => sessionId,
      },
    },
    goalPath: join(goalDir, `${encodeURIComponent(sessionId)}.json`),
    pi,
    timers,
    ui,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

function writeGoal(path: string, status: "active" | "complete"): void {
  writeFileSync(path, `${JSON.stringify({ version: 1, goal: { status } })}\n`)
}

describe("omo-senpi ulw-loop footer status", () => {
  it("reads the project goal store and publishes all four animation frames", async () => {
    const scenario = await defaultFooterScenario("session-project-store")
    try {
      writeGoal(scenario.goalPath, "active")

      await scenario.pi.dispatch("session_start", { type: "session_start" }, scenario.context)
      scenario.timers.fire()
      scenario.timers.fire()
      scenario.timers.fire()

      const frames = scenario.ui.calls.filter((call) => call.key === "ulw-loop").map((call) => call.text)
      expect(frames.map(visibleFrame)).toEqual([
        "⚡ ultraworking",
        "⚡ ultraworking.",
        "⚡ ultraworking..",
        "⚡ ultraworking...",
      ])
      expect(scenario.timers.activeCount()).toBe(1)
    } finally {
      scenario.cleanup()
    }
  })

  it("uses an encoded session id and clears when the project goal completes", async () => {
    const scenario = await defaultFooterScenario("session/encoded")
    try {
      expect(scenario.goalPath).toEndWith("session%2Fencoded.json")
      writeGoal(scenario.goalPath, "active")

      await scenario.pi.dispatch("session_start", { type: "session_start" }, scenario.context)
      expect(scenario.ui.calls.some((call) => call.key === "ulw-loop" && call.text !== undefined)).toBe(true)

      writeGoal(scenario.goalPath, "complete")
      await scenario.pi.dispatch("agent_end", { type: "agent_end" }, scenario.context)

      expect(scenario.ui.calls.at(-1)).toEqual({ key: "ulw-loop", text: undefined })
      expect(scenario.timers.activeCount()).toBe(0)
    } finally {
      scenario.cleanup()
    }
  })

  it("publishes animated ultraworking status only when goal and ulw-loop are active", async () => {
    const timers = fakeTimers()
    const ui = recordingUi()
    const pi = await registerFooterScenario({
      goalActive: () => true,
      outputs: [activeStatus()],
      timers,
    })

    await pi.dispatch("session_start", { type: "session_start" }, sessionEventCtx("/repo", { ui }))
    timers.fire()
    timers.fire()
    timers.fire()

    const frames = ui.calls.filter((call) => call.key === "ulw-loop").map((call) => call.text)
    expect(frames.map(visibleFrame)).toEqual([
      "⚡ ultraworking",
      "⚡ ultraworking.",
      "⚡ ultraworking..",
      "⚡ ultraworking...",
    ])
    expect(new Set(frames.map((frame) => frame?.length)).size).toBe(1)
    expect(timers.activeCount()).toBe(1)
  })

  it("clears the indicator when either activation ends", async () => {
    let goalActive = false
    const timers = fakeTimers()
    const ui = recordingUi()
    const pi = await registerFooterScenario({
      goalActive: () => goalActive,
      outputs: [activeStatus(), activeStatus(), completeStatus()],
      timers,
    })

    await pi.dispatch("session_start", { type: "session_start" }, sessionEventCtx("/repo", { ui }))
    expect(ui.calls).toHaveLength(0)

    goalActive = true
    await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo", { ui }))
    expect(timers.activeCount()).toBe(1)

    await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo", { ui }))
    expect(ui.calls.at(-1)).toEqual({ key: "ulw-loop", text: undefined })
    expect(timers.activeCount()).toBe(0)

    await pi.dispatch("session_shutdown", { type: "session_shutdown" }, sessionEventCtx("/repo", { ui }))
    expect(ui.calls.at(-1)).toEqual({ key: "ulw-loop", text: undefined })
    expect(timers.activeCount()).toBe(0)
  })

  it("keeps continuation and headless paths unchanged", async () => {
    const timers = fakeTimers()
    const ui = recordingUi()
    const pi = await registerFooterScenario({
      goalActive: () => true,
      outputs: [activeStatus()],
      timers,
    })

    await pi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo", { ui }))
    expect(pi.messages).toHaveLength(1)
    expect(pi.messages[0]?.message["customType"]).toBe("omo-senpi:ulw-continuation")
    expect(ui.calls.some((call) => call.key === "ulw-loop" && visibleFrame(call.text) === "⚡ ultraworking")).toBe(true)

    const headlessTimers = fakeTimers()
    const headlessPi = await registerFooterScenario({
      goalActive: () => true,
      outputs: [activeStatus()],
      timers: headlessTimers,
    })
    await expect(headlessPi.dispatch("agent_end", { type: "agent_end" }, sessionEventCtx("/repo"))).resolves.toHaveLength(1)
    expect(headlessPi.messages).toHaveLength(1)
    expect(headlessTimers.activeCount()).toBe(0)
  })
})
