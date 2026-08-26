import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths, type MemoryIdentity } from "@oh-my-opencode/memory-core"

import { writeRunJsonAtomic } from "./run-artifacts"
import { withRunFinalizationClaim } from "./run-finalization-claim"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe("per-run finalization claim", () => {
  test("#given concurrent finalizers #when the first publishes final #then the waiter observes terminal without executing", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "run-finalization-claim-"))
    roots.push(root)
    const identity: MemoryIdentity = {
      id: "agent-test",
      safeSlug: "agent-test",
      paths: buildIdentityPaths(root, "agent-test"),
    }
    const runDir = join(identity.paths.reflection, "runs", "run-1")
    await mkdir(runDir, { recursive: true })
    let releaseFirst: (() => void) | undefined
    const released = new Promise<void>((resolve) => { releaseFirst = resolve })
    let signalClaimed: (() => void) | undefined
    const claimed = new Promise<void>((resolve) => { signalClaimed = resolve })
    let operations = 0
    const first = withRunFinalizationClaim(identity, runDir, "run-1", async () => {
      operations += 1
      signalClaimed?.()
      await released
      await writeRunJsonAtomic(join(runDir, "final.json"), {
        version: 1,
        runId: "run-1",
        outcome: "merged",
      })
      return "first"
    })
    await claimed

    // when
    const second = withRunFinalizationClaim(identity, runDir, "run-1", async () => {
      operations += 1
      return "second"
    })
    releaseFirst?.()
    const [firstResult, secondResult] = await Promise.all([first, second])

    // then
    expect(firstResult).toEqual({ status: "completed", value: "first" })
    expect(secondResult).toEqual({
      status: "terminal",
      value: { runId: "run-1", outcome: "merged" },
    })
    expect(operations).toBe(1)
  })
})
