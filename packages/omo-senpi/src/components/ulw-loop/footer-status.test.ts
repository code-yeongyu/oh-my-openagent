import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentLogger } from "../../extension/types"
import { createUlwLoopComponent } from "./index"
import { activeStatus, completeStatus, createLogger } from "./ulw-loop.test-support"

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

describe("omo-senpi ulw-loop footer status", () => {
  it("publishes animated ultraworking status only when goal and ulw-loop are active", async () => {
    const timers = fakeTimers()
    const ui = recordingUi()
    const pi = await registerFooterScenario({
      goalActive: () => true,
      outputs: [activeStatus()],
      timers,
    })

    await pi.dispatch("session_start", { type: "session_start" }, { cwd: "/repo", ui })
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

    await pi.dispatch("session_start", { type: "session_start" }, { cwd: "/repo", ui })
    expect(ui.calls).toHaveLength(0)

    goalActive = true
    await pi.dispatch("agent_end", { type: "agent_end" }, { cwd: "/repo", ui })
    expect(timers.activeCount()).toBe(1)

    await pi.dispatch("agent_end", { type: "agent_end" }, { cwd: "/repo", ui })
    expect(ui.calls.at(-1)).toEqual({ key: "ulw-loop", text: undefined })
    expect(timers.activeCount()).toBe(0)

    await pi.dispatch("session_shutdown", { type: "session_shutdown" }, { cwd: "/repo", ui })
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

    await pi.dispatch("agent_end", { type: "agent_end" }, { cwd: "/repo", ui })
    expect(pi.messages).toHaveLength(1)
    expect(pi.messages[0]?.message["customType"]).toBe("omo-senpi:ulw-continuation")
    expect(ui.calls.some((call) => call.key === "ulw-loop" && visibleFrame(call.text) === "⚡ ultraworking")).toBe(true)

    const headlessTimers = fakeTimers()
    const headlessPi = await registerFooterScenario({
      goalActive: () => true,
      outputs: [activeStatus()],
      timers: headlessTimers,
    })
    await expect(headlessPi.dispatch("agent_end", { type: "agent_end" }, { cwd: "/repo" })).resolves.toHaveLength(1)
    expect(headlessPi.messages).toHaveLength(1)
    expect(headlessTimers.activeCount()).toBe(0)
  })
})
