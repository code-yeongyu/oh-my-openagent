import { describe, expect, it } from "bun:test"
import {
  EVREN_BASE_URL,
  EVREN_OUTPUT_LIMIT,
  EVREN_PROVIDER_CONFIG,
  EVREN_PROVIDER_ID,
  applyBuiltinEvrenProvider,
} from "./provider"

type EvrenModels = typeof EVREN_PROVIDER_CONFIG.models

function createConfigWithProvider(): Record<string, unknown> {
  return { provider: {} }
}

function getInjectedEntry(config: Record<string, unknown>): Record<string, unknown> {
  const provider = config.provider as Record<string, unknown>
  return provider[EVREN_PROVIDER_ID] as Record<string, unknown>
}

describe("applyBuiltinEvrenProvider", () => {
  it("#given an empty provider map #when applied #then the evren entry is injected", () => {
    const config = createConfigWithProvider()

    applyBuiltinEvrenProvider(config)

    const provider = config.provider as Record<string, unknown>
    expect(provider[EVREN_PROVIDER_ID]).toBeDefined()
  })

  it("#given an already injected config #when applied again #then the injected entry is left as is", () => {
    const config = createConfigWithProvider()

    applyBuiltinEvrenProvider(config)
    const first = getInjectedEntry(config)

    applyBuiltinEvrenProvider(config)

    expect(getInjectedEntry(config)).toBe(first)
  })

  it("#given an existing user-defined evren entry #when applied #then it is never overwritten", () => {
    const config = createConfigWithProvider()
    const provider = config.provider as Record<string, unknown>
    const userEntry = { npm: "custom-package", name: "User Evren" }
    provider[EVREN_PROVIDER_ID] = userEntry

    applyBuiltinEvrenProvider(config)

    expect(provider[EVREN_PROVIDER_ID]).toBe(userEntry)
  })

  it("#given live context limits #when injected #then the injected clone carries them and the shared constant stays untouched", () => {
    const config = createConfigWithProvider()

    applyBuiltinEvrenProvider(config, { liveContextLimits: { "glm-5.3": 131072 } })

    const models = getInjectedEntry(config).models as EvrenModels
    expect(models["glm-5.3"]?.limit).toEqual({ context: 131072, output: EVREN_OUTPUT_LIMIT })
    expect(models["auto"]?.limit).toEqual({ context: 250000, output: EVREN_OUTPUT_LIMIT })
    expect(EVREN_PROVIDER_CONFIG.models["glm-5.3"]?.limit).toEqual({ context: 250000, output: EVREN_OUTPUT_LIMIT })
  })

  it("#given live context limits for an unknown or invalid model #when injected #then they are ignored", () => {
    const config = createConfigWithProvider()

    applyBuiltinEvrenProvider(config, {
      liveContextLimits: { "rogue-model": 999999, "auto": -5 },
    })

    const models = getInjectedEntry(config).models as EvrenModels
    expect(models["rogue-model"]).toBeUndefined()
    expect(models["auto"]?.limit).toEqual({ context: 250000, output: EVREN_OUTPUT_LIMIT })
  })

  it("#given an existing user-defined evren entry #when live context limits exist #then the user entry is still untouched", () => {
    const config = createConfigWithProvider()
    const provider = config.provider as Record<string, unknown>
    const userEntry = { npm: "@ai-sdk/openai-compatible", models: { "glm-5.3": { limit: { context: 7 } } } }
    provider[EVREN_PROVIDER_ID] = userEntry

    applyBuiltinEvrenProvider(config, { liveContextLimits: { "glm-5.3": 131072 } })

    expect(provider[EVREN_PROVIDER_ID]).toBe(userEntry)
  })

  it("#given a config without any provider map #when applied #then the provider map is created and the entry injected", () => {
    const missingProvider: Record<string, unknown> = {}

    applyBuiltinEvrenProvider(missingProvider)

    const provider = missingProvider.provider as Record<string, unknown>
    expect(provider[EVREN_PROVIDER_ID]).toBeDefined()
  })

  it("#given a non-object provider value #when applied #then it does not throw and leaves it untouched", () => {
    const nullProvider: Record<string, unknown> = { provider: null }
    expect(() => applyBuiltinEvrenProvider(nullProvider)).not.toThrow()
    expect(nullProvider.provider).toBeNull()

    const arrayProvider: Record<string, unknown> = { provider: [] }
    expect(() => applyBuiltinEvrenProvider(arrayProvider)).not.toThrow()
    expect(arrayProvider.provider).toEqual([])
  })

  it("#given an injected entry #when the result is mutated #then EVREN_PROVIDER_CONFIG stays untouched", () => {
    const config = createConfigWithProvider()

    applyBuiltinEvrenProvider(config)

    const injected = getInjectedEntry(config)
    injected.name = "MUTATED"
    const models = injected.models as EvrenModels
    const auto = models["auto"]
    if (auto === undefined) throw new Error("auto model missing")
    auto.name = "MUTATED"
    auto.limit.context = 1
    auto.limit.output = 1
    ;(models as Record<string, unknown>)["rogue"] = {
      name: "rogue",
      limit: { context: 1, output: 1 },
    }

    expect(EVREN_PROVIDER_CONFIG.name).toBe("EVREN LLM")
    expect(EVREN_PROVIDER_CONFIG.models["auto"]?.name).toBe("EVREN Auto")
    expect(EVREN_PROVIDER_CONFIG.models["auto"]?.limit.context).toBe(250000)
    expect(EVREN_PROVIDER_CONFIG.models["auto"]?.limit.output).toBe(EVREN_OUTPUT_LIMIT)
    expect(EVREN_PROVIDER_CONFIG.models["rogue"]).toBeUndefined()
  })

  it("#given two consecutive injections #when one result is mutated #then the other is unaffected", () => {
    const first = createConfigWithProvider()
    const second = createConfigWithProvider()

    applyBuiltinEvrenProvider(first)
    applyBuiltinEvrenProvider(second)
    getInjectedEntry(first).name = "MUTATED"

    expect(getInjectedEntry(second).name).toBe("EVREN LLM")
  })
})

