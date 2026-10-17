import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { readReflectionParkFile } from "@oh-my-opencode/memory-core"

import { resetModelPreflightCacheForTests } from "./model-preflight"
import { REFLECTION_PARKED_ENTRY_TYPE } from "./park-alert"
import { REFLECTION_HEALTH_ENTRY_TYPE } from "./health-alert"
import { reflectionRemediation } from "./remediation"
import { createRunnerHarness, type RunnerHarness } from "./runner.test-support"
import { rmEfaultTolerant } from "../teardown.test-support"

// Real supervisor, bootstrap, and model child per case (see runner.integration.test.ts).
setDefaultTimeout(60_000)

const harnesses: RunnerHarness[] = []

afterEach(async () => {
  resetModelPreflightCacheForTests()
  await Promise.all(harnesses.splice(0).map((item) =>
    rmEfaultTolerant(item.root, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 })))
})

async function harness(childMode: "extension-provider" | "extension-provider-unreachable"): Promise<RunnerHarness> {
  const created = await createRunnerHarness({ childMode })
  harnesses.push(created)
  return created
}

describe("SenpiSubprocessRunner with an extension-registered provider (#9175)", () => {
  test("#given the only model comes from an extension provider #when reflection launches #then the child loads extensions and the run merges", async () => {
    // given
    const item = await harness("extension-provider")

    // when
    const result = await item.runner.launch(item.run)

    // then
    expect({ outcome: result.outcome, detail: result.detail }).toEqual({ outcome: "merged", detail: undefined })
    expect(item.spawnCalls).toHaveLength(1)
    const spawn = item.spawnCalls[0]
    expect(spawn?.model).toBe("extension-only/primary")
    expect(spawn?.args).not.toContain("--no-extensions")
    expect(spawn?.args).toEqual(expect.arrayContaining(["--no-skills", "--no-prompt-templates", "--no-context-files"]))
    // Extensions now load in the child, so the sentinel is what keeps its own memory component off.
    expect(spawn?.env.SENPI_MEMORY_REFLECTION).toBe("1")
    // omo's own components would write runtime state into the memory worktree and dirty it.
    expect(spawn?.env.OMO_SENPI_DISABLED).toBe("1")
    // One discovery-disabled catalog, then one catalog with extensions for the omitted candidate.
    expect(await readFile(item.preflightProbeLog, "utf8")).toBe("probe\nprobe\n")
  })

  test("#given a model no child can see even with extensions #when automatic reflection fails once #then it parks after that one failure with one notice naming a core-provider model", async () => {
    // given
    const item = await harness("extension-provider-unreachable")

    // when
    const result = await item.runner.launch(item.run)

    // then
    expect(result.outcome).toBe("failed")
    expect(result.detail).toContain("extension-only/primary")
    expect(item.spawnCalls).toHaveLength(1)
    expect(item.spawnCalls[0]?.args).not.toContain("--no-extensions")
    const park = await readReflectionParkFile(join(item.identity.paths.reflection))
    expect({ streak: park.streak, parked: park.parkedAt !== undefined }).toEqual({ streak: 1, parked: true })
    const notices = item.api.entries.filter((entry) =>
      entry.customType === REFLECTION_PARKED_ENTRY_TYPE || entry.customType === REFLECTION_HEALTH_ENTRY_TYPE)
    expect(notices.map((entry) => entry.customType)).toEqual([REFLECTION_PARKED_ENTRY_TYPE])
    expect(item.notifications).toHaveLength(1)
    const recommendation = (notices[0]?.data as { readonly recommendation?: string } | undefined)?.recommendation
    expect(recommendation).toBe(reflectionRemediation(result.reason, result.detail))
    expect(recommendation).not.toBe(reflectionRemediation("spawn_failed", "model_not_visible:extension-only/primary; attempted:extension-only/primary"))
  })
})
