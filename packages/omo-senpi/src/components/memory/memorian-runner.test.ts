import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, realpathSync, writeFileSync } from "node:fs"
import { mkdtemp, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  PendingNudges,
  buildIdentityPaths,
  type MemoryIdentityPaths,
  type RecallCandidate,
} from "@oh-my-opencode/memory-core"
import type { SenpiModelPort } from "@oh-my-opencode/senpi-task"

import { MemorianGateRunner } from "./memorian-runner"
import { rmEfaultTolerant } from "./teardown.test-support"

const IDENTITY = "memorian-agent"
const SESSION_ID = "session-gate-1"
const CANDIDATE_PATH = "reference/kubernetes-rollouts.md"
const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })),
  )
})

const MODEL: SenpiModelPort = { provider: "omo-mock", id: "mock-1" }

const CANDIDATES: readonly RecallCandidate[] = [
  { path: CANDIDATE_PATH, description: "Rollout policy", excerpt: "drain first", score: 1 },
]

async function fixture(): Promise<{ root: string, identityPaths: MemoryIdentityPaths }> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memorian-runner-")))
  roots.push(root)
  return { root, identityPaths: buildIdentityPaths(root, IDENTITY) }
}

/** A stub child: writes the scripted NDJSON to $MEMORIAN_NUDGE_PATH, then exits. */
function stubChild(root: string, script: string): { senpiCommand: string, senpiPrefixArgs: readonly string[] } {
  const file = join(root, `stub-child-${Math.random().toString(36).slice(2)}.mjs`)
  writeFileSync(file, script, "utf8")
  return { senpiCommand: process.execPath, senpiPrefixArgs: [file] }
}

const WRITE_ONE_NUDGE = `
import { appendFileSync } from "node:fs"
const target = process.env.MEMORIAN_NUDGE_PATH
if (target === undefined) throw new Error("no nudge sink")
if (process.env.SENPI_MEMORY_MEMORIAN !== "1") throw new Error("no memorian sentinel")
appendFileSync(target, JSON.stringify({ path: ${JSON.stringify(CANDIDATE_PATH)}, hint: "Drain nodes before a rollout." }) + "\\n")
`

function runnerOptions(
  identityPaths: MemoryIdentityPaths,
  overrides: Partial<ConstructorParameters<typeof MemorianGateRunner>[0]> = {},
): ConstructorParameters<typeof MemorianGateRunner>[0] {
  return {
    identityPaths,
    loadConfig: () => ({
      config: { categories: { quick: { model: "omo-mock/mock-1" } } },
      diagnostics: [],
      layers: [],
      sources: [],
    }),
    env: {},
    ...overrides,
  }
}

/** The settle-time snapshot production always passes; the runner has no other registry source. */
function registrySnapshot(model: SenpiModelPort = MODEL) {
  return {
    getAvailable: () => [model],
    find: (provider: string, modelId: string) =>
      (provider === model.provider && modelId === model.id ? model : undefined),
  }
}

function launchInput(overrides: Partial<Parameters<MemorianGateRunner["launch"]>[0]> = {}) {
  return {
    sessionId: SESSION_ID,
    candidates: CANDIDATES,
    surfaced: new Set<string>(),
    maxItems: 2,
    transcript: [{ role: "user" as const, text: "how do we handle kubernetes rollouts" }],
    modelRegistry: registrySnapshot(),
    ...overrides,
  }
}

