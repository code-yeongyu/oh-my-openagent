import { describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { EventTelemetryProperties } from "@oh-my-opencode/telemetry-core"
import type { SenpiModelPort } from "@oh-my-opencode/senpi-task"

import type { TaskModelRegistry } from "../task/planner"
import { createCategoryConfigCapture } from "./omo-native-category-config"
import { OMO_NATIVE_PROPERTY_ALLOWLISTS } from "./product-identity"

function registry(models: readonly SenpiModelPort[]): TaskModelRegistry {
  return {
    getAvailable: () => models,
    find: (provider, modelId) => models.find((model) => model.provider === provider && model.id === modelId),
  }
}

const FULL_REGISTRY = registry([
  { provider: "anthropic", id: "claude-opus-5" },
  { provider: "anthropic", id: "claude-fable-5" },
  { provider: "anthropic", id: "claude-haiku-4-5" },
  { provider: "anthropic", id: "claude-sonnet-5" },
  { provider: "openai", id: "gpt-5.6-sol" },
  { provider: "openai", id: "gpt-5.6-terra" },
  { provider: "openai", id: "gpt-5.6-luna-fast" },
  { provider: "kimi-coding", id: "kimi-k3" },
  { provider: "kimi-coding", id: "kimi-for-coding-highspeed" },
  { provider: "google", id: "gemini-3.1-pro" },
  { provider: "xai", id: "grok-4.6" },
])

function harness(config: OmoConfig, models: TaskModelRegistry = FULL_REGISTRY) {
  const captured: EventTelemetryProperties[] = []
  const capture = createCategoryConfigCapture({
    captureEvent: (_name, properties) => captured.push(properties),
    omoConfig: config,
    sessionHash: "hashed-session",
  })
  return { captured, observe: (source: string) => capture.observe({ registry: models, source }) }
}

describe("omo-native category config capture", () => {
  test("#given a config with one builtin override and two user categories #when the snapshot is captured #then cat_architect matches the exact composed string, user_category_count is 2, builtin_overridden_count is 1, and combo_fingerprint is stable across property-order permutations", () => {
    // given
    const architectOverride = { model: "openai/gpt-5.6-sol", reasoningEffort: "high" } as const
    const first: OmoConfig = {
      categories: {
        architect: architectOverride,
        "my-reviewer": { model: "anthropic/claude-opus-5" },
        "my-writer": { model: "anthropic/claude-haiku-4-5" },
      },
    }
    const permuted: OmoConfig = {
      categories: {
        "my-writer": { model: "anthropic/claude-haiku-4-5" },
        "my-reviewer": { model: "anthropic/claude-opus-5" },
        architect: architectOverride,
      },
    }

    // when
    const a = harness(first)
    const b = harness(permuted)
    a.observe("startup")
    b.observe("startup")

    // then
    const props = a.captured[0]
    expect(props?.cat_architect).toBe("openai/gpt-5.6-sol/high")
    expect(props?.user_category_count).toBe(2)
    expect(props?.builtin_overridden_count).toBe(1)
    expect(props?.source).toBe("startup")
    expect(props?.$session_id).toBe("hashed-session")
    expect(props?.config_generation).toBe(0)
    expect(props?.combo_fingerprint).toBe(b.captured[0]?.combo_fingerprint)
    expect(props?.combo_fingerprint).toMatch(/^[a-f0-9]{16}$/)
    expect(Object.keys(props ?? {}).sort()).toEqual([...OMO_NATIVE_PROPERTY_ALLOWLISTS.category_config].sort())
  })

  test("#given a disabled category and an unresolvable one #when encoded #then the values are exactly \"disabled\" and \"unavailable\" and every value is at most 64 characters", () => {
    // given: writing disabled outright, and an empty registry so nothing resolves
    const config: OmoConfig = { categories: { writing: { disable: true } } }

    // when
    const { captured, observe } = harness(config, registry([]))
    observe("reload")

    // then
    const props = captured[0]
    expect(props?.cat_writing).toBe("disabled")
    expect(props?.cat_deep).toBe("unavailable")
    for (const [key, value] of Object.entries(props ?? {})) {
      if (typeof value === "string") expect(value.length, key).toBeLessThanOrEqual(64)
    }
  })

  test("#given a category configured with an unknown user model #when encoded #then only custom leaves the machine", () => {
    // given
    const config: OmoConfig = { categories: { quick: { model: "my-gateway/my-finetune", reasoningEffort: "low" } } }

    // when
    const { captured, observe } = harness(config, registry([{ provider: "my-gateway", id: "my-finetune" }]))
    observe("new")

    // then
    expect(captured[0]?.cat_quick).toBe("custom/custom/low")
  })

  test("#given an unchanged effective map #when observed twice #then only one row ships with a reused generation, and a changed map ships a new generation", () => {
    // given
    const config: OmoConfig = { categories: {} }
    const models: SenpiModelPort[] = [...FULL_REGISTRY.getAvailable() as readonly SenpiModelPort[]]
    const { captured, observe } = harness(config, registry2(() => models))

    // when
    observe("startup")
    observe("startup")
    models.length = 0
    observe("reload")

    // then
    expect(captured.map(({ config_generation }) => config_generation)).toEqual([0, 1])
    expect(captured[1]?.source).toBe("reload")
    expect(captured[0]?.combo_fingerprint).not.toBe(captured[1]?.combo_fingerprint)
  })

  test("#given a registry that throws #when observed #then nothing is captured and no error escapes", () => {
    // given
    const throwing: TaskModelRegistry = {
      getAvailable: () => {
        throw new Error("registry exploded")
      },
      find: () => undefined,
    }
    const { captured, observe } = harness({ categories: {} }, throwing)

    // when / then
    expect(() => observe("startup")).not.toThrow()
    expect(captured.map(({ cat_deep }) => cat_deep)).toEqual(["unavailable"])
  })
})

function registry2(models: () => readonly SenpiModelPort[]): TaskModelRegistry {
  return {
    getAvailable: () => models(),
    find: (provider, modelId) => models().find((model) => model.provider === provider && model.id === modelId),
  }
}
