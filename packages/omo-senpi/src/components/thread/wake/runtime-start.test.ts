import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync } from "node:fs"
import { join } from "node:path"

import { gatewayDatabasePath } from "../gateway/paths"
import { startThreadWakeAtSession, type ThreadWakeLatch, type ThreadWakeOptions } from "./runtime"

// #13455's second MEDIUM: a carrier that carries nothing arms no sweep timer and opens no store of its own (design
// A3.1.4: an empty wake table leaves no timer; the component's own store serves the carrier when there is work).

const latches: ThreadWakeLatch[] = []
afterEach(() => {
  latches.splice(0)
})

describe("a running wake over an empty wake table", () => {
  test("#given an engine at the wake minimum and no store handed to it #when the wake starts #then no store is opened and no timer is armed", async () => {
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
    expect(existsSync(gatewayDatabasePath(agentDir))).toBe(false)
    await running?.stop()
  })
})
