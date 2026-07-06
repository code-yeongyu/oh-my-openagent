import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { BUILTIN_CATEGORY_DEFAULTS, resolveCategory } from "./index"

type FakeModel = {
  readonly provider: string
  readonly id: string
  readonly name: string
}

type FakeRegistry = {
  readonly getAvailable: () => readonly FakeModel[]
  readonly find: (provider: string, modelId: string) => FakeModel | undefined
}

function model(provider: string, id: string): FakeModel {
  return { provider, id, name: `${provider}/${id}` }
}

function registry(models: readonly FakeModel[]): FakeRegistry {
  return {
    getAvailable: () => models,
    find: (provider, modelId) =>
      models.find((candidate) => candidate.provider === provider && candidate.id === modelId),
  }
}

function expectResolved(result: ReturnType<typeof resolveCategory<FakeModel>>): Extract<typeof result, { readonly kind: "resolved" }> {
  if (result.kind !== "resolved") {
    throw new Error(`Expected resolved category, got ${result.kind}`)
  }
  return result
}

describe("resolveCategory", () => {
  test("#given a builtin category and omo overlay #when resolved #then user config wins and prompt text is appended", () => {
    // given
    const models = registry([model("anthropic", "claude-opus-4-7")])

    // when
    const result = resolveCategory(
      "ultrabrain",
      {
        categories: {
          ultrabrain: {
            model: "anthropic/claude-opus-4-7",
            variant: "max",
            prompt_append: "USER OVERLAY PROMPT",
          },
        },
      },
      models,
    )

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("anthropic")
    expect(resolved.spec.modelId).toBe("claude-opus-4-7")
    expect(resolved.spec.variant).toBe("max")
    expect(resolved.spec.prompt_append).toContain("DEEP LOGICAL REASONING")
    expect(resolved.spec.prompt_append).toEndWith("\n\nUSER OVERLAY PROMPT")
  })

  test("#given a disabled omo category overlay #when resolved #then a disabled result explains the reason", () => {
    // given
    const models = registry([model("openai", "gpt-5.5")])

    // when
    const result = resolveCategory(
      "ultrabrain",
      { categories: { ultrabrain: { disable: true } } },
      models,
    )

    // then
    expect(result.kind).toBe("disabled")
    if (result.kind !== "disabled") throw new Error("Expected disabled result")
    expect(result.reason).toContain("disabled")
    expect(result.availableCategories).toContain("ultrabrain")
  })

  test("#given primary model is unavailable and omo fallback exists #when resolved #then delegate-core fallback reaches the registry model", () => {
    // given
    const models = registry([model("google", "gemini-3.1-pro")])

    // when
    const result = resolveCategory(
      "ultrabrain",
      { categories: { ultrabrain: { fallback_models: ["google/gemini-3.1-pro high"] } } },
      models,
    )

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.provider).toBe("google")
    expect(resolved.spec.modelId).toBe("gemini-3.1-pro")
    expect(resolved.spec.variant).toBe("high")
    expect(resolved.modelSelection.matchedFallback).toBe(true)
  })

  test("#given selected model is absent from registry #when resolved #then unavailable result names attempted and available models", () => {
    // given
    const models = registry([model("anthropic", "claude-sonnet-4-6")])

    // when
    const result = resolveCategory(
      "quick",
      { categories: { quick: { model: "openai/not-installed" } } },
      models,
    )

    // then
    expect(result.kind).toBe("model_unavailable")
    if (result.kind !== "model_unavailable") throw new Error("Expected unavailable result")
    expect(result.category).toBe("quick")
    expect(result.attemptedModel).toBe("openai/not-installed")
    expect(result.availableModels).toEqual(["anthropic/claude-sonnet-4-6"])
    expect(result.nearestFallback).toBeUndefined()
  })

  test("#given category params in omo overlay #when resolved #then child spec carries generation params and prompt append", () => {
    // given
    const models = registry([model("openai", "gpt-5.4-mini")])

    // when
    const result = resolveCategory(
      "quick",
      {
        categories: {
          quick: {
            temperature: 0.3,
            top_p: 0.8,
            maxTokens: 4096,
            thinking: { type: "enabled", budgetTokens: 1024 },
            reasoningEffort: "medium",
            prompt_append: "EXTRA QUICK CONTEXT",
          },
        },
      },
      models,
    )

    // then
    const resolved = expectResolved(result)
    expect(resolved.spec.temperature).toBe(0.3)
    expect(resolved.spec.top_p).toBe(0.8)
    expect(resolved.spec.maxTokens).toBe(4096)
    expect(resolved.spec.thinking).toEqual({ type: "enabled", budgetTokens: 1024 })
    expect(resolved.spec.reasoningEffort).toBe("medium")
    expect(resolved.spec.prompt_append).toContain("SMALL / QUICK")
    expect(resolved.spec.prompt_append).toEndWith("\n\nEXTRA QUICK CONTEXT")
  })
})

describe("builtin category defaults", () => {
  test("#given ported builtin defaults #when snapshotted #then all eight category defaults stay pinned", () => {
    // given
    const defaults = BUILTIN_CATEGORY_DEFAULTS

    // when
    const snapshotSubject = defaults.map(({ config, description, name, promptAppend }) => ({
      name,
      config,
      description,
      promptAppend,
    }))

    // then
    expect(JSON.stringify(snapshotSubject, null, 2)).toMatchSnapshot()
    expect(defaults.map((entry) => entry.name)).toEqual([
      "visual-engineering",
      "artistry",
      "ultrabrain",
      "deep",
      "quick",
      "unspecified-low",
      "unspecified-high",
      "writing",
    ])
  })
})

describe("delegate-core model order guard", () => {
  test("#given category source files #when statically audited #then resolver imports delegate-core and avoids local order logic", () => {
    // given
    const categoryDir = new URL(".", import.meta.url).pathname
    const source = readdirSync(categoryDir)
      .filter((fileName) => fileName.endsWith(".ts") && !fileName.endsWith(".test.ts"))
      .map((fileName) => readFileSync(join(categoryDir, fileName), "utf8"))
      .join("\n")

    // when
    const callsDelegateCore = source.includes("resolveModelForDelegateTask(")
    const importsDelegateCore = source.includes('from "@oh-my-opencode/delegate-core"')
    const importsOmoOpencode = /from\s+["'][^"']*omo-opencode/.test(source)
    const suspiciousOrderPhrases = [
      "user model override",
      "cold-cache",
      "category default",
      "hardcoded fallbackChain",
      "system default",
    ].filter((phrase) => source.includes(phrase))

    // then
    expect(importsDelegateCore).toBe(true)
    expect(callsDelegateCore).toBe(true)
    expect(importsOmoOpencode).toBe(false)
    expect(suspiciousOrderPhrases).toEqual([])
  })
})
