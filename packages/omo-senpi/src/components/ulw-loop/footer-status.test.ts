import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { dispatchRunEnd, FakeExtensionAPI } from "../../../test-support/fake-extension-api"
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
  readonly delays: number[]
  readonly now: () => number
  readonly fire: () => void
  readonly set: (callback: () => void, delayMs: number) => number
  readonly clear: (handle: number) => void
} {
  const callbacks = new Map<number, () => void>()
  const delays: number[] = []
  let nextHandle = 1
  let now = 0
  return {
    activeCount: () => callbacks.size,
    delays,
    now: () => now,
    fire: () => {
      now += 90
      for (const [handle, callback] of [...callbacks]) {
        if (callbacks.delete(handle)) callback()
      }
    },
    set: (callback, delayMs) => {
      delays.push(delayMs)
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
  const footerStatus = { isGoalActive: input.goalActive, timers: input.timers, now: input.timers.now }
  await createUlwLoopComponent({
    planExists: () => true,
    readStatus: async () => ({ code: 0, stdout: input.outputs.shift() ?? activeStatus() }),
    footerStatus,
  }).register(pi, {
    logger: input.logger ?? createLogger(),
    config: { getFlag: () => false },
  })
  return pi
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
  const footerStatus = { timers, now: timers.now }
  await createUlwLoopComponent({
    planExists: () => true,
    readStatus: async () => ({ code: 0, stdout: outputs.shift() ?? activeStatus() }),
    footerStatus,
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
  it("reads the project goal store and publishes the shared animation cycle", async () => {
    const scenario = await defaultFooterScenario("session-project-store")
    try {
      writeGoal(scenario.goalPath, "active")

      await scenario.pi.dispatch("session_start", { type: "session_start" }, scenario.context)
      for (let tick = 0; tick < 10; tick += 1) scenario.timers.fire()

      const frames = scenario.ui.calls.filter((call) => call.key === "ulw-loop").map((call) => call.text)
      expect(frames).toEqual([..."⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⠋"].map((glyph) => `⚡ ${glyph} ultraworking`))
      expect(scenario.timers.delays).toEqual(Array(11).fill(90))
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
      await dispatchRunEnd(
        scenario.pi,
        { type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] },
        scenario.context,
      )

      expect(scenario.ui.calls.at(-1)).toEqual({ key: "ulw-loop", text: undefined })
      expect(scenario.timers.activeCount()).toBe(0)
    } finally {
      scenario.cleanup()
    }
  })

  it("publishes animated ultraworking status only when goal and ulw-loop are active", async () => {
    const timers = fakeTimers()
    const ui = recordingUi()
    const lateUi = recordingUi()
    const pi = await registerFooterScenario({
      goalActive: () => true,
      outputs: [activeStatus()],
      timers,
    })
    const latePi = await registerFooterScenario({ goalActive: () => true, outputs: [activeStatus()], timers })

    await pi.dispatch("session_start", { type: "session_start" }, sessionEventCtx("/repo", { ui }))
    timers.fire()
    await latePi.dispatch("session_start", { type: "session_start" }, sessionEventCtx("/repo", { ui: lateUi }))

    expect(ui.calls.at(-1)).toEqual({ key: "ulw-loop", text: "⚡ ⠙ ultraworking" })
    expect(lateUi.calls).toEqual([{ key: "ulw-loop", text: "⚡ ⠙ ultraworking" }])
    expect(timers.activeCount()).toBe(2)
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
    await dispatchRunEnd(
      pi,
      { type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] },
      sessionEventCtx("/repo", { ui }),
    )
    expect(timers.activeCount()).toBe(1)

    await dispatchRunEnd(
      pi,
      { type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] },
      sessionEventCtx("/repo", { ui }),
    )
    expect(ui.calls.at(-1)).toEqual({ key: "ulw-loop", text: undefined })
    expect(timers.activeCount()).toBe(0)

    await pi.dispatch("session_shutdown", { type: "session_shutdown" }, sessionEventCtx("/repo", { ui }))
    expect(ui.calls.at(-1)).toEqual({ key: "ulw-loop", text: undefined })
    expect(timers.activeCount()).toBe(0)
  })

  it("#given an active footer #when the run ends on a blocked outcome #then the footer still syncs for the finished run", async () => {
    const timers = fakeTimers()
    const ui = recordingUi()
    const logger = createLogger()
    const pi = await registerFooterScenario({
      goalActive: () => true,
      outputs: [activeStatus(), completeStatus()],
      timers,
      logger,
    })

    await dispatchRunEnd(
      pi,
      { type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] },
      sessionEventCtx("/repo", { ui }),
    )
    expect(timers.activeCount()).toBe(1)

    // Esc right after the last goal completed: no continuation, and no tool_result will arrive to
    // refresh the footer either, so this run's own probe is the only thing that can clear it.
    await dispatchRunEnd(
      pi,
      { type: "agent_end", aborted: true, abortSource: "user", messages: [{ role: "assistant", stopReason: "stop" }] },
      sessionEventCtx("/repo", { ui }),
    )

    expect(pi.messages).toHaveLength(1)
    expect(ui.calls.at(-1)).toEqual({ key: "ulw-loop", text: undefined })
    expect(timers.activeCount()).toBe(0)
    expect(logger.entries).toContainEqual({
      level: "info",
      message: "omo-senpi ulw-loop continuation skipped",
      details: {
        reason: "terminal-outcome",
        blockedBy: "aborted",
        stopReason: "stop",
        aborted: true,
        willRetry: false,
      },
    })
  })

  it("keeps continuation and headless paths unchanged", async () => {
    const timers = fakeTimers()
    const ui = recordingUi()
    const pi = await registerFooterScenario({
      goalActive: () => true,
      outputs: [activeStatus()],
      timers,
    })

    await dispatchRunEnd(
      pi,
      { type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] },
      sessionEventCtx("/repo", { ui }),
    )
    expect(pi.messages).toHaveLength(1)
    expect(pi.messages[0]?.message["customType"]).toBe("omo-senpi:ulw-continuation")
    expect(ui.calls).toContainEqual({ key: "ulw-loop", text: "⚡ ⠋ ultraworking" })

    const headlessTimers = fakeTimers()
    const headlessPi = await registerFooterScenario({
      goalActive: () => true,
      outputs: [activeStatus()],
      timers: headlessTimers,
    })
    await expect(
      dispatchRunEnd(
        headlessPi,
        { type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] },
        sessionEventCtx("/repo"),
      ),
    ).resolves.toHaveLength(1)
    expect(headlessPi.messages).toHaveLength(1)
    expect(headlessTimers.activeCount()).toBe(0)
  })
})
