import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { join } from "node:path"

import { createGatewayStore } from "../gateway/store"
import { startThreadWakeAtSession, type ThreadWakeLatch, type ThreadWakeOptions } from "./runtime"

// #13455's MEDIUM and its delta review: a carrier that carries nothing arms no sweep timer (design A3.1.4: an empty
// wake table leaves no timer), and the one read it makes at its start to learn that arms nothing either.

const latches: ThreadWakeLatch[] = []
afterEach(() => {
  latches.splice(0)
})

describe("a running wake over an empty wake table", () => {
  test("#given an engine at the wake minimum and an empty wake table #when the wake starts and its start read has settled #then no sweep timer is armed", async () => {
    const agentDir = mkdtempSync("/tmp/omo-wake-runtime-")
    const latch: ThreadWakeLatch = {}
    latches.push(latch)
    const scheduled: number[] = []
    const store = createGatewayStore({ agentDir })
    const options: ThreadWakeOptions = {
      env: { HOME: agentDir },
      latch,
      store,
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
    // The carrier's own start read queued before any list of ours, and the store serialises its reads, so once this
    // one settles the start read has settled too - the assertion below can no longer race it (#13455's nit).
    await store.woken.list()
    expect(scheduled).toEqual([])
    await running?.stop()
  })
})
