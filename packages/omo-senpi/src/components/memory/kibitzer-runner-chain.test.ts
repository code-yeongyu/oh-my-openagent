import { afterEach, describe, expect, test } from "bun:test"
import type { CreateAgentSessionOptions } from "@code-yeongyu/senpi"
import { KibitzerGateRunner } from "./kibitzer-runner"
import { fixture, launchInput, nudgeOnce, registrySnapshot, roots, runnerOptions, scriptedSession } from "./kibitzer-runner.test-support"
import { rmEfaultTolerant } from "./teardown.test-support"

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))) })

describe("KibitzerGateRunner quick chain", () => {
  async function judgeSessionOptions(quick: { model: string; fallback_models?: string[] }, models: readonly string[]): Promise<CreateAgentSessionOptions> {
    const { identityPaths } = await fixture()
    let captured: CreateAgentSessionOptions | undefined
    const stub = scriptedSession(async (options) => {
      captured = options
      await nudgeOnce(options)
    })
    const runner = new KibitzerGateRunner(runnerOptions(identityPaths, {
      createSession: stub.createSession,
      loadConfig: () => ({ config: { categories: { quick } }, diagnostics: [], layers: [], sources: [] }),
    }))
    const pending = runner.launch(launchInput({ modelRegistry: registrySnapshot(models.map((id) => ({ id }))) }))
    stub.resolve()
    await pending
    if (captured === undefined) throw new Error("judge session options were not captured")
    return captured
  }

  test("#given a quick category with in-category fallbacks #when the judge child is created #then its runtime settings enable exactly that chain with a one-retry same-model budget", async () => {
    // given / when
    const options = await judgeSessionOptions(
      { model: "omo-mock/mock-1", fallback_models: ["omo-mock/mock-2", "omo-mock/mock-3"] },
      ["mock-1", "mock-2", "mock-3"],
    )

    // then
    expect(options.settingsManager?.getRetryFallbackSettings()).toMatchObject({
      modelFallback: true,
      chains: { "omo-mock/mock-1": ["omo-mock/mock-2", "omo-mock/mock-3"] },
    })
    expect(options.settingsManager?.getRetrySettings()).toMatchObject({ maxRetries: 1 })
  })

  test("#given a single-model quick category #when the judge child is created #then model fallback stays disabled", async () => {
    // given / when
    const options = await judgeSessionOptions({ model: "omo-mock/mock-1" }, ["mock-1"])

    // then
    expect(options.settingsManager?.getRetryFallbackSettings()).toMatchObject({ modelFallback: false, chains: {} })
  })
})