describe("EVREN_PROVIDER_CONFIG", () => {
  it("#given the gateway model list #when inspecting the config #then all six models carry the documented limits", () => {
    const models = EVREN_PROVIDER_CONFIG.models

    expect(Object.keys(models).sort()).toEqual([
      "auto",
      "deepseek-v4-flash",
      "gemma-4-31b",
      "glm-5.3",
      "qwen3-vl-30b",
      "qwen3.8-flash-next",
    ])
    expect(models["auto"]?.limit).toEqual({ context: 250000, output: EVREN_OUTPUT_LIMIT })
    expect(models["glm-5.3"]?.limit).toEqual({ context: 250000, output: EVREN_OUTPUT_LIMIT })
    expect(models["deepseek-v4-flash"]?.limit).toEqual({ context: 250000, output: EVREN_OUTPUT_LIMIT })
    expect(models["qwen3.8-flash-next"]?.limit).toEqual({ context: 250000, output: EVREN_OUTPUT_LIMIT })
    expect(models["gemma-4-31b"]?.limit).toEqual({ context: 250000, output: EVREN_OUTPUT_LIMIT })
    expect(models["qwen3-vl-30b"]?.limit).toEqual({ context: 250000, output: EVREN_OUTPUT_LIMIT })
  })

  it("#given the three vision models #when inspecting modalities #then exactly those accept image input", () => {
    const models = EVREN_PROVIDER_CONFIG.models
    const visionModalities = { input: ["text", "image"] }

    expect(models["qwen3.8-flash-next"]?.modalities).toEqual(visionModalities)
    expect(models["gemma-4-31b"]?.modalities).toEqual(visionModalities)
    expect(models["qwen3-vl-30b"]?.modalities).toEqual(visionModalities)
    expect(models["auto"]?.modalities).toBeUndefined()
    expect(models["glm-5.3"]?.modalities).toBeUndefined()
    expect(models["deepseek-v4-flash"]?.modalities).toBeUndefined()
  })

  it("#given the OpenAI-compatible gateway #when inspecting the entry #then npm and baseURL match", () => {
    expect(EVREN_PROVIDER_CONFIG.npm).toBe("@ai-sdk/openai-compatible")
    expect(EVREN_PROVIDER_CONFIG.options).toEqual({ baseURL: EVREN_BASE_URL })
    expect(EVREN_BASE_URL).toBe("https://evren-llmapi.ssyz.org.tr/v1")
  })
})
