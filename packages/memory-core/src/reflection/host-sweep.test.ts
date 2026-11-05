import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { withLock } from "../locks/acquire"
import { createLockRecord } from "../locks/lock-record"
import { HOST_SWEEP_LOCK_FILE, readHostSweepState, sweepHostIdentities, type HostSweepIdentity } from "./host-sweep"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function memoryRoot(identities: number, repoLess: readonly number[] = []): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "omo-host-sweep-")))
  roots.push(root)
  for (let index = 0; index < identities; index += 1) {
    const identity = join(root, "agents", `agent-${String(index).padStart(2, "0")}`)
    mkdirSync(join(identity, "runtime"), { recursive: true })
    if (!repoLess.includes(index)) mkdirSync(join(identity, "repo"), { recursive: true })
  }
  mkdirSync(join(root, "agents", "no-runtime"), { recursive: true })
  return root
}

describe("host-wide identity sweep (DESIGN.r2 6b, H4)", () => {
  test("#given 30 identities, 3 without a repo, and a slice of 25 #when two bounded passes run #then the first visits 25 in sorted order and persists the cursor, the second finishes the 5 and records completion (A34, C27)", async () => {
    // given
    const root = memoryRoot(30, [3, 17, 28])
    const seen: HostSweepIdentity[] = []
    const step = async (identity: HostSweepIdentity) => {
      seen.push(identity)
      return []
    }

    // when
    const first = await sweepHostIdentities({ memoryRoot: root, steps: [step], maxIdentities: 25, now: () => 1_000 })
    const cursor = await readHostSweepState(root)
    const second = await sweepHostIdentities({ memoryRoot: root, steps: [step], maxIdentities: 25, now: () => 2_000 })

    // then
    expect(first).toMatchObject({ status: "swept", completed: false })
    expect(cursor.cursor).toBe("agent-24")
    expect(second).toMatchObject({ status: "swept", completed: true, visited: ["agent-25", "agent-26", "agent-27", "agent-28", "agent-29"] })
    expect(seen.map((identity) => identity.name)).toEqual(Array.from({ length: 30 }, (_, index) => `agent-${String(index).padStart(2, "0")}`))
    expect(await readHostSweepState(root)).toEqual({ version: 1, completedAt: new Date(2_000).toISOString() })
    expect(seen.filter((identity) => !identity.hasRepo).map((identity) => identity.name).slice(0, 3)).toEqual(["agent-03", "agent-17", "agent-28"])
    expect(seen.some((identity) => identity.name === "no-runtime")).toBe(false)
  })

  test("#given an unbounded pass #when it visits every identity #then completion is recorded and the cursor cleared", async () => {
    // given
    const root = memoryRoot(4)

    // when
    const result = await sweepHostIdentities({ memoryRoot: root, steps: [async () => []], now: () => Date.parse("2026-11-05T06:00:00.000Z") })

    // then
    expect(result).toMatchObject({ status: "swept", completed: true })
    expect(await readHostSweepState(root)).toEqual({ version: 1, completedAt: "2026-11-05T06:00:00.000Z" })
  })

  test("#given another driver holds the sweep lock #when a second driver starts #then it skips without waiting", async () => {
    // given
    const root = memoryRoot(2)
    let result: Awaited<ReturnType<typeof sweepHostIdentities>> | undefined

    // when
    await withLock(join(root, HOST_SWEEP_LOCK_FILE), await createLockRecord("runtime-sweep"), async () => {
      result = await sweepHostIdentities({ memoryRoot: root, steps: [async () => []] })
    })

    // then
    expect(result).toEqual({ status: "busy" })
  })

  test("#given a cursor from an interrupted round #when the unbounded driver runs #then it visits every identity once, the rest of the round first", async () => {
    // given
    const root = memoryRoot(4)
    await sweepHostIdentities({ memoryRoot: root, steps: [async () => []], maxIdentities: 2 })

    // when
    const result = await sweepHostIdentities({ memoryRoot: root, steps: [async () => []] })

    // then
    expect(result).toMatchObject({ status: "swept", completed: true, visited: ["agent-02", "agent-03", "agent-00", "agent-01"] })
  })

  test("#given a dry run #when it sweeps #then no cursor is written", async () => {
    // given
    const root = memoryRoot(3)

    // when
    await sweepHostIdentities({ memoryRoot: root, steps: [async () => []], maxIdentities: 1, dryRun: true })

    // then
    expect(await readHostSweepState(root)).toEqual({ version: 1 })
  })
})
