import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { FactsQueue, GitMemoryRepo, LockContentionError } from "@oh-my-opencode/memory-core"
import { OmoMemorySettingsSchema } from "@oh-my-opencode/omo-config-core"
import { FactsExtractorRunner } from "./facts-runner"
import { enqueue, fixture, onlyRunDir, runnerOptions } from "./facts-runner.test-support"

describe("people routing gate", () => {
  test("#given default people settings #when a person record is applied #then it routes to the person ledger with a new card", async () => {
    // given
    const { root, identity, queue } = await fixture()
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "person"))

    // when
    const result = await runner.launchPending()

    // then
    expect(result.status).toBe("committed")
    expect(await readFile(join(identity.paths.repo, "people", "mina", "observations.md"), "utf8"))
      .toContain("Mina prefers concise reviews.")
    expect(await readFile(join(identity.paths.repo, "people", "mina", "card.md"), "utf8"))
      .toContain("kind: person")
  }, 90_000)

  test("#given people routing disabled #when a person record is applied #then it falls back to monthly notes", async () => {
    // given
    const { root, identity, queue } = await fixture()
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "person", {
      loadConfig: () => ({
        config: {
          categories: { quick: { model: "omo-mock/mock-1" } },
          memory: OmoMemorySettingsSchema.parse({ people: { enabled: false } }),
        },
        diagnostics: [],
        layers: [],
        sources: [],
      }),
    }))

    // when
    const result = await runner.launchPending()

    // then
    expect(result.status).toBe("committed")
    expect(await readFile(join(identity.paths.repo, "notes", "facts", "2026-08.md"), "utf8"))
      .toContain("Mina prefers concise reviews.")
    expect(existsSync(join(identity.paths.repo, "people", "mina"))).toBe(false)
  }, 90_000)
})