describe("MemorianGateRunner", () => {
  test("#given a scripted gate child #when the runner launches #then the validated nudge lands in the pending store", async () => {
    // given
    const { root, identityPaths } = await fixture()
    const stub = stubChild(root, WRITE_ONE_NUDGE)
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, stub))

    // when
    const result = await runner.launch(launchInput())

    // then
    expect(result.status).toBe("nudged")
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 0 })).toEqual([
      { path: CANDIDATE_PATH, hint: "Drain nodes before a rollout." },
    ])
  }, 30_000)

  test("#given a snapshotted registry on the input #when the ctx behind it is already disposed #then the launch still succeeds", async () => {
    // given: production hands the runner a registry captured synchronously at settle. The runner
    // holds no ctx-reading seam at all, so the snapshot is the whole story of how it resolves.
    const { root, identityPaths } = await fixture()
    const stub = stubChild(root, WRITE_ONE_NUDGE)
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, stub))

    // when
    const result = await runner.launch(launchInput({ modelRegistry: registrySnapshot() }))

    // then
    expect(result.status).toBe("nudged")
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 0 })).toEqual([
      { path: CANDIDATE_PATH, hint: "Drain nodes before a rollout." },
    ])
  }, 30_000)

  test("#given no registry snapshot on the input #when the runner launches #then it warns, skips and spawns nothing", async () => {
    // given: the settle handler is the ONLY place allowed to read the senpi ctx. When its
    // synchronous snapshot came back unavailable the detached runner has no legal source left:
    // consulting a resolver here would read a ctx the host disposed the moment the handler returned.
    const { root, identityPaths } = await fixture()
    const stub = stubChild(root, WRITE_ONE_NUDGE)
    const warnings: string[] = []
    let spawned = 0
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, {
      ...stub,
      logger: { info: () => undefined, warn: (message) => warnings.push(message), error: () => undefined },
      sandbox: (args) => {
        spawned += 1
        return args
      },
    }))

    // when: the settle snapshot came back unavailable
    const result = await runner.launch(launchInput({ modelRegistry: undefined }))

    // then
    expect(result.status).toBe("skipped")
    expect(spawned).toBe(0)
    expect(warnings).toEqual(["memorian gate registry snapshot unavailable"])
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 0 })).toEqual([])
  }, 30_000)

  test("#given the quick category cannot resolve #when the runner launches #then it warns, skips and spawns nothing", async () => {
    // given
    const { identityPaths } = await fixture()
    const warnings: string[] = []
    let spawned = 0
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, {
      loadConfig: () => ({ config: { categories: {} }, diagnostics: [], layers: [], sources: [] }),
      logger: { info: () => undefined, warn: (message) => warnings.push(message), error: () => undefined },
      sandbox: (args) => {
        spawned += 1
        return args
      },
    }))

    // when
    const result = await runner.launch(launchInput({
      modelRegistry: { getAvailable: () => [], find: () => undefined },
    }))

    // then
    expect(result.status).toBe("skipped")
    expect(spawned).toBe(0)
    expect(warnings).toHaveLength(1)
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 0 })).toEqual([])
  }, 30_000)

  test("#given no quick category but another usable registry model #when the runner launches #then it warns, skips and never rides the beyond-category ladder", async () => {
    // given: resolveReflectionModel's beyond-category ladder resolves ANY usable registry model when
    // the quick chain is dead. The gate is quick-PINNED: an advisory read must never launch on an
    // arbitrary (possibly frontier-priced) model behind the operator's back.
    const { identityPaths } = await fixture()
    const warnings: string[] = []
    let spawned = 0
    const other: SenpiModelPort = { provider: "omo-mock", id: "expensive-1" }
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, {
      loadConfig: () => ({ config: { categories: {} }, diagnostics: [], layers: [], sources: [] }),
      logger: { info: () => undefined, warn: (message) => warnings.push(message), error: () => undefined },
      sandbox: (args) => {
        spawned += 1
        return args
      },
    }))

    // when
    const result = await runner.launch(launchInput({ modelRegistry: registrySnapshot(other) }))

    // then
    expect(result.status).toBe("skipped")
    expect(spawned).toBe(0)
    expect(warnings).toEqual(["memorian gate quick category unavailable"])
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 0 })).toEqual([])
  }, 30_000)

  test("#given a launch already in flight #when a second trigger arrives #then only one child runs", async () => {
    // given
    const { root, identityPaths } = await fixture()
    const stub = stubChild(root, `${WRITE_ONE_NUDGE}\nawait new Promise((resolve) => setTimeout(resolve, 300))\n`)
    let spawned = 0
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, {
      ...stub,
      sandbox: (args) => {
        spawned += 1
        return args
      },
    }))

    // when
    const [first, second] = await Promise.all([runner.launch(launchInput()), runner.launch(launchInput())])

    // then
    expect(spawned).toBe(1)
    expect([first.status, second.status].sort()).toEqual(["active", "nudged"])
  }, 30_000)

  test("#given a child that fabricates a path #when the runner validates #then nothing is pending", async () => {
    // given
    const { root, identityPaths } = await fixture()
    const stub = stubChild(
      root,
      `
import { appendFileSync } from "node:fs"
appendFileSync(process.env.MEMORIAN_NUDGE_PATH, JSON.stringify({ path: "notes/never-offered.md", hint: "nope" }) + "\\n")
`,
    )
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, stub))

    // when
    const result = await runner.launch(launchInput())

    // then
    expect(result.status).toBe("empty")
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 0 })).toEqual([])
  }, 30_000)

  test("#given a crashing gate child #when the runner launches #then it reports the skip without throwing and writes no pending", async () => {
    // given
    const { root, identityPaths } = await fixture()
    const stub = stubChild(root, "process.exit(7)\n")
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, stub))

    // when
    const result = await runner.launch(launchInput())

    // then
    expect(result.status).toBe("failed")
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 0 })).toEqual([])
  }, 30_000)

  test("#given a child that outlives the deadline #when the runner launches #then the run is abandoned with no pending nudges", async () => {
    // given
    const { root, identityPaths } = await fixture()
    const stub = stubChild(
      root,
      "await new Promise((resolve) => setTimeout(resolve, 30_000))\n",
    )
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, { ...stub, deadlineMs: 200 }))

    // when
    const result = await runner.launch(launchInput())

    // then
    expect(result.status).toBe("failed")
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 0 })).toEqual([])
  }, 30_000)

  test("#given a compaction accepted mid-flight #when the child finishes #then the stale nudges are discarded instead of written", async () => {
    // given: the child judged transcript T1; a compaction accepted while it ran rewrote that
    // transcript, so its verdict now advises a conversation that no longer exists.
    const { root, identityPaths } = await fixture()
    const stub = stubChild(root, WRITE_ONE_NUDGE)
    const warnings: string[] = []
    let epoch = 7
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, {
      ...stub,
      logger: { info: () => undefined, warn: (message) => warnings.push(message), error: () => undefined },
    }))

    // when: the epoch advances while the child runs
    const result = await runner.launch(launchInput({
      compactionEpoch: epoch,
      currentCompactionEpoch: () => {
        epoch = 8
        return epoch
      },
    }))

    // then
    expect(result.status).toBe("dropped")
    expect(warnings).toEqual(["memorian gate nudges dropped after compaction"])
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 0 })).toEqual([])
  }, 30_000)

  test("#given a launch epoch #when the nudges are written #then the payload carries that epoch", async () => {
    // given: the epoch travels IN the payload, so the consumer - not the writer - decides staleness
    const { root, identityPaths } = await fixture()
    const stub = stubChild(root, WRITE_ONE_NUDGE)
    const seen: number[] = []
    const real = new PendingNudges(identityPaths.recallPending)
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, {
      ...stub,
      pendingNudges: {
        write: async (sessionId, nudges, options) => {
          seen.push(options.epoch)
          await real.write(sessionId, nudges, options)
        },
        delete: (sessionId) => real.delete(sessionId),
      },
    }))

    // when
    const result = await runner.launch(launchInput({ compactionEpoch: 9, currentCompactionEpoch: () => 9 }))

    // then
    expect(result.status).toBe("nudged")
    expect(seen).toEqual([9])
  }, 30_000)

  test("#given a compaction accepted DURING the pending write #when the write completes #then the landed file is retracted", async () => {
    // given: the pre-write epoch check passes, then write() awaits fs work. A compaction accepted in
    // that window bumps the epoch and its own pending-drop finds no file yet - so the rename lands a
    // pre-compaction nudge that nothing would ever remove. The runner must re-check AFTER the write.
    const { root, identityPaths } = await fixture()
    const stub = stubChild(root, WRITE_ONE_NUDGE)
    const warnings: string[] = []
    const real = new PendingNudges(identityPaths.recallPending)
    let epoch = 4
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, {
      ...stub,
      logger: { info: () => undefined, warn: (message) => warnings.push(message), error: () => undefined },
      pendingNudges: {
        write: async (sessionId, nudges, options) => {
          // The compaction lands while the write is still in flight: the epoch bumps here, and the
          // compaction's own pending-drop runs before this rename ever creates the file.
          epoch = 5
          await real.write(sessionId, nudges, options)
        },
        delete: (sessionId) => real.delete(sessionId),
      },
    }))

    // when
    const result = await runner.launch(launchInput({
      compactionEpoch: 4,
      currentCompactionEpoch: () => epoch,
    }))

    // then
    expect(result.status).toBe("dropped")
    expect(warnings).toEqual(["memorian gate nudges dropped after compaction"])
    expect(existsSync(join(identityPaths.recallPending, `${SESSION_ID}.json`))).toBe(false)
    expect(await real.take(SESSION_ID, { currentEpoch: epoch })).toEqual([])
  }, 30_000)

  test("#given a compaction that lands mid-write and no post-write retraction #when the next turn takes #then the stale payload is never consumed", async () => {
    // given: the reviewer's exact interleaving. The pre-write check passes, write() yields, the
    // compaction bumps the epoch inside that yield and its own pending-drop finds no file, then the
    // rename lands. This store deliberately performs NO retraction at all, so only the consumption
    // point can reject the payload - which is what makes correctness independent of the race.
    const { root, identityPaths } = await fixture()
    const stub = stubChild(root, WRITE_ONE_NUDGE)
    const real = new PendingNudges(identityPaths.recallPending)
    let epoch = 4
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, {
      ...stub,
      pendingNudges: {
        write: async (sessionId, nudges, options) => {
          // Yield mid-write, exactly where rename has not happened yet.
          await Promise.resolve()
          epoch = 5
          await real.write(sessionId, nudges, options)
        },
        // The best-effort retraction is disabled: the epoch check at take() must stand alone.
        delete: async () => undefined,
      },
    }))

    // when
    await runner.launch(launchInput({ compactionEpoch: 4, currentCompactionEpoch: () => epoch }))

    // then: the next turn reads the live (bumped) epoch and the pre-compaction verdict never lands
    expect(await real.take(SESSION_ID, { currentEpoch: epoch })).toEqual([])
    expect(existsSync(join(identityPaths.recallPending, `${SESSION_ID}.json`))).toBe(false)
  }, 30_000)

  test("#given an unchanged compaction epoch #when the child finishes #then the nudges are written as usual", async () => {
    // given
    const { root, identityPaths } = await fixture()
    const stub = stubChild(root, WRITE_ONE_NUDGE)
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, stub))

    // when
    const result = await runner.launch(launchInput({
      compactionEpoch: 3,
      currentCompactionEpoch: () => 3,
    }))

    // then: the payload carries the launch epoch, so the next turn at epoch 3 consumes it
    expect(result.status).toBe("nudged")
    expect(await new PendingNudges(identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 3 })).toEqual([
      { path: CANDIDATE_PATH, hint: "Drain nodes before a rollout." },
    ])
  }, 30_000)

  test("#given a completed run #when the runner finishes #then the run directory is removed", async () => {
    // given
    const { root, identityPaths } = await fixture()
    const stub = stubChild(root, WRITE_ONE_NUDGE)
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, stub))

    // when
    await runner.launch(launchInput())

    // then
    const runsDir = join(identityPaths.recall, "runs")
    expect(existsSync(runsDir) ? await readdir(runsDir) : []).toEqual([])
  }, 30_000)
})
