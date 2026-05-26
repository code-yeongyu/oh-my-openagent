import { describe, expect, test } from "bun:test"
import type { PromptSource, VariantTable } from "./types"
import { resolveVariant } from "./variant-resolver"

const promptSource = (baseDir: string): PromptSource => ({ baseDir })

const variants = {
  planner: promptSource("/prompts/planner"),
  gpt: promptSource("/prompts/gpt"),
  gemini: promptSource("/prompts/gemini"),
  kimi: promptSource("/prompts/kimi"),
  glm: promptSource("/prompts/glm"),
  default: promptSource("/prompts/default"),
} satisfies VariantTable

describe("resolveVariant", () => {
  test("#given Claude Opus 4.7 model #then resolves default variant", () => {
    expect(resolveVariant({ modelID: "claude-opus-4-7", variants })).toBe("default")
  })

  test("#given GPT model #then resolves gpt variant", () => {
    expect(resolveVariant({ modelID: "gpt-5-5", variants })).toBe("gpt")
  })

  test("#given Gemini model #then resolves gemini variant", () => {
    expect(resolveVariant({ modelID: "gemini-3-1-pro", variants })).toBe("gemini")
  })

  test("#given Kimi K2 model #then resolves kimi variant", () => {
    expect(resolveVariant({ modelID: "kimi-k2-6", variants })).toBe("kimi")
  })

  test("#given GLM model #then resolves glm variant", () => {
    expect(resolveVariant({ modelID: "glm-5-1", variants })).toBe("glm")
  })

  test("#given Prometheus agent #then planner overrides model variant", () => {
    expect(resolveVariant({ agentName: "prometheus", modelID: "gpt-5-5", variants })).toBe(
      "planner"
    )
  })

  test("#given unknown model #then falls back to default variant", () => {
    expect(resolveVariant({ modelID: "claude-haiku-4-5", variants })).toBe("default")
  })

  test("#given empty variants table #then throws TypeError", () => {
    expect(() => resolveVariant({ modelID: "gpt-5-5", variants: {} })).toThrow(TypeError)
  })
})
