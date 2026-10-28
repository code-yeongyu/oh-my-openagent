import { expect, test } from "bun:test"
import { AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS, LATEST_MODEL_BY_FAMILY } from "@oh-my-opencode/model-core"
import { getEditorPresetPolicy } from "./preset-policy"

test("every preset explicitly covers all current agents and categories with nonempty candidate chains", () => {
  for (const id of ["performance", "balanced", "budget"]) {
    const roles = getEditorPresetPolicy(id)
    expect(roles.filter((role) => role.section === "agents").map((role) => role.name)).toEqual(Object.keys(AGENT_MODEL_REQUIREMENTS))
    expect(roles.filter((role) => role.section === "categories").map((role) => role.name)).toEqual(Object.keys(CATEGORY_MODEL_REQUIREMENTS))
    expect(roles.every((role) => role.candidates.length > 0)).toBe(true)
  }
  expect(() => getEditorPresetPolicy("unknown")).toThrow("Unknown built-in preset")
})

test("performance follows each current requirement chain in model and provider order", () => {
  const roles = getEditorPresetPolicy("performance")
  for (const [section, requirements] of [["agents", AGENT_MODEL_REQUIREMENTS], ["categories", CATEGORY_MODEL_REQUIREMENTS]] as const) {
    for (const [name, requirement] of Object.entries(requirements)) {
      const expected = [...new Set(requirement.fallbackChain.flatMap((rung) => rung.providers.map((provider) => `${provider}/${rung.model}`)))]
      const candidates = roles.find((role) => role.section === section && role.name === name)?.candidates ?? []
      expect(candidates.filter((candidate) => !candidate.startsWith("openrouter/"))).toEqual(expected)
    }
  }
})

test("routed aliases preserve requirement model priority ahead of lower direct-provider rungs", () => {
  const sisyphus = getEditorPresetPolicy("performance").find((role) => role.name === "sisyphus")?.candidates ?? []
  expect(sisyphus.slice(0, 5)).toEqual([
    `anthropic/${LATEST_MODEL_BY_FAMILY.claudeOpus}`,
    `github-copilot/${LATEST_MODEL_BY_FAMILY.claudeOpus}`,
    `opencode/${LATEST_MODEL_BY_FAMILY.claudeOpus}`,
    `openrouter/anthropic/${LATEST_MODEL_BY_FAMILY.claudeOpus}`,
    `opencode-go/${LATEST_MODEL_BY_FAMILY.kimi}`,
  ])
})

test("cost tiers retain GPT-only Hephaestus and existing vision candidates without premium fallthrough", () => {
  const visionModels = new Set(AGENT_MODEL_REQUIREMENTS["multimodal-looker"]?.fallbackChain.map((rung) => rung.model))
  for (const id of ["balanced", "budget"]) {
    const roles = getEditorPresetPolicy(id)
    expect(roles.find((role) => role.name === "hephaestus")?.candidates).toEqual([
      "openai/gpt-5.6-sol", "chatgpt-subscription/gpt-5.6-sol", "github-copilot/gpt-5.6-sol",
      "opencode/gpt-5.6-sol", "openrouter/openai/gpt-5.6-sol",
    ])
    expect(roles.find((role) => role.name === "multimodal-looker")?.candidates.every((model) => [...visionModels].some((id) => model.endsWith(`/${id}`)))).toBe(true)
    expect(roles.every((role) => role.candidates.every((model) => !/opus|fable|astra|argon/.test(model)))).toBe(true)
  }
})

test("budget keeps stronger planning families while choosing smaller models for simple work", () => {
  const roles = getEditorPresetPolicy("budget")
  for (const name of ["sisyphus", "prometheus", "metis", "momus", "oracle", "atlas"]) {
    const chain = roles.find((role) => role.name === name)?.candidates ?? []
    expect(chain[0]).toBe(`opencode-go/${LATEST_MODEL_BY_FAMILY.kimi}`)
    expect(chain.every((model) => model.endsWith(`/${LATEST_MODEL_BY_FAMILY.kimi}`) || model.endsWith(`/${LATEST_MODEL_BY_FAMILY.glm}`))).toBe(true)
  }
  for (const name of ["explore", "librarian", "sisyphus-junior", "quick", "writing", "unspecified-low"]) {
    const chain = roles.find((role) => role.name === name)?.candidates ?? []
    expect(chain[0]).toBe(`anthropic/${LATEST_MODEL_BY_FAMILY.claudeHaiku}`)
    expect(chain.every((model) => /haiku|deepseek-flash|luna-fast/.test(model))).toBe(true)
  }
})

test("new roles have no cost-tier policy until explicitly curated", () => {
  AGENT_MODEL_REQUIREMENTS["future-agent"] = { fallbackChain: [{ model: "gpt-5.6-sol", providers: ["openai"] }] }
  CATEGORY_MODEL_REQUIREMENTS["future-category"] = { fallbackChain: [{ model: "gpt-5.6-sol", providers: ["openai"] }] }
  try {
    for (const id of ["balanced", "budget"]) {
      const roles = getEditorPresetPolicy(id)
      expect(roles.find((role) => role.name === "future-agent")?.candidates).toEqual([])
      expect(roles.find((role) => role.name === "future-category")?.candidates).toEqual([])
    }
    expect(getEditorPresetPolicy("performance").find((role) => role.name === "future-agent")?.candidates).toEqual(["openai/gpt-5.6-sol", "openrouter/openai/gpt-5.6-sol"])
  } finally {
    delete AGENT_MODEL_REQUIREMENTS["future-agent"]
    delete CATEGORY_MODEL_REQUIREMENTS["future-category"]
  }
})
