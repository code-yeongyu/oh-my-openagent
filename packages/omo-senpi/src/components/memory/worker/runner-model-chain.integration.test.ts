import { afterEach, describe, expect, test } from "bun:test"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { GitMemoryRepo } from "@oh-my-opencode/memory-core"
import { harness, assertWorktreesClean, cleanupRunnerHarnesses } from "./runner-integration.test-support"
import { resolveAndPreflightMemoryLaunch } from "./memory-launch-preflight"
import { readRunJson } from "./run-artifacts"
import type { ReservationRunLedger } from "./reservation-run-ledger"
import type { RunnerHarness } from "./runner.test-support"

afterEach(cleanupRunnerHarnesses)

describe("reflection model-chain integration", () => {
  test("#given an extension-only primary and a child-visible fallback #when the primary is missing in the clean child #then reflection retries and records the fallback", async () => {
    // given
    let admittedDeadline: number | undefined
    const item: RunnerHarness = await harness({
      childMode: "model-fallback",
      resolveAndPreflightLaunch: async (input) => resolveAndPreflightMemoryLaunch({ ...input, attempt: async (...args) => {
        const child = await input.attempt(...args)
        if (args[1] === 1) {
          admittedDeadline = (await readRunJson<ReservationRunLedger>(
            join(item.identity.paths.reflection, "runs", item.run.runId, "ledger.json"),
          )).hardDeadlineAt
        }
        return child
      } }),
    })

    // when
    const result = await item.runner.launch(item.run)

    // then
    expect(result.outcome).toBe("merged")
    expect(item.spawnCalls.map((spawn) => spawn.args[spawn.args.indexOf("--model") + 1])).toEqual([
      "extension-only/primary",
      "kimi-coding/fallback",
    ])
    expect(item.spawnCalls.map((spawn) => spawn.attempt)).toEqual([1, 2])
    if (admittedDeadline === undefined) throw new Error("first attempt did not record its admitted deadline")
    expect(item.spawnCalls[1]?.hardDeadlineAt).toBe(admittedDeadline)
    expect(result.completion).toMatchObject({
      model: "kimi-coding/fallback",
      thinking: "minimal",
      outcome: "merged",
    })
    await assertWorktreesClean(item)
  }, 60_000)

  test("#given the primary model's providers are all cooling down #when the child dies with a 503 #then reflection relaunches on the next candidate and merges", async () => {
    // given
    const item = await harness({ childMode: "provider-cooldown" })

    // when
    const result = await item.runner.launch(item.run)

    // then
    expect(result.outcome).toBe("merged")
    expect(item.spawnCalls.map((spawn) => spawn.args[spawn.args.indexOf("--model") + 1])).toEqual([
      "extension-only/primary",
      "kimi-coding/fallback",
    ])
    expect(item.spawnCalls.map((spawn) => spawn.attempt)).toEqual([1, 2])
    expect(result.completion).toMatchObject({
      model: "kimi-coding/fallback",
      thinking: "minimal",
      outcome: "merged",
    })
    await assertWorktreesClean(item)
  }, 60_000)

  test("#given no candidate is visible #when a fresh probe and then its cached negative are used #then both runs proceed reactively", async () => {
    // given
    const item = await harness({
      childMode: "commit",
      preflightModels: [{ provider: "other", id: "model" }],
    })

    // when
    const fresh = await item.runner.launch(item.run)
    // The first run now merges and advances the cursor, so the second reservation needs fresh backlog,
    // and the stub child's identical commit needs a real diff against the parent to merge again.
    await item.journal.reconcile([{ kind: "assistant", messageId: "assistant-2", textBlocks: ["Remember another fact"] }])
    const parent = new GitMemoryRepo({ dir: item.identity.paths.repo, agentId: item.identity.id })
    await writeFile(join(item.identity.paths.repo, "system", "reflected.md"), "---\ndescription: Edited between runs\n---\nEdited between runs.\n", "utf8")
    await parent.commitWrite(["system/reflected.md"], "edit between runs", { agentId: item.identity.id, authorName: "Test" })
    const cached = await item.runner.launch(await item.reserveAgain())

    // then
    expect(fresh.outcome).toBe("merged")
    expect(cached.outcome).toBe("merged")
    expect(item.spawnCalls).toHaveLength(2)
    // Reactive attempts run in the most permissive child, so a miss there is conclusive (#9175).
    expect(item.spawnCalls.map((spawn) => spawn.args.includes("--no-extensions"))).toEqual([false, false])
    // One discovery-disabled and one extension-loading catalog, each probed once and then cached.
    expect(await readFile(item.preflightProbeLog, "utf8")).toBe("probe\nprobe\n")
  }, 60_000)

  test("#given every child-visible candidate misses its model or auth #when the chain is exhausted #then the failed outcome fingerprints every attempted cause", async () => {
    // given
    const item = await harness({ childMode: "model-exhausted" })

    // when
    const result = await item.runner.launch(item.run)

    // then
    expect(result).toMatchObject({ outcome: "failed", reason: "spawn_failed" })
    expect(result.detail).toContain("model_not_visible:extension-only/primary")
    expect(result.detail).toContain("auth_missing:kimi-coding")
    expect(result.detail).toContain("attempted:extension-only/primary,kimi-coding/fallback")
    expect(item.spawnCalls).toHaveLength(2)
  }, 60_000)

})
