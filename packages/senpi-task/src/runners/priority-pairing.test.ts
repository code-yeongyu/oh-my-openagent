import { afterEach, describe, expect, test } from "bun:test"
import { rmSync } from "node:fs"
import { ModelRegistry, ModelRuntime } from "@code-yeongyu/senpi"
import { InProcessRunner, RunnerError } from "./in-process"
import { baseSpec, createFakeSession, tmpSessionDirs } from "./in-process-child-spec.test-support"
import { adaptInProcessHandle } from "../manager/child-handle"
import { stampSpawnEffectiveModel } from "../manager/observed-model"
import { createTaskRecord } from "../state"
import { createTaskRecordStore } from "../store"

const provider = "chatgpt-subscription"
const baseId = "gpt-6-luna"
const registry = new ModelRegistry(ModelRuntime.createSync())
registry.registerProvider(provider, {
  api: "openai-completions", baseUrl: "file://priority-pairing", apiKey: "test",
  models: [{
    id: baseId, name: baseId, reasoning: false, input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 16000, maxTokens: 4096,
  }],
})
const base = registry.find(provider, baseId)
if (base === undefined) throw new Error("fixture model missing")
const alias = { ...base, id: `${baseId}-fast`, serviceTier: "priority" as const, upstreamModelId: baseId }

afterEach(() => {
  for (const dir of tmpSessionDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("in-process registry pairing (#9812)", () => {
  test.each([
    ["forward priority", alias, base, "priority"],
    ["reverse priority", base, alias, "priority"],
    ["forward standard downgrade", alias, base, "standard"],
  ])("%s accepts the alias and persists the effective tier", async (_label, pinned, started, tier) => {
    // given
    const fake = createFakeSession()
    fake.session = { ...fake.session, ...{ model: started, effectiveServiceTier: tier } }
    const spec = baseSpec({ model: pinned, selectedModel: `${provider}/${pinned.id}` })
    const runner = new InProcessRunner({ createSession: async () => fake.session })
    // when
    const handle = await runner.start(spec)
    try {
      const observed = adaptInProcessHandle(handle).effectiveModel?.()
      const record = stampSpawnEffectiveModel(createTaskRecord({
        parent_session_id: "parent", root_session_id: "parent", depth: 1,
        execution_mode: "in-process", model: spec.selectedModel ?? "", notify_on_terminal: false,
      }), observed)
      const store = createTaskRecordStore({ project_dir: spec.cwd, task: { state_dir: spec.sessionDir } })
      store.save(record)
      // then: independent store instance exercises the persisted model parser too
      const reloaded = createTaskRecordStore({ project_dir: spec.cwd, task: { state_dir: spec.sessionDir } }).load(record.task_id)
      expect(reloaded?.effective_model).toMatchObject({ provider, model_id: started.id, service_tier: tier })
    } finally {
      fake.lastText.value = "done"
      fake.resolvePrompt()
      await handle.waitForIdle()
      await handle.dispose()
    }
  })

  test.each([
    ["forward without priority", false, undefined, baseId],
    ["reverse without priority", true, undefined, baseId],
    ["forward different upstream", false, "priority" as const, "another-sku"],
    ["reverse different upstream", true, "priority" as const, "another-sku"],
  ])("%s refuses a composer-style SKU before prompting", async (_label, reverse, serviceTier, upstreamModelId) => {
    // given
    const sku = { ...base, id: `${baseId}-fast`, serviceTier, upstreamModelId }
    const fake = createFakeSession()
    fake.session = { ...fake.session, model: reverse ? sku : base }
    const pinned = reverse ? base : sku
    const runner = new InProcessRunner({ createSession: async () => fake.session })
    // when
    const failure = await runner.start(baseSpec({ model: pinned, selectedModel: `${provider}/${pinned.id}` }))
      .catch((error: unknown) => error)
    // then
    expect(RunnerError.is(failure) ? failure.failure.kind : undefined).toBe("model_unavailable")
    expect(fake.promptCalls).toBe(0)
    expect(fake.disposeCount).toBe(1)
  })
})
