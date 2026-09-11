import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { ULW_LOOP_FOOTER_FRAMES } from "./footer-status"
import { createUlwLoopComponent } from "./index"
import { activeStatus, createLogger } from "./ulw-loop.test-support"

type StatusCall = {
  readonly key: string
  readonly text: string | undefined
}

type FooterScenario = {
  readonly cwd: string
  readonly scopedGoalsPath: string
  readonly ui: {
    readonly calls: StatusCall[]
  }
  readonly pi: FakeExtensionAPI
  readonly timers: ReturnType<typeof fakeTimers>
  readonly cleanup: () => void
}

function fakeTimers(): {
  readonly fire: () => void
  readonly set: (callback: () => void, intervalMs: number) => number
  readonly clear: (handle: number) => void
} {
  const callbacks = new Map<number, () => void>()
  let nextHandle = 1
  return {
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

async function createFooterScenario(sessionId: string): Promise<FooterScenario> {
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-footer-realfs-"))
  const cwd = join(root, "project")
  const scopedGoalsPath = join(cwd, ".omo", "ulw-loop", sessionId, "goals.json")
  const activeGoalPath = join(cwd, ".omo", "goal", `${encodeURIComponent(sessionId)}.json`)
  mkdirSync(join(cwd, ".omo", "ulw-loop", sessionId), { recursive: true })
  mkdirSync(join(cwd, ".omo", "goal"), { recursive: true })
  writeFileSync(activeGoalPath, '{"version":1,"goal":{"status":"active"}}\n')

  const timers = fakeTimers()
  const calls: StatusCall[] = []
  const pi = new FakeExtensionAPI()
  await createUlwLoopComponent({
    resolveOmoBin: () => "/tmp/omo",
    runCommand: async () => ({ code: 0, stdout: activeStatus() }),
    footerStatus: { timers },
  }).register(pi, {
    logger: createLogger(),
    config: { getFlag: () => false },
  })

  return {
    cwd,
    scopedGoalsPath,
    ui: { calls },
    pi,
    timers,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

function eventContext(cwd: string, sessionId: string, ui: { calls: StatusCall[] }): Record<string, unknown> {
  return {
    cwd,
    ui: {
      setStatus(key: string, text: string | undefined) {
        ui.calls.push({ key, text })
      },
    },
    sessionManager: {
      getSessionId: () => sessionId,
    },
  }
}

function footerFrames(ui: { calls: StatusCall[] }): readonly (string | undefined)[] {
  return ui.calls.filter((call) => call.key === "ulw-loop").map((call) => call.text)
}

describe("omo-senpi ulw-loop footer real filesystem plan lookup", () => {
  it("publishes every footer frame when the scoped plan and active goal store exist", async () => {
    const sessionId = "realfs-positive"
    const scenario = await createFooterScenario(sessionId)
    try {
      writeFileSync(scenario.scopedGoalsPath, "{}\n")

      await scenario.pi.dispatch("session_start", { type: "session_start" }, eventContext(scenario.cwd, sessionId, scenario.ui))
      scenario.timers.fire()
      scenario.timers.fire()
      scenario.timers.fire()

      expect(footerFrames(scenario.ui)).toEqual(ULW_LOOP_FOOTER_FRAMES)
    } finally {
      scenario.cleanup()
    }
  })

  it("does not publish frames for an unscoped plan", async () => {
    const sessionId = "realfs-unscoped"
    const scenario = await createFooterScenario(sessionId)
    try {
      mkdirSync(join(scenario.cwd, ".omo", "ulw-loop"), { recursive: true })
      writeFileSync(join(scenario.cwd, ".omo", "ulw-loop", "goals.json"), "{}\n")

      await scenario.pi.dispatch("session_start", { type: "session_start" }, eventContext(scenario.cwd, sessionId, scenario.ui))
      scenario.timers.fire()

      expect(footerFrames(scenario.ui)).toEqual([])
    } finally {
      scenario.cleanup()
    }
  })

  it("does not publish frames for a differently named scoped plan", async () => {
    const sessionId = "realfs-session"
    const scenario = await createFooterScenario(sessionId)
    try {
      mkdirSync(join(scenario.cwd, ".omo", "ulw-loop", "other-name"), { recursive: true })
      writeFileSync(join(scenario.cwd, ".omo", "ulw-loop", "other-name", "goals.json"), "{}\n")

      await scenario.pi.dispatch("session_start", { type: "session_start" }, eventContext(scenario.cwd, sessionId, scenario.ui))
      scenario.timers.fire()

      expect(footerFrames(scenario.ui)).toEqual([])
    } finally {
      scenario.cleanup()
    }
  })
})
