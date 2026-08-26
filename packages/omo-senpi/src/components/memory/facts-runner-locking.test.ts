import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { FactsQueue, GitMemoryRepo, LockContentionError } from "@oh-my-opencode/memory-core"
import { OmoMemorySettingsSchema } from "@oh-my-opencode/omo-config-core"
import { FactsExtractorRunner } from "./facts-runner"
import { enqueue, fixture, onlyRunDir, runnerOptions } from "./facts-runner.test-support"

describe("deterministic facts writer-lock interleavings", () => {
  test("#given the lock releases through the injected retry boundary #when finalization retries #then the batch commits and the queue empties", async () => {
    // given
    const { root, identity, queue } = await fixture()
    const attempts: number[] = []
    let released = false
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fact", {
      withWriterLock: async (operation, attempt) => {
        attempts.push(attempt)
        if (!released) throw new LockContentionError("memory-write.lock", null)
        return operation()
      },
      retryDelay: async () => { released = true },
      random: () => 0,
    }))

    // when
    const result = await runner.launchPending()

    // then
    expect(result.status).toBe("committed")
    expect(attempts).toEqual([1, 2])
    expect(await queue.listPending()).toHaveLength(0)
  }, 30_000)

  test("#given the lock remains held for all three attempts #when finalization exhausts retries #then no commit lands and one warning leaves queue and watermarks unchanged", async () => {
    // given
    const { root, identity, queue } = await fixture()
    const before = await queue.readCursor("session-1")
    const attempts: number[] = []
    const delays: number[] = []
    const warnings: string[] = []
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fact", {
      withWriterLock: async (_operation, attempt) => {
        attempts.push(attempt)
        throw new LockContentionError("memory-write.lock", null)
      },
      retryDelay: async (attempt) => { delays.push(attempt) },
      logger: {
        info: () => undefined,
        warn: (message) => warnings.push(message),
        error: () => undefined,
      },
      random: () => 0,
    }))

    // when
    const result = await runner.launchPending()

    // then
    expect(result.status).toBe("failed")
    expect(attempts).toEqual([1, 2, 3])
    expect(delays).toEqual([1, 2])
    expect(warnings).toHaveLength(1)
    expect(await queue.listPending()).toHaveLength(1)
    expect(await queue.readCursor("session-1")).toEqual(before)
    const repo = new GitMemoryRepo({ dir: identity.paths.repo, agentId: identity.id })
    expect((await repo.log()).filter((commit) => commit.trailers["Generated-By"] === "facts-extractor")).toHaveLength(0)
  }, 30_000)
})
