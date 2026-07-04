/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import {
  applyCodexAgentModelOverride,
  parseCodexAgentModelOverrides,
  unknownCodexAgentModelOverrideWarnings,
} from "./codex-agent-model-overrides"

describe("parseCodexAgentModelOverrides", () => {
  test("loads supported string settings from agent tables", () => {
    const parsed = parseCodexAgentModelOverrides(`
[agents.plan]
model = "gpt-5.5"
model_reasoning_effort = "xhigh"
service_tier = 'priority'

[agents.explorer]
model = "gpt-5.4-mini" # inline comments are allowed
`)

    expect(parsed.warnings).toEqual([])
    expect(parsed.agents.get("plan")).toEqual({
      model: "gpt-5.5",
      modelReasoningEffort: "xhigh",
      serviceTier: "priority",
    })
    expect(parsed.agents.get("explorer")).toEqual({ model: "gpt-5.4-mini" })
  })

  test("warns and skips unsupported or non-string agent settings", () => {
    const parsed = parseCodexAgentModelOverrides(`
[agents.plan]
model = "gpt-5.5"
temperature = 0.1
model_reasoning_effort = 1
`)

    expect(parsed.agents.get("plan")).toEqual({ model: "gpt-5.5" })
    expect(parsed.warnings).toEqual([
      "[agents.plan].temperature is not supported; override skipped",
      "[agents.plan].model_reasoning_effort must be a string; override skipped",
    ])
  })
})

describe("applyCodexAgentModelOverride", () => {
  test("replaces and inserts top-level agent settings without touching TOML tables", () => {
    const updated = applyCodexAgentModelOverride(
      'name = "plan"\nmodel = "gpt-5.5"\n\n[tools]\nallowed = ["Read"]\n',
      {
        model: "gpt-5.4-mini",
        modelReasoningEffort: "low",
        serviceTier: "priority",
      },
    )

    expect(updated).toBe(
      'name = "plan"\nmodel = "gpt-5.4-mini"\nmodel_reasoning_effort = "low"\nservice_tier = "priority"\n\n[tools]\nallowed = ["Read"]\n',
    )
  })

  test("replaces existing top-level non-string settings instead of appending duplicate keys", () => {
    const updated = applyCodexAgentModelOverride(
      'name = "plan"\nmodel = 1\nmodel_reasoning_effort = false\nservice_tier = ["fast"]\n\n[tools]\nmodel = 2\n',
      {
        model: "gpt-5.4-mini",
        modelReasoningEffort: "low",
        serviceTier: "priority",
      },
    )

    expect(updated).toBe(
      'name = "plan"\nmodel = "gpt-5.4-mini"\nmodel_reasoning_effort = "low"\nservice_tier = "priority"\n\n[tools]\nmodel = 2\n',
    )
  })
})

describe("unknownCodexAgentModelOverrideWarnings", () => {
  test("warns only for configured agent names outside the managed set", () => {
    const warnings = unknownCodexAgentModelOverrideWarnings({
      configuredAgents: ["plan", "codex-ultrawork-reviewer"],
      knownAgentNames: new Set(["plan"]),
      sourcePath: "/tmp/codex/omo.toml",
    })

    expect(warnings).toEqual([
      "/tmp/codex/omo.toml: [agents.codex-ultrawork-reviewer] does not match a LazyCodex-managed Codex agent; override skipped",
    ])
  })
})
