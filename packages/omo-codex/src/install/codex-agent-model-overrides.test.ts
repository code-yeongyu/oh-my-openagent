/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  applyCodexAgentModelOverride,
  getCodexAgentModelOverrides,
  resolveCodexAgentModelOverrides,
  unknownCodexAgentModelOverrideWarnings,
} from "./codex-agent-model-overrides"

const temporaryDirectories: string[] = []

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

function writeOmoConfig(root: string, value: unknown): void {
  const directory = join(root, ".omo")
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, "omo.jsonc"), JSON.stringify(value))
}

function writeLegacyOmoConfig(root: string, value: unknown): void {
  const directory = join(root, ".omo")
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, "config.jsonc"), JSON.stringify(value))
}

function overrideEntries(result: ReturnType<typeof resolveCodexAgentModelOverrides>): Record<string, unknown> {
  return Object.fromEntries([...result.agents.entries()].sort(([left], [right]) => left.localeCompare(right)))
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("getCodexAgentModelOverrides", () => {
  test("uses the effective user/project/codex/profile view from the canonical loader", () => {
    const homeDir = temporaryDirectory("omo-agent-overrides-home-")
    const cwd = temporaryDirectory("omo-agent-overrides-project-")
    writeOmoConfig(homeDir, {
      agents: {
        plan: { model: "user/base", reasoning: "low", provider_options: { service_tier: "standard" } },
      },
      "[codex]": {
        agents: { plan: { model: "user/codex", reasoning: "medium" } },
      },
      profiles: {
        focused: {
          agents: { plan: { model: "user/profile", provider_options: { service_tier: "flex" } } },
          "[codex]": { agents: { plan: { model: "user/profile-codex" } } },
        },
      },
    })
    writeOmoConfig(cwd, {
      agents: { plan: { model: "project/base" } },
      "[codex]": { agents: { plan: { reasoning: "high" } } },
      profiles: {
        focused: {
          agents: { plan: { provider_options: { service_tier: "priority" } } },
          "[codex]": { agents: { plan: { model: "project/profile-codex", reasoning: "off" } } },
        },
      },
    })

    const result = getCodexAgentModelOverrides({ cwd, homeDir, env: {}, profile: "focused" })

    expect(result.agents.get("plan")).toEqual({
      model: "project/profile-codex",
      modelReasoningEffort: "none",
      serviceTier: "priority",
    })
    expect(result.warnings).toEqual([])
  })

  test("returns an empty override map when no canonical config exists", () => {
    const homeDir = temporaryDirectory("omo-agent-overrides-empty-home-")
    const cwd = temporaryDirectory("omo-agent-overrides-empty-project-")

    const result = getCodexAgentModelOverrides({ cwd, homeDir, env: {} })

    expect(result.agents.size).toBe(0)
    expect(result.warnings).toEqual([])
  })

  test("keeps loader diagnostics as non-fatal warnings", () => {
    const homeDir = temporaryDirectory("omo-agent-overrides-invalid-home-")
    const cwd = temporaryDirectory("omo-agent-overrides-invalid-project-")
    writeOmoConfig(homeDir, { agents: { plan: { model: 42 } } })

    const result = getCodexAgentModelOverrides({ cwd, homeDir, env: {} })

    expect(result.agents.size).toBe(0)
    expect(result.warnings.some((warning) => warning.includes("Invalid omo config"))).toBe(true)
  })

  test("migrates and reads a legacy config.jsonc agent override with a non-fatal warning", () => {
    const homeDir = temporaryDirectory("omo-agent-overrides-legacy-home-")
    const cwd = temporaryDirectory("omo-agent-overrides-legacy-project-")
    writeLegacyOmoConfig(homeDir, {
      "[codex]": {
        agents: {
          plan: {
            model: "openai/gpt-5.6-sol",
            reasoning: "off",
            provider_options: { service_tier: "priority" },
          },
        },
      },
    })

    const result = getCodexAgentModelOverrides({ cwd, homeDir, env: {} })

    expect(result.agents.get("plan")).toEqual({
      model: "openai/gpt-5.6-sol",
      modelReasoningEffort: "none",
      serviceTier: "priority",
    })
    expect(result.warnings.some((warning) => warning.startsWith("omo-codex: migrated legacy configuration from "))).toBe(true)
  })
})

describe("resolveCodexAgentModelOverrides", () => {
  test("resolves catalog aliases before selecting explicit and first-chain primary models", () => {
    const result = resolveCodexAgentModelOverrides({
      models: {
        sol: { model: "openai/gpt-5.6-sol", reasoning: "xhigh" },
        terra: { model: "openai/gpt-5.6-terra", reasoning: "high" },
      },
      agents: {
        explicit: {
          model: "sol",
          reasoning: "low",
          provider_options: { service_tier: "priority" },
          models: [{ model: "terra", reasoning: "minimal", provider_options: { service_tier: "flex" } }],
        },
        first_object: {
          reasoning: "medium",
          provider_options: { service_tier: "standard" },
          models: [{ model: "terra", reasoning: "minimal", provider_options: { service_tier: "flex" } }],
        },
        first_string: {
          reasoning: "medium",
          provider_options: { service_tier: "standard" },
          models: ["sol"],
        },
      },
    })

    expect(result.agents.get("explicit")).toEqual({
      model: "openai/gpt-5.6-sol",
      modelReasoningEffort: "low",
      serviceTier: "priority",
    })
    expect(result.agents.get("first_object")).toEqual({
      model: "openai/gpt-5.6-terra",
      modelReasoningEffort: "minimal",
      serviceTier: "flex",
    })
    expect(result.agents.get("first_string")).toEqual({
      model: "openai/gpt-5.6-sol",
      modelReasoningEffort: "xhigh",
      serviceTier: "standard",
    })
    expect(result.warnings).toEqual([])
  })

  test("keeps model-only, reasoning-only, and service-tier-only overrides", () => {
    const result = resolveCodexAgentModelOverrides({
      agents: {
        model_only: { model: "openai/gpt-5.6-terra" },
        reasoning_only: { reasoning: "off" },
        tier_only: { provider_options: { service_tier: "priority" } },
      },
    })

    expect(result.agents.get("model_only")).toEqual({ model: "openai/gpt-5.6-terra" })
    expect(result.agents.get("reasoning_only")).toEqual({ modelReasoningEffort: "none" })
    expect(result.agents.get("tier_only")).toEqual({ serviceTier: "priority" })
  })

  test("warns and skips unsupported Codex effort tokens and non-string service tiers", () => {
    const result = resolveCodexAgentModelOverrides({
      agents: {
        plan: {
          model: "openai/gpt-5.6-sol",
          reasoning: "turbo",
          provider_options: { service_tier: 7 },
        },
      },
    })

    expect(result.agents.get("plan")).toEqual({ model: "openai/gpt-5.6-sol" })
    expect(result.warnings).toEqual([
      'agents.plan.reasoning has unsupported Codex effort "turbo"; setting skipped',
      "agents.plan.provider_options.service_tier must be a string; setting skipped",
    ])
  })

  test("keeps catalog-cycle diagnostics non-fatal", () => {
    const result = resolveCodexAgentModelOverrides({
      models: {
        first: { model: "second" },
        second: { model: "first" },
      },
      agents: { plan: { model: "first" } },
    })

    expect(result.agents.get("plan")).toEqual({ model: "first" })
    expect(result.warnings.some((warning) => warning.includes("reference cycle"))).toBe(true)
  })

  test("preserves supplied migration warnings without making override resolution fatal", () => {
    const result = resolveCodexAgentModelOverrides(
      { agents: { plan: { model: "openai/gpt-5.6-sol" } } },
      ["omo-codex: configuration migration: recovered journal"],
    )

    expect(result.agents.get("plan")).toEqual({ model: "openai/gpt-5.6-sol" })
    expect(result.warnings).toEqual(["omo-codex: configuration migration: recovered journal"])
  })

  test("prints a reviewer-readable resolved map and warning payload", () => {
    const result = resolveCodexAgentModelOverrides({
      models: { primary: { model: "openai/gpt-5.6-sol", reasoning: "high" } },
      agents: {
        plan: { model: "primary", provider_options: { service_tier: "priority" } },
        invalid: { reasoning: "turbo", provider_options: { service_tier: false } },
      },
    })
    const payload = { agents: overrideEntries(result), warnings: result.warnings }

    console.log(`WAVE1_ADAPTER_OUTPUT=${JSON.stringify(payload)}`)
    expect(payload).toEqual({
      agents: {
        plan: {
          model: "openai/gpt-5.6-sol",
          modelReasoningEffort: "high",
          serviceTier: "priority",
        },
      },
      warnings: [
        'agents.invalid.reasoning has unsupported Codex effort "turbo"; setting skipped',
        "agents.invalid.provider_options.service_tier must be a string; setting skipped",
      ],
    })
  })
})

describe("unknownCodexAgentModelOverrideWarnings", () => {
  test("warns only for configured override names outside the dynamically supplied managed set", () => {
    const warnings = unknownCodexAgentModelOverrideWarnings({
      configuredAgents: ["plan", "custom-role"],
      managedAgentNames: new Set(["plan"]),
    })

    expect(warnings).toEqual([
      "agents.custom-role does not match a LazyCodex-managed Codex agent; override skipped",
    ])
  })
})

describe("applyCodexAgentModelOverride", () => {
  test("replaces arbitrary top-level value types exactly once and preserves nested same-name settings", () => {
    const updated = applyCodexAgentModelOverride(
      'name = "plan"\nmodel = "gpt-5.5"\nmodel_reasoning_effort = false\nservice_tier = ["fast"]\n\n[tools]\nmodel = 2\nservice_tier = "nested"\n',
      {
        model: "openai/gpt-5.6-sol",
        modelReasoningEffort: "xhigh",
        serviceTier: "priority",
      },
    )

    const topLevel = updated.slice(0, updated.indexOf("[tools]"))
    expect(updated).not.toContain('model = "gpt-5.5"')
    expect(topLevel.match(/^model\s*=/gm)).toHaveLength(1)
    expect(topLevel.match(/^model_reasoning_effort\s*=/gm)).toHaveLength(1)
    expect(topLevel.match(/^service_tier\s*=/gm)).toHaveLength(1)
    expect(updated).toContain('model = "openai/gpt-5.6-sol"')
    expect(updated).toContain('model_reasoning_effort = "xhigh"')
    expect(updated).toContain('service_tier = "priority"')
    expect(updated).toContain('[tools]\nmodel = 2\nservice_tier = "nested"')
  })

  test("replaces non-string top-level model, effort, and tier assignments without appending duplicates", () => {
    const updated = applyCodexAgentModelOverride(
      'name = "plan"\nmodel = 1\nmodel_reasoning_effort = false\nservice_tier = ["fast"]\n',
      {
        model: "openai/gpt-5.6-terra",
        modelReasoningEffort: "high",
        serviceTier: "flex",
      },
    )

    expect(updated).toBe(
      'name = "plan"\nmodel = "openai/gpt-5.6-terra"\nmodel_reasoning_effort = "high"\nservice_tier = "flex"\n',
    )
    expect(updated.match(/^model\s*=/gm)).toHaveLength(1)
    expect(updated.match(/^model_reasoning_effort\s*=/gm)).toHaveLength(1)
    expect(updated.match(/^service_tier\s*=/gm)).toHaveLength(1)
  })

  test("inserts missing partial settings before the first TOML table", () => {
    const updated = applyCodexAgentModelOverride(
      'name = "plan"\n\n[tools]\nallowed = ["Read"]\n',
      { serviceTier: "flex" },
    )

    expect(updated).toBe('name = "plan"\nservice_tier = "flex"\n\n[tools]\nallowed = ["Read"]\n')
  })

  test("leaves content unchanged when the override is empty", () => {
    const content = 'name = "plan"\nmodel = "gpt-5.6-sol"\n'
    expect(applyCodexAgentModelOverride(content, {})).toBe(content)
  })
})
