import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { join } from "node:path"

import { startThreadWakeAtSession, wakeHostIdleExitMs, type ThreadWakeLatch, type ThreadWakeOptions } from "./runtime"

// #13455's MEDIUM and its delta review: a carrier that carries nothing arms no sweep timer (design A3.1.4: an empty
// wake table leaves no timer), and the one read it makes at its start to learn that arms nothing either.

const latches: ThreadWakeLatch[] = []
afterEach(() => {
  latches.splice(0)
})

describe("the ensured host's idle-exit setting", () => {
  test("#given a configuration the loader cannot read #when the idle exit is asked for #then the failure is warned once per read and the spec's default runs", async () => {
    let broken = true
    const warnings: string[] = []
    const read = wakeHostIdleExitMs(
      {
        loadConfig: () => {
          if (broken) throw new Error("the configuration is broken")
          return { config: { task: { host_idle_exit_ms: 120_000 } } }
        },
      },
      () => process.cwd(),
      (line) => {
        warnings.push(line)
      },
    )
    expect(read()).toBeUndefined()
    expect(warnings).toHaveLength(1)
    broken = false
    expect(read()).toBe(120_000)
    expect(warnings).toHaveLength(1)
  })
})

describe("a running wake over an empty wake table", () => {
  test("#given an engine at the wake minimum and an empty wake table #when the wake starts #then no sweep timer is armed", async () => {
    const agentDir = mkdtempSync("/tmp/omo-wake-runtime-")
    const latch: ThreadWakeLatch = {}
    latches.push(latch)
    const scheduled: number[] = []
    const options: ThreadWakeOptions = {
      env: { HOME: agentDir },
      latch,
      engineVersion: "2026.12.1",
      minimumEngine: "2026.12.1",
      connect: () => Promise.reject(new Error("no carrier may open a session")),
      schedule: (_run, ms) => {
        scheduled.push(ms)
        return () => undefined
      },
    }
    startThreadWakeAtSession({ mode: "tui" }, {
      options,
      agentDir: () => agentDir,
      sessionsDirectory: () => join(agentDir, "sessions"),
      settings: () => ({ sameDevice: true, wakeLimit: 0 }),
      engineVersion: "2026.12.1",
      ensureHost: undefined,
      warn: () => undefined,
    })
    const running = latch.running?.get(agentDir)
    expect(running).toBeDefined()
    await running?.ready
    expect(scheduled).toEqual([])
    await running?.stop()
  })
})
