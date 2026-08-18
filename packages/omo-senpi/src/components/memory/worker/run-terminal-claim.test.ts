import { afterEach, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { claimRunTerminal, readRunTerminalClaim, runTerminalClaimPath } from "./run-terminal-claim"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function runDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "run-terminal-claim-"))
  roots.push(root)
  return root
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function expectSingleRecoveryWinner(dir: string, initial: string): Promise<void> {
  writeFileSync(runTerminalClaimPath(dir), initial)
  const bothInspected = deferred()
  const abandonFinished = deferred()
  let inspected = 0
  const inspectedStaleClaim = () => {
    inspected += 1
    if (inspected === 2) bothInspected.resolve()
    return bothInspected.promise
  }
  const identity = { runId: "run-1", attempt: 1 }
  const liveness = { getPidLiveness: () => "dead" as const }
  const abandon = claimRunTerminal(dir, identity, "abandon", {
    ...liveness,
    beforeRecovery: inspectedStaleClaim,
  }, 1111).finally(abandonFinished.resolve)
  const publish = claimRunTerminal(dir, identity, "publish", {
    ...liveness,
    beforeRecovery: async () => {
      await inspectedStaleClaim()
      await abandonFinished.promise
    },
  }, 2222)

  const claims = await Promise.all([abandon, publish])
  const ownWinners = claims.filter((claim, index) => claim.claimantPid === [1111, 2222][index])
  expect(ownWinners).toHaveLength(1)
  expect(new Set(claims.map((claim) => claim.kind))).toEqual(new Set([ownWinners[0]?.kind]))
  expect(readRunTerminalClaim(dir)).toEqual(ownWinners[0])
}

describe("run terminal claim", () => {
  test("#given a claim file left empty by a crash #when arbitration retries #then it recovers with one valid claim", async () => {
    // given
    const dir = await runDir()
    writeFileSync(runTerminalClaimPath(dir), "")

    // when
    const claim = await claimRunTerminal(dir, { runId: "run-1", attempt: 1 }, "abandon", { getPidLiveness: () => "dead" })

    // then
    expect(claim.kind).toBe("abandon")
    expect(readRunTerminalClaim(dir)).toMatchObject({ kind: "abandon", runId: "run-1", attempt: 1 })
  }, 30_000)

  test("#given a live publish claim #when abandonment claims #then the publisher keeps the claim", async () => {
    // given
    const dir = await runDir()
    await claimRunTerminal(dir, { runId: "run-1", attempt: 1 }, "publish", {}, 4242)

    // when
    const claim = await claimRunTerminal(dir, { runId: "run-1", attempt: 1 }, "abandon", { getPidLiveness: () => "alive" })

    // then
    expect(claim.kind).toBe("publish")
    expect(claim.claimantPid).toBe(4242)
  }, 30_000)

  test("#given two claimants inspected the same malformed claim #when recovery races #then only one replacement wins", async () => {
    await expectSingleRecoveryWinner(await runDir(), "")
  }, 30_000)

  test("#given two claimants inspected the same confirmed-dead publish claim #when recovery races #then only one replacement wins", async () => {
    await expectSingleRecoveryWinner(await runDir(), `${JSON.stringify({
      version: 1,
      kind: "publish",
      runId: "stale-run",
      attempt: 1,
      claimantPid: 434343,
    })}\n`)
  }, 30_000)
})
