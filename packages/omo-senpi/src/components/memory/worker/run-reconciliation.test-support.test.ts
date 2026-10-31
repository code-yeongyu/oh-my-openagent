import { afterEach, describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"

import { createNodeGitExec } from "@oh-my-opencode/memory-core"

import { cleanupReconciliationFixtures, PHASE_IDLE_MS, withinPhase } from "./run-reconciliation.test-support"

afterEach(cleanupReconciliationFixtures)

describe("withinPhase", () => {
  test("#given a phase parked on a promise that never settles #when the idle window passes #then it fails naming the phase", async () => {
    // when
    const parked = withinPhase("parked-phase", () => new Promise<never>(() => {}))

    // then
    expect(String(await parked.then(() => undefined, (error: unknown) => error))).toContain("parked-phase stalled: no git progress")
  }, 30_000)

  test("#given one git process that outlasts the idle window #when the phase runs #then it is not reported stalled", async () => {
    // given: the slowness is the behavior under test, so the git child sleeps past the window
    const seconds = Math.ceil(PHASE_IDLE_MS / 1_000) + 1
    const exec = createNodeGitExec()

    // when
    const result = await withinPhase("slow-git", () => exec.run(
      ["-c", `alias.slow=!sleep ${seconds}`, "slow"],
      { cwd: tmpdir(), timeoutMs: 60_000 },
    ))

    // then
    expect(result.code).toBe(0)
  }, 60_000)

  test("#given a phase was entered #when git starts in the same tick #then that git counts as progress", async () => {
    // given: the git child sleeps past the window, so only its trace keeps the phase alive
    const seconds = Math.ceil(PHASE_IDLE_MS / 1_000) + 1
    const exited = Promise.withResolvers<number | null>()

    // when
    const phase = withinPhase("same-tick-git", () => exited.promise)
    const git = spawn("git", ["-c", `alias.slow=!sleep ${seconds}`, "slow"], { cwd: tmpdir(), stdio: "ignore", windowsHide: true })
    git.on("exit", (code) => exited.resolve(code))

    // then
    expect(await phase).toBe(0)
  }, 60_000)

  test("#given a git process killed before it recorded its end #when the phase then parks #then it still fails naming the phase", async () => {
    // given: SIGKILL leaves the trace without an exit event, like the killGraceMs path in memory-core's exec
    const seconds = Math.ceil(PHASE_IDLE_MS / 1_000) + 1

    // when
    const parked = withinPhase("killed-git", async () => {
      const git = spawn("git", ["-c", `alias.slow=!echo ready; sleep ${seconds}`, "slow"], {
        cwd: tmpdir(), stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
      })
      const ready = Promise.withResolvers<void>()
      const exited = Promise.withResolvers<void>()
      git.stdout.once("data", () => ready.resolve())
      git.on("exit", () => exited.resolve())
      await ready.promise
      git.kill("SIGKILL")
      await exited.promise
      return await new Promise<never>(() => {})
    })

    // then
    expect(String(await parked.then(() => undefined, (error: unknown) => error))).toContain("killed-git stalled: no git progress")
  }, 60_000)

  test("#given the trace directory disappears mid-phase #when the watchdog checks #then the phase rejects with that error", async () => {
    // when
    const phase = withinPhase("vanished-trace", async () => {
      const dir = process.env.GIT_TRACE2_EVENT
      if (dir === undefined) throw new Error("expected an open git trace inside the phase")
      await rm(dir, { recursive: true, force: true })
      return await new Promise<never>(() => {})
    })

    // then
    expect(String(await phase.then(() => undefined, (error: unknown) => error))).toContain("ENOENT")
  }, 30_000)
})
