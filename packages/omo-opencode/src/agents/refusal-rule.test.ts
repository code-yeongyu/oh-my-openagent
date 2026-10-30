import { describe, expect, test } from "bun:test"
import { type AtlasPromptSource, createAtlasAgent, getAtlasPromptSource } from "./atlas/agent"
import { getHephaestusPrompt, getHephaestusPromptSource, type HephaestusPromptSource } from "./hephaestus/agent"
import { REFUSAL_IS_FINAL_RULE } from "./refusal-rule"
import { createSisyphusAgent, resolveSisyphusPromptFamily, type SisyphusPromptFamily } from "./sisyphus-agent-factory"
import {
  buildSisyphusJuniorPrompt,
  getSisyphusJuniorPromptSource,
  type SisyphusJuniorPromptSource,
} from "./sisyphus-junior/agent"

// Record<Union, model> makes the route list exhaustive at compile time: a new prompt route without a
// model here fails typecheck, so no route can miss the rule.
const SISYPHUS_ROUTES: Record<SisyphusPromptFamily, string> = {
  "kimi-k3-1": "kimi-coding/k3.1-pro",
  "kimi-k3": "opencode-go/kimi-k3",
  "kimi-k2-7": "kimi-for-coding/k2p7",
  "kimi-k2-6": "moonshotai/kimi-k2.6",
  "gpt-5-5": "openai/gpt-5.5",
  "gpt-5-4": "openai/gpt-5.4",
  "claude-fable-5": "anthropic/claude-fable-5",
  "claude-opus-5": "anthropic/claude-opus-5",
  "claude-opus-4-8": "anthropic/claude-opus-4-8",
  "claude-opus-4-7": "anthropic/claude-opus-4-7",
  "glm-5-2": "zai/glm-5.2",
  "grok-4": "xai/grok-4.5",
  fallback: "anthropic/claude-sonnet-4-6",
}

const JUNIOR_ROUTES: Record<SisyphusJuniorPromptSource, string> = {
  default: "anthropic/claude-sonnet-5",
  "kimi-k2": "moonshotai/kimi-k2.6",
  "kimi-k2-7": "kimi-for-coding/k2p7",
  "kimi-k3": "opencode-go/kimi-k3",
  "kimi-k3-1": "kimi-coding/k3.1-pro",
  gpt: "openai/gpt-5.2",
  "gpt-5-5": "openai/gpt-5.5",
  "gpt-5-4": "openai/gpt-5.4",
  gemini: "google/gemini-3.1-pro",
  "glm-5-2": "zai/glm-5.2",
}

const HEPHAESTUS_ROUTES: Record<HephaestusPromptSource, string> = {
  "gpt-5-6": "openai/gpt-6-astra",
  "gpt-5-5": "openai/gpt-5.5",
  "gpt-5-4": "openai/gpt-5.4",
  gpt: "openai/gpt-5.3-codex",
}

const ATLAS_ROUTES: Record<AtlasPromptSource, string> = {
  default: "anthropic/claude-sonnet-4-6",
  gpt: "openai/gpt-5.5",
  gemini: "google/gemini-3.1-pro",
  kimi: "moonshotai/kimi-k2.6",
  "kimi-k3": "opencode-go/kimi-k3",
  "kimi-k3-1": "kimi-coding/k3.1-pro",
  "kimi-k2-7": "kimi-for-coding/k2p7",
  "opus-4-7": "anthropic/claude-opus-4-7",
  glm: "zai/glm-5.2",
}

const once = (prompt: string) => prompt.split(REFUSAL_IS_FINAL_RULE).length - 1

describe("every agent prompt route carries the refusal-is-final rule exactly once", () => {
  test.each(Object.entries(SISYPHUS_ROUTES))("#given Sisyphus route %s #then its prompt carries the rule", (family, model) => {
    expect(resolveSisyphusPromptFamily(model)).toBe(family as SisyphusPromptFamily)
    expect(once(createSisyphusAgent(model).prompt ?? "")).toBe(1)
  })

  test.each(Object.entries(JUNIOR_ROUTES))("#given Sisyphus-Junior route %s #then its prompt carries the rule", (source, model) => {
    expect(getSisyphusJuniorPromptSource(model)).toBe(source as SisyphusJuniorPromptSource)
    expect(once(buildSisyphusJuniorPrompt(model, false))).toBe(1)
    expect(once(buildSisyphusJuniorPrompt(model, true, "appended by the user"))).toBe(1)
  })

  test.each(Object.entries(HEPHAESTUS_ROUTES))("#given Hephaestus route %s #then its prompt carries the rule", (source, model) => {
    expect(getHephaestusPromptSource(model)).toBe(source as HephaestusPromptSource)
    expect(once(getHephaestusPrompt(model))).toBe(1)
  })

  test.each(Object.entries(ATLAS_ROUTES))("#given Atlas route %s #then its prompt carries the rule", (source, model) => {
    expect(getAtlasPromptSource(model)).toBe(source as AtlasPromptSource)
    expect(once(createAtlasAgent({ model }).prompt ?? "")).toBe(1)
  })
})
