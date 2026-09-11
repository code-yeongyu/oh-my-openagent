import { describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { decideDepthPolicy } from "../manager/depth-policy"

import { legacyOmoConfigAgentKeys, mapOmoConfigAgents } from "./omo-config-agents"

function config(agents: NonNullable<OmoConfig["agents"]>): OmoConfig {
  return { agents }
}

describe("mapOmoConfigAgents", () => {
  test("#given an omo.json agent with the full field set #when mapped #then snake_case config keys land on the camelCase AgentDefinition with the record key as name", () => {
    // given
    const source = config({
      reviewer: {
        description: "Reviews diffs",
        prompt: "You are a reviewer.",
        model: "openai/gpt-5",
        models: ["openai/gpt-5", "anthropic/claude"],
        execution_mode: "process",
        background: true,
        max_depth: 2,
        allowed_subagents: ["quick"],
        temperature: 0.4,
        disable: false,
      },
    })

    // when
    const agents = mapOmoConfigAgents(source)

    // then
    expect(agents.reviewer).toEqual({
      name: "reviewer",
      description: "Reviews diffs",
      prompt: "You are a reviewer.",
      model: "openai/gpt-5",
      models: ["openai/gpt-5", "anthropic/claude"],
      executionMode: "process",
      background: true,
      maxDepth: 2,
      allowedSubagents: ["quick"],
      temperature: 0.4,
      disable: false,
    })
  })

  test("#given the omo.json tools record #when mapped #then each boolean entry becomes a pattern/allow rule", () => {
    // given
    const source = config({
      builder: {
        tools: { read: true, bash: false },
      },
    })

    // when
    const agents = mapOmoConfigAgents(source)

    // then
    expect(agents.builder?.name).toBe("builder")
    expect(agents.builder?.tools).toEqual([
      { pattern: "read", allow: true },
      { pattern: "bash", allow: false },
    ])
  })

  test("#given an agent with only a name-worth of config #when mapped #then absent optional keys stay absent", () => {
    // given
    const source = config({ minimal: {} })

    // when
    const agents = mapOmoConfigAgents(source)

    // then
    expect(agents.minimal).toEqual({ name: "minimal" })
  })

  test("#given a config with no agents #when mapped #then the result is an empty record", () => {
    // given / when
    const agents = mapOmoConfigAgents({})

    // then
    expect(agents).toEqual({})
  })
})
describe("mapOmoConfigAgents legacy keys", () => {
  test("#given a legacy omo.json agent key #when mapped #then it lands on the canonical key", () => {
    // given
    const source = config({ momus: { prompt: "You are a reviewer." } })

    // when
    const agents = mapOmoConfigAgents(source)

    // then
    expect(Object.keys(agents)).toEqual(["plan-reviewer"])
    expect(agents["plan-reviewer"]).toMatchObject({ name: "plan-reviewer", prompt: "You are a reviewer." })
  })

  test("#given both the legacy and the canonical key #when mapped #then the canonical definition wins", () => {
    // given
    const source = config({
      momus: { prompt: "You are the legacy reviewer." },
      "plan-reviewer": { prompt: "You are the canonical reviewer." },
    })

    // when
    const agents = mapOmoConfigAgents(source)

    // then
    expect(Object.keys(agents)).toEqual(["plan-reviewer"])
    expect(agents["plan-reviewer"]).toMatchObject({ name: "plan-reviewer", prompt: "You are the canonical reviewer." })
  })

  test("#given allowed_subagents naming a legacy id #when mapped #then every entry is canonicalized", () => {
    // given
    const source = config({ foreman: { allowed_subagents: ["momus", "metis", "explore"] } })

    // when
    const agents = mapOmoConfigAgents(source)

    // then
    expect(agents.foreman?.allowedSubagents).toEqual(["plan-reviewer", "plan-consultant", "explore"])
  })
})

describe("legacyOmoConfigAgentKeys", () => {
  test("#given a config with legacy keys #when listed #then each legacy key pairs with its canonical key", () => {
    // given
    const source = config({
      momus: {},
      metis: {},
      "plan-reviewer": {},
      explore: {},
    })

    // when
    const pairs = legacyOmoConfigAgentKeys(source)

    // then
    expect(pairs).toEqual([
      { legacy: "metis", canonical: "plan-consultant" },
      { legacy: "momus", canonical: "plan-reviewer" },
    ])
  })

test("#given allowed_subagents naming a legacy id #when the depth policy runs against the canonical target #then the canonical entry admits it", () => {
    // given
    const source = config({ foreman: { allowed_subagents: ["momus"], max_depth: 1 } })
    const agents = mapOmoConfigAgents(source)

    // when: a child targets the canonical id at a depth beyond maxDepth
    const decision = decideDepthPolicy({
      childDepth: 5,
      maxDepth: 1,
      targetAgentType: "plan-reviewer",
      allowedSubagents: agents.foreman?.allowedSubagents,
    })

    // then: the canonicalized entry admits it
    expect(decision).toEqual({ allowed: true, reason: "allowed-subagent" })
  })

  test("#given a config with only canonical keys #when listed #then the result is empty", () => {
    // given / when / then
    expect(legacyOmoConfigAgentKeys(config({ "plan-reviewer": {}, explore: {} }))).toEqual([])
    expect(legacyOmoConfigAgentKeys({})).toEqual([])
  })
})
