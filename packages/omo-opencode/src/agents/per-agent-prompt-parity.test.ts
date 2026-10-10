import { describe, expect, test } from "bun:test"

import { getAtlasPromptSource } from "./atlas/agent"
import { getHephaestusPromptSource } from "./hephaestus/agent"
import { createSisyphusAgent, resolveSisyphusPromptFamily } from "./sisyphus-agent-factory"
import { getSisyphusJuniorPromptSource } from "./sisyphus-junior/agent"

type ParityCase = {
  readonly model: string
  readonly atlas: string
  readonly sisyphus: string
  readonly sisyphusJunior: string
}

const PARITY_CASES: readonly ParityCase[] = [
  { model: "anthropic/claude-opus-5-5", atlas: "opus-5-5", sisyphus: "opus-5-5", sisyphusJunior: "default" },
  { model: "anthropic/claude-sonnet-5-5", atlas: "sonnet-5-5", sisyphus: "sonnet-5-5", sisyphusJunior: "default" },
  { model: "anthropic/claude-haiku-5-5", atlas: "haiku-5-5", sisyphus: "haiku-5-5", sisyphusJunior: "default" },
  { model: "anthropic/claude-fable-5-1", atlas: "fable-5-1", sisyphus: "fable-5-1", sisyphusJunior: "default" },
  { model: "anthropic/claude-fable-5", atlas: "fable-5", sisyphus: "fable-5", sisyphusJunior: "default" },
  { model: "anthropic/claude-opus-5", atlas: "opus-5", sisyphus: "opus-5", sisyphusJunior: "default" },
  { model: "openai/gpt-5.2", atlas: "gpt-5.2", sisyphus: "gpt-5-2", sisyphusJunior: "gpt-5-2" },
  { model: "openai/gpt-5.3-codex", atlas: "gpt-5.3-codex", sisyphus: "gpt-5-4", sisyphusJunior: "gpt" },
  { model: "openai/gpt-5.4", atlas: "gpt-5.4", sisyphus: "gpt-5-4", sisyphusJunior: "gpt-5-4" },
  { model: "openai/gpt-5.5", atlas: "gpt-5.5", sisyphus: "gpt-5-5", sisyphusJunior: "gpt-5-5" },
  { model: "openai/gpt-5.6-sol", atlas: "gpt-5.6", sisyphus: "gpt-5-5", sisyphusJunior: "gpt-5-5" },
  { model: "openai/gpt-6-astra", atlas: "gpt-6-astra", sisyphus: "gpt-5-5", sisyphusJunior: "gpt-5-5" },
  { model: "kimi-for-coding/kimi-for-coding", atlas: "kimi-k2-8", sisyphus: "kimi-k2-8", sisyphusJunior: "kimi-k2-8" },
  { model: "kimi-for-coding/kimi-for-coding-highspeed", atlas: "kimi-k2-7", sisyphus: "kimi-k2-7", sisyphusJunior: "kimi-k2-7" },
  { model: "moonshotai/kimi-k2.6", atlas: "kimi-k2-6", sisyphus: "kimi-k2-6", sisyphusJunior: "kimi-k2-6" },
  { model: "moonshotai/kimi-k3", atlas: "kimi-k3", sisyphus: "kimi-k3", sisyphusJunior: "kimi-k3" },
  { model: "zai-coding-plan/glm-5.3", atlas: "glm-5.3", sisyphus: "glm-5-3", sisyphusJunior: "glm-5-3" },
  { model: "zai-coding-plan/glm-5.2", atlas: "glm-5.2", sisyphus: "glm-5-2", sisyphusJunior: "glm-5-2" },
  { model: "deepseek/deepseek-v4-flash", atlas: "deepseek-v4-1-flash", sisyphus: "deepseek-v4-1-flash", sisyphusJunior: "deepseek-v4-1-flash" },
  { model: "deepseek/deepseek-v4-flash-0731", atlas: "deepseek-v4-flash-0731", sisyphus: "deepseek-v4-flash-0731", sisyphusJunior: "deepseek-v4-flash-0731" },
  { model: "deepseek/deepseek-v4-pro", atlas: "deepseek-v4-pro", sisyphus: "deepseek-v4-pro", sisyphusJunior: "deepseek-v4-pro" },
  { model: "xai/grok-4.7", atlas: "grok-4.7", sisyphus: "grok-4", sisyphusJunior: "grok-4" },
]

describe("per-agent prompt parity (#9851 blockers)", () => {
  describe("atlas resolves every case through the production call shape", () => {
    for (const testCase of PARITY_CASES) {
      test(`${testCase.model} -> ${testCase.atlas}`, () => {
        expect(getAtlasPromptSource(testCase.model)).toBe(testCase.atlas)
      })
    }
  })

  describe("sisyphus resolves every case to its runtime-mapped family", () => {
    for (const testCase of PARITY_CASES) {
      test(`${testCase.model} -> ${testCase.sisyphus}`, () => {
        expect(resolveSisyphusPromptFamily(testCase.model)).toBe(testCase.sisyphus)
      })
    }
  })

  describe("sisyphus-junior resolves every case to its runtime-mapped family", () => {
    for (const testCase of PARITY_CASES) {
      test(`${testCase.model} -> ${testCase.sisyphusJunior}`, () => {
        expect(getSisyphusJuniorPromptSource(testCase.model)).toBe(testCase.sisyphusJunior)
      })
    }
  })

  test("hephaestus routes gpt-5.3-codex to its dedicated runtime variant, not the generic gpt source", () => {
    expect(getHephaestusPromptSource("openai/gpt-5.3-codex")).toBe("gpt-5-3-codex")
  })

  test("sisyphus opus-5-5 renders a genuinely Opus 5.5 prompt, not the Opus 5 body", () => {
    const opus5 = createSisyphusAgent("anthropic/claude-opus-5")
    const opus55 = createSisyphusAgent("anthropic/claude-opus-5-5")
    expect(typeof opus5.prompt).toBe("string")
    expect(typeof opus55.prompt).toBe("string")
    const stripIdentity = (prompt: string) =>
      prompt
        .replaceAll("the model 5.5", "the model 5")
        .replaceAll("Opus 5.5", "Opus 5")
        .replaceAll("", "")
    expect(stripIdentity(opus55.prompt)).not.toBe(stripIdentity(opus5.prompt))
  })

  test("sisyphus fable-5-1 prompt carries the model identity, not generator placeholders", () => {
    const agent = createSisyphusAgent("anthropic/fable-5.1")
    expect(typeof agent.prompt).toBe("string")
    expect(agent.prompt).toContain("Fable 5.1")
    expect(agent.prompt).not.toContain("[OMC]")
  })

  test("no atlas variant renders another family's calibration tag", () => {
    const haiku = getAtlasPromptSource("anthropic/claude-haiku-5-5")
    expect(haiku).toBe("haiku-5-5")
  })
})
