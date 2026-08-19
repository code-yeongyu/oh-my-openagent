import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { FactsQueue, GitMemoryRepo, factsQueuePaths } from "@oh-my-opencode/memory-core"
import { FactsExtractorRunner } from "./facts-runner"
import { enqueue, fixture, onlyRunDir, runnerOptions } from "./facts-runner.test-support"
import type { ResolveAndPreflightMemoryLaunch } from "./worker/memory-launch-preflight"
import { createRunnerHarness } from "./worker/runner.test-support"
import { writeRunJsonAtomic } from "./worker/run-artifacts"
describe("quick-pinned facts launch", () => {
  test("#given quick cannot resolve #when pending facts are launched #then no child spawns and the queue stays intact with one warning", async () => {
    // given
    const { root, identity, queue } = await fixture()
    let spawnCount = 0
    const warnings: string[] = []
    const runner = new FactsExtractorRunner({
      identity,
      queue,
      cwd: root,
      loadConfig: () => ({ config: { categories: {} }, diagnostics: [], layers: [], sources: [] }),
      resolveModelRegistry: () => ({ getAvailable: () => [], find: () => undefined }),
      logger: {
        info: () => undefined,
        warn: (message) => warnings.push(message),
        error: () => undefined,
      },
      sandbox: (args) => {
        spawnCount += 1
        return args
      },
    })

    // when
    const result = await runner.launchPending()

    // then
    expect(result.status).toBe("skipped")
    expect(spawnCount).toBe(0)
    expect(warnings).toHaveLength(1)
    expect(await queue.listPending()).toHaveLength(1)
  }, 30_000)
  test("#given one injected launch-preflight seam #when reflection and facts launch #then both surfaces route through it", async () => {
    // given
    const surfaces: string[] = []
    const observe: ResolveAndPreflightMemoryLaunch = async (input) => {
      surfaces.push(input.surfaceName)
      throw new Error(`observed ${input.surfaceName}`)
    }
    const reflection = await createRunnerHarness({
      childMode: "commit",
      resolveAndPreflightLaunch: observe,
    })
    const { root, identity, queue } = await fixture()
    const facts = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fact", {
      resolveAndPreflightLaunch: observe,
    }))

    // when
    const reflectionResult = await reflection.runner.launch(reflection.run)
    const factsResult = await facts.launchPending()

    // then
    expect(reflectionResult).toMatchObject({ outcome: "failed", detail: "observed reflection" })
    expect(factsResult.status).toBe("failed")
    expect(surfaces).toEqual(["reflection", "facts"])
    await rm(reflection.root, { recursive: true, force: true })
  }, 90_000)

  test("#given two pending queue entries #when one launch runs #then the supervised child consumes all entries in one trailer-bearing commit", async () => {
    // given
    const { root, identity, queue } = await fixture()
    await enqueue(queue, identity, "session-2", "m2", "The project uses TypeScript.")
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fact", {
      createBatchId: () => "11111111-1111-4111-8111-111111111111",
    }))

    // when
    const result = await runner.launchPending()

    // then
    expect(result.status).toBe("committed")
    expect(await queue.listPending()).toHaveLength(0)
    const repo = new GitMemoryRepo({ dir: identity.paths.repo, agentId: identity.id })
    const [commit] = await repo.log({ limit: 1 })
    expect(commit?.trailers["Generated-By"]).toBe("facts-extractor")
    expect(commit?.trailers["Omo-Facts-Batch"]).toBe("11111111-1111-4111-8111-111111111111")
    expect(await readFile(join(identity.paths.repo, "notes/facts/2026-08.md"), "utf8")).toContain("fixture consumed 2 queue entries")
    const runDir = await onlyRunDir(identity)
    const ledger = JSON.parse(await readFile(join(runDir, "ledger.json"), "utf8"))
    expect(JSON.parse(await readFile(join(runDir, "final.json"), "utf8"))).toMatchObject({ outcome: "committed" })
    expect(JSON.parse(await readFile(join(runDir, "outcome.json"), "utf8"))).toMatchObject({ childExit: { code: 0 } })
    expect(ledger.applyRecovery).toMatchObject({
      version: 1,
      batchId: "11111111-1111-4111-8111-111111111111",
      headBeforeApply: ledger.headBeforeApply,
      people: { enabled: true, maxEntries: 40, maxEntryChars: 200 },
    })
    expect(ledger.applyRecovery.recordsHash).toMatch(/^[0-9a-f]{64}$/)
    expect(ledger.applyRecovery.paths.map((entry: { path: string }) => entry.path)).toEqual(
      [...ledger.applyRecovery.paths].map((entry: { path: string }) => entry.path).sort(),
    )
  }, 90_000)

  test("#given an extension-only quick primary and a child-visible fallback #when facts extraction launches #then it retries and commits with the fallback", async () => {
    // given
    const { root, identity, queue } = await fixture()
    const attempted: string[] = []
    const attemptNumbers: number[] = []
    const deadlines: number[] = []
    const base = runnerOptions(root, identity, queue, "model-fallback")
    const runner = new FactsExtractorRunner({
      ...base,
      // The shared deadline must cover the preflight probe plus both attempts (~7 cold bun
      // spawns); the 10s default fires mid-attempt on a loaded windows-latest runner, and a
      // timeout is a non-retryable miss so the fallback never launches.
      deadlineMs: 45_000,
      sandbox: (args) => {
        const modelIndex = args.args.indexOf("--model")
        attempted.push(args.args[modelIndex + 1] ?? "missing")
        attemptNumbers.push(args.attempt)
        deadlines.push(args.hardDeadlineAt)
        return base.sandbox?.(args) ?? args
      },
    })

    // when
    const result = await runner.launchPending()
    const runDir = await onlyRunDir(identity)
    const final = JSON.parse(await readFile(join(runDir, "final.json"), "utf8"))

    // then
    expect({ status: result.status, attempted, detail: final.detail }).toEqual({
      status: "committed",
      attempted: ["extension-only/primary", "omo-mock/mock-1"],
      detail: undefined,
    })
    expect(attemptNumbers).toEqual([1, 2])
    expect(new Set(deadlines).size).toBe(1)
    expect(await queue.listPending()).toHaveLength(0)
  }, 60_000)

  test("#given facts attempt two has a stale attempt-one outcome #when reconciled before the shared deadline #then the retry remains active", async () => {
    // given
    const { root, identity, queue } = await fixture()
    const runDir = join(identity.paths.facts, "runs", "facts-retry")
    await mkdir(runDir, { recursive: true })
    await writeRunJsonAtomic(join(runDir, "ledger.json"), {
      version: 1,
      runId: "facts-retry",
      kind: "facts",
      attempt: 2,
      model: "omo-mock/mock-1",
      startedAt: "2026-08-10T12:00:00.000Z",
      hardDeadlineAt: Date.parse("2026-08-10T12:01:00.000Z"),
      terminationGraceMs: 100,
      deadlineAt: Date.parse("2026-08-10T12:01:00.100Z"),
      batchId: "11111111-1111-4111-8111-111111111111",
      queued: [],
    })
    await writeRunJsonAtomic(join(runDir, "outcome.json"), {
      version: 1,
      runId: "facts-retry",
      attempt: 1,
      finishedAt: "2026-08-10T12:00:01.000Z",
      childExit: { code: 1, signal: null },
      timedOut: false,
    })
    const warnings: string[] = []
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fact", {
      logger: {
        info: () => undefined,
        warn: (message) => { warnings.push(message) },
        error: () => undefined,
      },
    }))

    // when
    const result = await runner.reconcilePending()

    // then
    expect(result.status).toBe("active")
    expect(warnings).toEqual([])
    expect(await queue.listPending()).toHaveLength(1)
    expect(existsSync(join(runDir, "final.json"))).toBe(false)
  }, 30_000)

  test("#given a commit lands before queue cleanup crashes #when a fresh runner reconciles #then the batch receipt prevents a duplicate commit", async () => {
    // given
    const { root, identity, queue } = await fixture()
    class FlakyQueue extends FactsQueue {
      private fail = true
      override async markConsumed(entries: Parameters<FactsQueue["markConsumed"]>[0]): Promise<void> {
        if (this.fail) {
          this.fail = false
          throw new Error("injected cleanup crash")
        }
        return super.markConsumed(entries)
      }
    }
    const flaky = new FlakyQueue({ identityPaths: identity.paths })
    const first = new FactsExtractorRunner(runnerOptions(root, identity, flaky, "fact"))
    await expect(first.launchPending()).rejects.toThrow("injected cleanup crash")
    const runDir = await onlyRunDir(identity)
    expect(await readFile(join(runDir, "final.json"), "utf8").catch(() => undefined)).toBeUndefined()
    await writeFile(join(identity.paths.repo, "foreign.md"), "parent bytes\n")

    // when: receipt probing must win before dirty-state recovery classification
    const recovered = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fact"))
    const result = await recovered.reconcilePending()

    // then
    expect(result.status).toBe("empty")
    expect(await queue.listPending()).toHaveLength(0)
    const repo = new GitMemoryRepo({ dir: identity.paths.repo, agentId: identity.id })
    expect((await repo.log()).filter((commit) => commit.trailers["Omo-Facts-Batch"] !== undefined)).toHaveLength(1)
    expect(await readFile(join(identity.paths.repo, "foreign.md"), "utf8")).toBe("parent bytes\n")
    expect(JSON.parse(await readFile(join(runDir, "final.json"), "utf8"))).toMatchObject({ outcome: "committed" })
  }, 30_000)

  test("#given a legacy dirty run without an envelope #when retried after cleanup #then it fails closed, retains queue watermarks, and later commits", async () => {
    const { root, identity, queue } = await fixture()
    const paths = factsQueuePaths(identity.paths)
    const cursorPath = paths.cursorPath("session-1")
    const cursorBefore = await readFile(cursorPath, "utf8")
    const consumedBefore = await readFile(paths.consumedPath, "utf8").catch(() => undefined)
    let injectDirty = true
    const first = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fact", {
      withWriterLock: async (operation) => {
        if (injectDirty) {
          injectDirty = false
          await writeFile(join(identity.paths.repo, "foreign.md"), "parent bytes\n")
        }
        return operation()
      },
    }))

    const blocked = await first.launchPending()

    expect(blocked.status).toBe("parent_dirty")
    expect(await queue.listPending()).toHaveLength(1)
    expect(await readFile(cursorPath, "utf8")).toBe(cursorBefore)
    expect(await readFile(paths.consumedPath, "utf8").catch(() => undefined)).toBe(consumedBefore)
    const firstRun = await onlyRunDir(identity)
    expect(JSON.parse(await readFile(join(firstRun, "final.json"), "utf8"))).toMatchObject({ outcome: "parent_dirty" })
    expect(JSON.parse(await readFile(join(firstRun, "ledger.json"), "utf8")).applyRecovery).toBeUndefined()

    await rm(join(identity.paths.repo, "foreign.md"))
    // The blocked run recorded a one-minute backoff; the retry clock clears that window.
    const retried = await new FactsExtractorRunner(runnerOptions(root, identity, queue, "fact", {
      now: () => new Date("2026-08-10T12:01:00.000Z"),
    })).launchPending()

    expect(retried.status).toBe("committed")
    expect(await queue.listPending()).toHaveLength(0)
    expect((await readdir(join(identity.paths.facts, "runs"))).length).toBe(2)
  }, 30_000)

  test("#given a valid empty extraction #when finalized #then no commit lands and the queue is consumed as no_facts", async () => {
    // given
    const { root, identity, queue } = await fixture()
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "empty"))

    // when
    const result = await runner.launchPending()

    // then
    expect(result.status).toBe("no_facts")
    expect(await queue.listPending()).toHaveLength(0)
    const runDir = await onlyRunDir(identity)
    expect(JSON.parse(await readFile(join(runDir, "final.json"), "utf8"))).toMatchObject({ outcome: "no_facts" })
  }, 30_000)

  test("#given a schema-invalid project record carrying person #when finalized #then the queue is retained", async () => {
    // given
    const { root, identity, queue } = await fixture()
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "malformed"))

    // when
    const result = await runner.launchPending()

    // then
    expect(result.status).toBe("failed")
    expect(await queue.listPending()).toHaveLength(1)
    const runDir = await onlyRunDir(identity)
    expect(JSON.parse(await readFile(join(runDir, "final.json"), "utf8"))).toMatchObject({ outcome: "failed" })
  }, 30_000)
})
