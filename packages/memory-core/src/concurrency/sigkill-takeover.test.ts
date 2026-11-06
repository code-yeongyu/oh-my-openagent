import { afterEach, describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { memoryWriterLockPath, parseLockRecord } from "../locks"
import { isLockOwnerProvenDead } from "../locks/acquire"
import { pidAlive, probeUntil } from "../locks/process-liveness.test-support"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  DEATH_PROOF_BOUND_MS,
  assertLinearCommits,
  assertRepoIntegrity,
  createConcurrencyKit,
  type ChildHarness,
} from "./two-process-kit.test-support"
import { takeoverTimeline, takeoverTraceEnabled, traceTakeover } from "./takeover-trace.test-support"

const writerChildPath = fileURLToPath(new URL("./writer-child.ts", import.meta.url))
const crashCommitChildPath = fileURLToPath(new URL("./crash-commit-child.ts", import.meta.url))

// The peer's follow-up commits prove the repository keeps working after the takeover; five do that
// as well as twenty, and the extra fifteen only made each case's 30 s budget a function of host
// load (omo #10199 r5 HIGH 2). Volume stress lives in loop-crash-consistency.mjs.
const PEER_COMMITS = 5
// Same reasoning for the SIGKILL takeover case (#10959): three commits per writer still prove the takeover (the holder
// dies on its second acquire, the survivor finishes the holder's remaining tasks and its own), and six linear commits
// replace twenty. On a loaded Windows shard the twenty took the whole 30 s budget before the holder even reached the kill.
const WRITER_COMMITS = 3
// Each phase waits for its own event and fails naming that phase. The bounds are circuit breakers for a real hang, never
// the expected duration; the test-level timeout only sits above their sum.
const PHASE_BOUND_MS = { fixture: 30_000, ready: 60_000, killReady: 60_000, holderExit: 30_000, integrity: 30_000, recovery: 120_000, survivorExit: 30_000, history: 30_000 } as const
const TAKEOVER_BREAKER_MS = Object.values(PHASE_BOUND_MS).reduce((sum, bound) => sum + bound, DEATH_PROOF_BOUND_MS) + 60_000

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
    String(WRITER_COMMITS),
    fixtureValue.contentionPath,
  ])
}

async function expectTakeoverOwnerProvenDead(identity: Awaited<ReturnType<typeof kit.fixture>>["identity"], pid: number | undefined): Promise<void> {
  const record = parseLockRecord(await readFile(memoryWriterLockPath(identity.paths.locks), "utf8"))
  if (record === null || record.pid !== pid) throw new Error(`unexpected lock owner: ${JSON.stringify(record)}`)
  const proofStart = performance.now()
  let probes = 0
  const proven = await probeUntil(async () => {
    probes += 1
    return isLockOwnerProvenDead(record)
  }, DEATH_PROOF_BOUND_MS)
  traceTakeover("test", "death-proof", { proven, probes, ms: Math.round(performance.now() - proofStart) })
  expect(proven).toBe(true)
}

// Each child's exit is traced the moment it happens, so a writer that ends early (#10959: before kill-ready, with an
// empty stderr) shows when, with which code, and what it last printed.
function traceExit(name: string, harness: ChildHarness): void {
  void harness.exit.then((exit) => traceTakeover("test", `${name}-exit`, { ...exit, pid: harness.child.pid ?? null, context: harness.failureContext().slice(0, 400) }))
}

async function phase<T>(name: string, boundMs: number, event: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const breaker = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`takeover phase "${name}" did not happen within ${String(boundMs)} ms`)), boundMs)
  })
  try {
    return await Promise.race([event, breaker])
  } finally {
    clearTimeout(timer)
  }
}

async function withTimelineOnFailure(body: () => Promise<void>): Promise<void> {
  try {
    await body()
  } catch (error) {
    if (takeoverTraceEnabled()) console.error(`takeover timeline (#10959):\n${takeoverTimeline() ?? ""}`)
    traceTakeover("test", "failed", { error: String(error).slice(0, 400) })
    throw error
  }
}

describe("one memory identity across real Bun processes (omo #10177 crash consistency)", () => {
  test("#given a writer SIGKILLed while holding the shared lock #when its peer continues #then liveness takeover lands every remaining commit cleanly", async () => {
    await withTimelineOnFailure(async () => {
    // #given
    const shared = await phase("fixture repository", PHASE_BOUND_MS.fixture, kit.fixture())
    traceTakeover("test", "fixture-ready")
    const holder = spawnWriter(shared, "kill-holder", "holder")
    const survivor = spawnWriter(shared, "recovery", "survivor")
    traceTakeover("test", "spawned", { holder: holder.child.pid ?? null, survivor: survivor.child.pid ?? null })
    traceExit("holder", holder)
    traceExit("survivor", survivor)
    await phase("both writers ready", PHASE_BOUND_MS.ready, Promise.all([holder.waitForLine("ready"), survivor.waitForLine("ready")]))
    const killReady = holder.waitForLine("kill-ready")

    // #when
    holder.send("go")
    survivor.send("go")
    traceTakeover("test", "go-sent")
    await phase("holder holds the lock (kill-ready)", PHASE_BOUND_MS.killReady, killReady)
    traceTakeover("test", "kill-sent")
    holder.child.kill("SIGKILL")
    expect(await phase("holder exit after SIGKILL", PHASE_BOUND_MS.holderExit, holder.exit)).toEqual({ code: null, signal: "SIGKILL" })
    // The exit event only proves this parent reaped its child. Recovery starts once the lock
    // protocol's own oracle proves the recorded owner dead, so the survivor never spends its
    // acquire budget on an owner the OS has not yet let go of; a proof that never arrives fails here.
    await expectTakeoverOwnerProvenDead(shared.identity, holder.child.pid)
    await phase("repository integrity after the kill", PHASE_BOUND_MS.integrity, assertRepoIntegrity(shared.identity.paths.repo))
    traceTakeover("test", "integrity-ok")
    survivor.send("begin-recovery")
    await phase("survivor takes over and commits (done)", PHASE_BOUND_MS.recovery, survivor.waitForPrefix("done:"))
    traceTakeover("test", "survivor-done")
    await phase("survivor exits cleanly", PHASE_BOUND_MS.survivorExit, kit.expectSuccessful(survivor))

    // #then
    await phase("linear history check", PHASE_BOUND_MS.history, assertLinearCommits(shared.identity, 2 * WRITER_COMMITS))
    traceTakeover("test", "passed")
    })
  }, TAKEOVER_BREAKER_MS)

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
    // Windows has neither /proc, lsof nor the flock-based git-activity lock, so the fail-closed
    // sweep keeps every stranded lock there by design (#10391).
    test.skipIf(process.platform === "win32")(`#given a writer SIGKILLed with a stranded .git/${name} #when its peer takes over #then every reachable object survives and the peer's follow-up commits land`, async () => {
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
