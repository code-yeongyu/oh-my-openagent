import { afterEach, describe, expect, test } from "bun:test"
import { AsyncLocalStorage, AsyncResource } from "node:async_hooks"
import { mkdtempSync } from "node:fs"
import { join } from "node:path"

import { createGatewayStore } from "../gateway/store"
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

describe("the wake's process scope", () => {
  // #13457's MEDIUM: the wake runtime loads through its sidecar from a session_start handler or a send, so a scope
  // created inside the sidecar would inherit the first importing session's handle ledger. component.ts captures it at
  // omo.js's module top level and passes it here; a direct caller's scope must be the one the carrier starts in.
  test("#given a caller-supplied process scope #when the wake starts #then the carrier starts inside that scope", async () => {
    const agentDir = mkdtempSync("/tmp/omo-wake-scope-")
    const latch: ThreadWakeLatch = {}
    latches.push(latch)
    const store = createGatewayStore({ agentDir })
    const runs: number[] = []
    const scope = {
      runInAsyncScope: <T>(fn: () => T): T => {
        runs.push(1)
        return fn()
      },
    }
    const options: ThreadWakeOptions = {
      env: { HOME: agentDir },
      latch,
      store,
      engineVersion: "2026.12.1",
      minimumEngine: "2026.12.1",
      connect: () => Promise.reject(new Error("no carrier may open a session")),
      schedule: () => () => undefined,
    }
    startThreadWakeAtSession({ mode: "tui" }, {
      options,
      agentDir: () => agentDir,
      sessionsDirectory: () => join(agentDir, "sessions"),
      settings: () => ({ sameDevice: true, wakeLimit: 0 }),
      engineVersion: "2026.12.1",
      ensureHost: undefined,
      warn: () => undefined,
      scope,
    })
    const running = latch.running?.get(agentDir)
    expect(running).toBeDefined()
    expect(runs.length).toBe(1)
    await running?.stop()
  })

  // #13456's MEDIUM M1: a send's wake reaches the carrier from the sending session's handler, so the renewal timer and
  // the woken session's connection it creates would land in that session's handle ledger and be reclaimed at its
  // shutdown. The wake must run in the process scope, as the carrier's start does.
  test("#given a wake started in a process scope #when a sending session's handler wakes a session #then the carrier's renewal timer is created in the process scope, not the sender's", async () => {
    const agentDir = mkdtempSync("/tmp/omo-wake-scope-")
    const latch: ThreadWakeLatch = {}
    latches.push(latch)
    const store = createGatewayStore({ agentDir })
    const context = new AsyncLocalStorage<string>()
    const resource = context.run("process", () => new AsyncResource("omo-thread-wake-carrier-test"))
    const scheduledIn: (string | undefined)[] = []
    const options: ThreadWakeOptions = {
      env: { HOME: agentDir },
      latch,
      store,
      engineVersion: "2026.12.1",
      minimumEngine: "2026.12.1",
      connect: () => Promise.reject(new Error("no carrier may open a session")),
      schedule: () => {
        scheduledIn.push(context.getStore())
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
      scope: { runInAsyncScope: (fn) => resource.runInAsyncScope(fn) },
    })
    const running = latch.running?.get(agentDir)
    expect(running).toBeDefined()
    await running?.ready
    await context.run("sessionA-send", () => running?.wake("0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"))
    expect(scheduledIn).toEqual(["process"])
    await running?.stop()
  })
})
