import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  ONBOARDING_STATE_COMPLETE_RPC_METHOD,
  ONBOARDING_STATE_GET_RPC_METHOD,
  ONBOARDING_STATE_RESET_RPC_METHOD,
  type OnboardingStateResponse,
} from "./state-rpc"
import { createOnboardingHarness, type ClaimOwnerSeams } from "./test-harness"
import * as state from "./state"

const dirs: string[] = []
afterEach(() => {
  Reflect.deleteProperty(globalThis, Symbol.for("omo.onboard"))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-onboarding-state-rpc-"))
  dirs.push(dir)
  return dir
}

function onboardingContexts(results: readonly unknown[]): number {
  return results.filter((result) => typeof result === "object" && result !== null && "message" in result).length
}

// Protocol contract (#10481): one completion flag, `onboarding/state.ts`, shared by the TUI and RPC clients.
describe("omo.onboarding.state.*", () => {
  test("#given a fresh install #when an RPC client completes onboarding #then the TUI never claims it again", async () => {
    const dir = stateDir()
    const desktop = createOnboardingHarness(dir, "desktop", "rpc")
    expect(await desktop.rpc(ONBOARDING_STATE_GET_RPC_METHOD)).toEqual({ completed: false, completedAt: null, inProgress: false })

    const completed = await desktop.rpc(ONBOARDING_STATE_COMPLETE_RPC_METHOD) as OnboardingStateResponse
    expect(completed.completed).toBe(true)
    expect(typeof completed.completedAt).toBe("string")
    expect(state.isOnboardingComplete(dir)).toBe(true)

    const tui = createOnboardingHarness(dir, "tui", "tui")
    await tui.start()
    expect(onboardingContexts(await tui.prompt())).toBe(0)
    expect(tui.widgets.has("omo-onboarding")).toBe(false)
  })

  test("#given the TUI claimed onboarding #when an RPC client reads the state mid-turn #then it reports in progress, and completed only once the turn finished", async () => {
    const dir = stateDir()
    const tui = createOnboardingHarness(dir, "tui", "tui")
    expect(onboardingContexts(await tui.prompt())).toBe(1)
    await tui.agentStart()

    expect(await tui.rpc(ONBOARDING_STATE_GET_RPC_METHOD)).toEqual({ completed: false, completedAt: null, inProgress: true })

    await tui.end()
    await tui.settle()
    const read = await tui.rpc(ONBOARDING_STATE_GET_RPC_METHOD) as OnboardingStateResponse
    expect(read.completed).toBe(true)
    expect(read.inProgress).toBe(false)
    expect(Date.parse(read.completedAt ?? "")).not.toBeNaN()
  })

  test("#given the TUI holds the claim #when the desktop completes and the TUI turn then fails #then the completion survives the TUI's release", async () => {
    const dir = stateDir()
    const tui = createOnboardingHarness(dir, "tui", "tui")
    expect(onboardingContexts(await tui.prompt())).toBe(1)
    await tui.agentStart()

    const completed = await tui.rpc(ONBOARDING_STATE_COMPLETE_RPC_METHOD) as OnboardingStateResponse
    expect(completed.completed).toBe(true)

    await tui.end("error")
    expect(await tui.rpc(ONBOARDING_STATE_GET_RPC_METHOD)).toEqual({ ...completed, inProgress: false })
    expect(onboardingContexts(await createOnboardingHarness(dir, "next", "tui").prompt())).toBe(0)
  })

  test("#given a marker written by an older engine #when the state is read #then it still counts as completed", async () => {
    const dir = stateDir()
    writeFileSync(join(dir, "onboarding-completed"), JSON.stringify({ completedAt: "2026-09-01T00:00:00.000Z", version: 1 }))
    const desktop = createOnboardingHarness(dir, "desktop", "rpc")
    expect(await desktop.rpc(ONBOARDING_STATE_GET_RPC_METHOD)).toEqual({ completed: true, completedAt: "2026-09-01T00:00:00.000Z", inProgress: false })
  })

  test("#given this process finished onboarding #when an RPC client resets it #then the same process onboards again on its next prompt", async () => {
    const dir = stateDir()
    const tui = createOnboardingHarness(dir, "tui", "tui")
    expect(onboardingContexts(await tui.prompt())).toBe(1)
    await tui.agentStart()
    await tui.end()
    await tui.settle()

    expect(await tui.rpc(ONBOARDING_STATE_RESET_RPC_METHOD)).toEqual({ completed: false, completedAt: null, inProgress: false })
    tui.branch.length = 0
    expect(onboardingContexts(await tui.prompt())).toBe(1)
  })

  test("#given a completed onboarding #when an RPC client resets it #then the next TUI prompt onboards again", async () => {
    const dir = stateDir()
    state.claimOnboarding(dir)
    const desktop = createOnboardingHarness(dir, "desktop", "rpc")
    expect(await desktop.rpc(ONBOARDING_STATE_RESET_RPC_METHOD)).toEqual({ completed: false, completedAt: null, inProgress: false })

    const tui = createOnboardingHarness(dir, "tui", "tui")
    expect(onboardingContexts(await tui.prompt())).toBe(1)
  })

  test("#given an already completed onboarding #when complete is called again #then it stays completed with the first timestamp", async () => {
    const dir = stateDir()
    const desktop = createOnboardingHarness(dir, "desktop", "rpc")
    const first = await desktop.rpc(ONBOARDING_STATE_COMPLETE_RPC_METHOD) as OnboardingStateResponse
    const second = await desktop.rpc(ONBOARDING_STATE_COMPLETE_RPC_METHOD) as OnboardingStateResponse
    expect(second).toEqual(first)
  })
})

// A claim's owner (#10481 round 2): the claim marker records the claiming process (pid + start
// identity), so a claim left by a process that died mid-onboarding stops reporting in progress and
// can be taken over. Owners are simulated through injected identity readers.
describe("onboarding claim owner liveness", () => {
  const NOW = Date.parse("2026-10-19T00:00:00.000Z")
  const HOUR = 3_600_000
  const DEAD_TUI = 4242

  function seams(selfPid: number, alive: Record<number, string>, now = NOW): ClaimOwnerSeams {
    return {
      pid: selfPid,
      getPidLiveness: (pid) => (pid in alive ? "alive" : "dead"),
      getProcessStartIdentity: async (pid) => alive[pid] ?? null,
      now: () => now,
    }
  }

  function writeClaim(dir: string, owner?: { pid: number; processStart: string | null }, claimedAt = NOW): void {
    const record = { claimedAt: new Date(claimedAt).toISOString(), version: 2, ...(owner === undefined ? {} : { owner }) }
    writeFileSync(join(dir, "onboarding-completed"), JSON.stringify(record))
  }

  function claimOwnerPid(dir: string): unknown {
    const record = JSON.parse(readFileSync(join(dir, "onboarding-completed"), "utf8")) as { owner?: { pid?: unknown } }
    return record.owner?.pid
  }

  test("#given a claim whose owner process is gone #when the desktop reads the state #then it is not in progress", async () => {
    const dir = stateDir()
    writeClaim(dir, { pid: DEAD_TUI, processStart: "proc-start-epoch:100" })
    const desktop = createOnboardingHarness(dir, "desktop", "rpc", undefined, seams(5151, { 5151: "proc-start-epoch:500" }))
    expect(await desktop.rpc(ONBOARDING_STATE_GET_RPC_METHOD)).toEqual({ completed: false, completedAt: null, inProgress: false })
  })

  test("#given a claim whose owner process is gone #when a new TUI prompts #then it takes the claim over and onboards", async () => {
    const dir = stateDir()
    writeClaim(dir, { pid: DEAD_TUI, processStart: "proc-start-epoch:100" })
    const live = seams(5151, { 5151: "proc-start-epoch:500" })
    const tui = createOnboardingHarness(dir, "tui", "tui", undefined, live)
    expect(onboardingContexts(await tui.prompt())).toBe(1)
    expect(claimOwnerPid(dir)).toBe(5151)
    expect(await tui.rpc(ONBOARDING_STATE_GET_RPC_METHOD)).toEqual({ completed: false, completedAt: null, inProgress: true })
  })

  test("#given a dead claim #when the desktop completes #then completion is recorded and nothing is in progress", async () => {
    const dir = stateDir()
    writeClaim(dir, { pid: DEAD_TUI, processStart: "proc-start-epoch:100" })
    const desktop = createOnboardingHarness(dir, "desktop", "rpc", undefined, seams(5151, { 5151: "proc-start-epoch:500" }))
    const completed = await desktop.rpc(ONBOARDING_STATE_COMPLETE_RPC_METHOD) as OnboardingStateResponse
    expect(completed.completed).toBe(true)
    expect(completed.inProgress).toBe(false)
  })

  test("#given a claim whose owner is alive with the recorded start identity #when read and claimed #then it stays in progress and blocks", async () => {
    const dir = stateDir()
    writeClaim(dir, { pid: DEAD_TUI, processStart: "proc-start-epoch:100" })
    const live = seams(5151, { [DEAD_TUI]: "proc-start-epoch:100", 5151: "proc-start-epoch:500" })
    const tui = createOnboardingHarness(dir, "tui", "tui", undefined, live)
    expect(await tui.rpc(ONBOARDING_STATE_GET_RPC_METHOD)).toEqual({ completed: false, completedAt: null, inProgress: true })
    expect(onboardingContexts(await tui.prompt())).toBe(0)
    expect(claimOwnerPid(dir)).toBe(DEAD_TUI)
  })

  test("#given the owner pid was reused by another process #when read and claimed #then the claim counts as dead and is taken over", async () => {
    const dir = stateDir()
    writeClaim(dir, { pid: DEAD_TUI, processStart: "proc-start-epoch:100" })
    const reused = seams(5151, { [DEAD_TUI]: "proc-start-epoch:900", 5151: "proc-start-epoch:500" })
    const tui = createOnboardingHarness(dir, "tui", "tui", undefined, reused)
    expect(await tui.rpc(ONBOARDING_STATE_GET_RPC_METHOD)).toEqual({ completed: false, completedAt: null, inProgress: false })
    expect(onboardingContexts(await tui.prompt())).toBe(1)
    expect(claimOwnerPid(dir)).toBe(5151)
  })

  test("#given an ownerless claim from an older build #when it is younger than 24 hours #then it still blocks, and once older it is abandoned", async () => {
    const recent = stateDir()
    writeClaim(recent, undefined, NOW - HOUR)
    const recentTui = createOnboardingHarness(recent, "tui", "tui", undefined, seams(5151, { 5151: "proc-start-epoch:500" }))
    expect(await recentTui.rpc(ONBOARDING_STATE_GET_RPC_METHOD)).toEqual({ completed: false, completedAt: null, inProgress: true })
    expect(onboardingContexts(await recentTui.prompt())).toBe(0)

    const stale = stateDir()
    writeClaim(stale, undefined, NOW - 24 * HOUR)
    const staleTui = createOnboardingHarness(stale, "tui", "tui", undefined, seams(5151, { 5151: "proc-start-epoch:500" }))
    expect(await staleTui.rpc(ONBOARDING_STATE_GET_RPC_METHOD)).toEqual({ completed: false, completedAt: null, inProgress: false })
    expect(onboardingContexts(await staleTui.prompt())).toBe(1)
    expect(claimOwnerPid(stale)).toBe(5151)
  })

  test("#given a dead claim #when two processes claim at once #then exactly one takes it over", async () => {
    const dir = stateDir()
    writeClaim(dir, { pid: DEAD_TUI, processStart: "proc-start-epoch:100" })
    const alive = { 5151: "proc-start-epoch:500", 6161: "proc-start-epoch:600" }
    const first = createOnboardingHarness(dir, "first", "tui", undefined, seams(5151, alive))
    const second = createOnboardingHarness(dir, "second", "tui", undefined, seams(6161, alive))
    const [a, b] = await Promise.all([first.prompt(), second.prompt()])
    expect(onboardingContexts(a) + onboardingContexts(b)).toBe(1)
    expect([5151, 6161]).toContain(claimOwnerPid(dir) as number)
  })
})
