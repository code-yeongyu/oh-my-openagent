import { afterEach, describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { memoryWriterLockPath, parseLockRecord } from "../locks"
import { isLockOwnerProvenDead } from "../locks/acquire"
import { pidAlive, probeUntil } from "../locks/process-liveness.test-support"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { SAME_UID_GIT_UNINSPECTABLE } from "../git/host-scan-blind.test-support"
import {
  DEATH_PROOF_BOUND_MS,
  assertLinearCommits,
  assertRepoIntegrity,
  createConcurrencyKit,
  type ChildHarness,
} from "./two-process-kit.test-support"

const writerChildPath = fileURLToPath(new URL("./writer-child.ts", import.meta.url))
const crashCommitChildPath = fileURLToPath(new URL("./crash-commit-child.ts", import.meta.url))

// The peer's follow-up commits prove the repository keeps working after the takeover; five do that
// as well as twenty, and the extra fifteen only made each case's 30 s budget a function of host
// load (omo #10199 r5 HIGH 2). Volume stress lives in loop-crash-consistency.mjs.
const PEER_COMMITS = 5

const kit = createConcurrencyKit()
afterEach(kit.cleanup)

function spawnWriter(
  fixtureValue: Awaited<ReturnType<typeof kit.fixture>>,
  mode: "kill-holder" | "recovery",
  writerId: string,
): ChildHarness {
  return kit.harnessFor(writerChildPath, [
    mode,
    fixtureValue.identity.paths.repo,
    fixtureValue.identity.paths.locks,
    writerId,
    "10",
    fixtureValue.contentionPath,
  ])
}

async function expectTakeoverOwnerProvenDead(identity: Awaited<ReturnType<typeof kit.fixture>>["identity"], pid: number | undefined): Promise<void> {
  const record = parseLockRecord(await readFile(memoryWriterLockPath(identity.paths.locks), "utf8"))
  if (record === null || record.pid !== pid) throw new Error(`unexpected lock owner: ${JSON.stringify(record)}`)
  expect(await probeUntil(() => isLockOwnerProvenDead(record), DEATH_PROOF_BOUND_MS)).toBe(true)
}

describe("one memory identity across real Bun processes (omo #10177 crash consistency)", () => {
  test("#given a writer SIGKILLed while holding the shared lock #when its peer continues #then liveness takeover completes twenty clean commits", async () => {
    // #given
    const shared = await kit.fixture()
    const holder = spawnWriter(shared, "kill-holder", "holder")
    const survivor = spawnWriter(shared, "recovery", "survivor")
    await Promise.all([holder.waitForLine("ready"), survivor.waitForLine("ready")])
    const killReady = holder.waitForLine("kill-ready")

    // #when
    holder.send("go")
    survivor.send("go")
    await killReady
    holder.child.kill("SIGKILL")
    expect(await holder.exit).toEqual({ code: null, signal: "SIGKILL" })
    // The exit event only proves this parent reaped its child. Recovery starts once the lock
    // protocol's own oracle proves the recorded owner dead, so the survivor never spends its
    // acquire budget on an owner the OS has not yet let go of; a proof that never arrives fails here.
    await expectTakeoverOwnerProvenDead(shared.identity, holder.child.pid)
    await assertRepoIntegrity(shared.identity.paths.repo)
    survivor.send("begin-recovery")
    await survivor.waitForPrefix("done:")
    await kit.expectSuccessful(survivor)

    // #then
    await assertLinearCommits(shared.identity, 20)
  }, 30_000)

  // Windows: a writer that dies mid-commit takes its git commit down with it and leaves the change
  // staged, which blocks every later write (product bug #10393, not introduced here).
  test.skipIf(process.platform === "win32")("#given a writer SIGKILLed inside its git commit #when its peer takes over #then every reachable object survives and the peer's follow-up commits land", async () => {
    // #given
    const shared = await kit.fixture()
    const killer = kit.harnessFor(crashCommitChildPath, [
      "kill-mid-commit",
      shared.identity.paths.repo,
      shared.identity.paths.locks,
      "killer",
      "0",
      "30",
    ])

    // #when
    await killer.waitForLine("kill-ready")
    const killerExit = await killer.exit
    // SIGKILL is the interleaving under test; a clean exit means the self-kill timer fired after the
    // commit finished, which is still a valid (normal-completion) sample.
    expect(killer.diedByKill(killerExit) || killerExit.code === 0, `${JSON.stringify(killerExit)} ${killer.failureContext()}`).toBe(true)
    if (killerExit.code !== 0) await expectTakeoverOwnerProvenDead(shared.identity, killer.child.pid)
    // The killed writer's `git commit` runs on as an orphan; the takeover waits for it like for the owner.
    const orphanPid = Number.parseInt(await readFile(join(dirname(shared.identity.paths.repo), "killer-git.pid"), "utf8"), 10)
    expect(await probeUntil(() => !pidAlive(orphanPid), DEATH_PROOF_BOUND_MS)).toBe(true)
    await assertRepoIntegrity(shared.identity.paths.repo)

    const peer = kit.harnessFor(crashCommitChildPath, [
      "peer",
      shared.identity.paths.repo,
      shared.identity.paths.locks,
      "peer",
      String(PEER_COMMITS),
    ])
    await peer.waitForPrefix("done:")
    await kit.expectSuccessful(peer)

    // #then: the killed writer's commit always lands through its orphan, then the peer's commits
    await assertLinearCommits(shared.identity, PEER_COMMITS + 1)
  }, 30_000)

  // One row per point a killed `git commit` can strand its own lock file (git lockfile protocol:
  // the lock exists from create until rename, so a git process SIGKILLed while its lock exists can
  // never remove it). omo #10177: after such a kill, the peer's takeover must still leave a repo
  // whose every reachable object exists (fsck --strict clean) and whose history stays linear.
  const killTriggers = [
    { trigger: "index-lock", name: "index.lock" },
    { trigger: "ref-lock", name: "refs/heads/main.lock" },
  ] as const

  for (const { trigger, name } of killTriggers) {
    // Windows has neither /proc nor lsof, so the repo-in-use scan can never answer there and the
    // fail-closed sweep keeps every stranded lock by design: these rows' reclaim cannot happen on
    // Windows (#10391) until kernel-lock liveness (#10322) gives it an answer.
    test.skipIf(SAME_UID_GIT_UNINSPECTABLE || process.platform === "win32")(`#given a writer SIGKILLed with a stranded .git/${name} #when its peer takes over #then every reachable object survives and the peer's follow-up commits land`, async () => {
      // #given
      const shared = await kit.fixture()
      const killer = kit.harnessFor(crashCommitChildPath, [
        "kill-at-git-lock",
        shared.identity.paths.repo,
        shared.identity.paths.locks,
        "killer",
        trigger,
      ])

      // #when: the killer strands the lock (its git child is dead), announces kill-ready, then
      // stays alive holding the memory-write lock record until we confirm the debris - the
      // peer's sweep needs the takeover proof this process's registry will produce.
      await killer.waitForLine("kill-ready")
      const lockPath = join(shared.identity.paths.repo, ".git", ...(trigger === "ref-lock" ? ["refs", "heads", "main.lock"] : ["index.lock"]))
      expect(await probeUntil(() => existsSync(lockPath), 10_000)).toBe(true)
      // fsck reads a stranded ref lock as badRefContent; that line is the debris under test, and
      // nothing else may be wrong. The strict (no-allowance) check after the peer's commits then
      // proves the sweep removed it.
      await assertRepoIntegrity(shared.identity.paths.repo, [
        new RegExp(`^error: refs/heads/main\\.lock: badRefContent`),
      ].filter(() => trigger === "ref-lock"))
      killer.send("swept")
      const killerExit = await killer.exit
      expect(killer.diedByKill(killerExit), `${JSON.stringify(killerExit)} ${killer.failureContext()}`).toBe(true)
      await expectTakeoverOwnerProvenDead(shared.identity, killer.child.pid)

      const peer = kit.harnessFor(crashCommitChildPath, [
        "peer",
        shared.identity.paths.repo,
        shared.identity.paths.locks,
        "peer",
        String(PEER_COMMITS),
      ], trigger === "ref-lock" ? { OMO_TEST_GIT_LOCK_SETTLE_MS: "0" } : undefined)
      await peer.waitForPrefix("done:")
      await kit.expectSuccessful(peer)

      // #then: the stranded commit dies with its git process, so history is the peer's
      // linear commits plus, for the ref-lock row, the killer's completed root commit; the orphan
      // can never publish a ref past a stranded refs lock.
      await assertLinearCommits(shared.identity, trigger === "ref-lock" ? PEER_COMMITS + 1 : PEER_COMMITS)
    }, 30_000)
  }
})
