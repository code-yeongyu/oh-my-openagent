import { describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { describeModelChains, type ModelChainEntry } from "./index"

const SELECTORS = [
  "anthropic/claude-fable-5-1",
  "anthropic/claude-opus-5-5",
  "kimi-for-coding/k3",
  "kimi-for-coding/kimi-for-coding-highspeed",
]
const MODELS = SELECTORS.map((selector) => ({ provider: selector.slice(0, selector.indexOf("/")), id: selector.slice(selector.indexOf("/") + 1) }))
const REGISTRY = {
  getAvailable: () => MODELS,
  find: (provider: string, id: string) => MODELS.find((model) => model.provider === provider && model.id === id),
}

function entry(config: OmoConfig, kind: "categories" | "agents", name: string): ModelChainEntry {
  const found = describeModelChains(config, REGISTRY)[kind].find((candidate) => candidate.name === name)
  if (found === undefined) throw new Error(`no ${kind} entry named ${name}`)
  return found
}

describe("describeModelChains", () => {
  test("#given a builtin-only category #when described #then the runtime chain is the builtin rungs in order", () => {
    // when
    const artistry = entry({}, "categories", "artistry")

    // then
    expect(artistry).toEqual({
      kind: "category",
      name: "artistry",
      status: "resolved",
      primary: "anthropic/claude-fable-5-1",
      runtime: ["anthropic/claude-fable-5-1", "anthropic/claude-opus-5-5", "kimi-for-coding/k3"],
      rungs: [
        { model: "anthropic/claude-fable-5-1", source: "built-in", state: "primary" },
        { model: "anthropic/claude-opus-5-5", source: "built-in", state: "fallback" },
        { model: "kimi-for-coding/k3", source: "built-in", state: "fallback" },
      ],
    })
  })

  test("#given an omo.json override on a later rung #when described #then the earlier builtin rung is not reached and the later one is appended", () => {
    // given
    const config: OmoConfig = { categories: { artistry: { model: "anthropic/claude-opus-5-5" } } }

    // when
    const artistry = entry(config, "categories", "artistry")

    // then
    expect(artistry.runtime).toEqual(["anthropic/claude-opus-5-5", "kimi-for-coding/k3"])
    expect(artistry.rungs).toEqual([
      { model: "anthropic/claude-opus-5-5", source: "omo.json", state: "primary" },
      { model: "anthropic/claude-fable-5-1", source: "built-in", state: "not-reached" },
      { model: "kimi-for-coding/k3", source: "built-in", state: "fallback" },
    ])
  })

  test("#given exclude_models #when described #then the excluded rung is named with the entry and the next rung leads", () => {
    // given
    const config: OmoConfig = { exclude_models: ["claude-fable-*"] }

    // when
    const report = describeModelChains(config, REGISTRY)
    const artistry = entry(config, "categories", "artistry")

    // then
    expect(report.excludeModels).toEqual(["claude-fable-*"])
    expect(artistry.primary).toBe("anthropic/claude-opus-5-5")
    expect(artistry.rungs[0]).toEqual({ model: "anthropic/claude-fable-5-1", source: "built-in", state: "excluded", excludedBy: "claude-fable-*" })
  })

  test("#given a builtin agent with rungs nobody is logged in for #when described #then those rungs are marked no-login with their providers", () => {
    // when
    const explore = entry({}, "agents", "explore")

    // then
    expect(explore.status).toBe("resolved")
    expect(explore.runtime).toEqual(["kimi-for-coding/kimi-for-coding-highspeed"])
    expect(explore.rungs.slice(0, 2)).toEqual([
      { model: "kimi-for-coding/kimi-for-coding-highspeed", source: "built-in", state: "primary" },
      { model: "gpt-6-luna-fast", source: "built-in", state: "no-login", providers: ["chatgpt-subscription", "openai"] },
    ])
  })

  test("#given an omo.json agent and a disabled category #when described #then the agent's own rung is tagged omo.json and the category says disabled", () => {
    // given
    const config: OmoConfig = { agents: { scout: { models: ["anthropic/claude-opus-5-5"] } }, categories: { artistry: { disable: true } } }

    // when
    const scout = entry(config, "agents", "scout")
    const artistry = entry(config, "categories", "artistry")

    // then
    expect(scout.rungs).toEqual([{ model: "anthropic/claude-opus-5-5", source: "omo.json", state: "primary" }])
    expect(artistry.status).toBe("disabled")
    expect(artistry.runtime).toEqual([])
  })
})
