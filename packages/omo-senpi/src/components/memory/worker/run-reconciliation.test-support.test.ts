import { afterEach, describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"

import { createNodeGitExec } from "@oh-my-opencode/memory-core"

import { cleanupReconciliationFixtures, PHASE_IDLE_MS, withinPhase } from "./run-reconciliation.test-support"

afterEach(cleanupReconciliationFixtures)

describe("withinPhase", () => {
  test("#given a phase parked on a promise that never settles #when the idle window passes #then it fails naming the phase", async () => {
    // when
    const parked = withinPhase("parked-phase", () => new Promise<never>(() => {}))

    // then
    await expect(parked).rejects.toThrow("parked-phase stalled: no git progress")
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
})
