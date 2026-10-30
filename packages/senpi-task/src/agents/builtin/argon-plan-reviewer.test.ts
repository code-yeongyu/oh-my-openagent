import { describe, expect, test } from "bun:test"

import { resolveAgent } from "../resolve-agent"
import type { AgentDefinition } from "../types"
import { AGENT_FALLBACK_CHAINS } from "./fallback-chains"

// #10180: Argon at high thinking leads the previous pro rung in the plan-reviewer chain. Copilot stays
// off the Argon rung until code-yeongyu/senpi#3379 verifies its thinking control.

const ARGON_RUNG = { providers: ["google", "google-vertex", "opencode"], model: "gemini-4-argon", variant: "high" }

function registry(models: readonly { readonly provider: string; readonly id: string }[]) {
  return {
    getAvailable: () => models,
    find: (provider: string, id: string) => models.find((entry) => entry.provider === provider && entry.id === id),
  }
}

const agents: Readonly<Record<string, AgentDefinition>> = { "plan-reviewer": { name: "plan-reviewer" } }

function resolvedModel(models: readonly { readonly provider: string; readonly id: string }[]) {
  const result = resolveAgent("plan-reviewer", agents, registry(models))
  if (result.kind !== "resolved") throw new Error(`expected resolved, got ${result.kind}`)
  return [result.model, result.resolved_model?.variant]
}

describe("Argon in the plan-reviewer chain (#10180)", () => {
  test("#given the plan-reviewer chain #then Argon high sits directly before the previous pro rung", () => {
    const chain = AGENT_FALLBACK_CHAINS["plan-reviewer"] ?? []
    const argonIndex = chain.findIndex((entry) => entry.model === "gemini-4-argon")

    expect(chain[argonIndex]).toEqual(ARGON_RUNG)
    expect(chain[argonIndex + 1]?.model).toBe("gemini-3.1-pro")
  })

  test("#given a Google-only machine that serves Argon #when plan-reviewer resolves #then it gets Argon high", () => {
    expect(resolvedModel([{ provider: "google", id: "gemini-4-argon" }, { provider: "google", id: "gemini-3.1-pro" }]))
      .toEqual(["google/gemini-4-argon", "high"])
  })

  test("#given a Vertex-only machine that serves Argon #when plan-reviewer resolves #then it gets Argon high on Vertex", () => {
    expect(resolvedModel([{ provider: "google-vertex", id: "gemini-4-argon" }])).toEqual(["google-vertex/gemini-4-argon", "high"])
  })

  test("#given an engine catalog without the Argon row #when plan-reviewer resolves #then it keeps the previous pro rung", () => {
    expect(resolvedModel([{ provider: "google", id: "gemini-3.1-pro" }])).toEqual(["google/gemini-3.1-pro", "high"])
  })

  test("#given a Copilot-only machine that lists Argon #when plan-reviewer resolves #then it lands on the previous pro rung, not Argon", () => {
    expect(resolvedModel([{ provider: "github-copilot", id: "gemini-4-argon" }, { provider: "github-copilot", id: "gemini-3.1-pro" }]))
      .toEqual(["github-copilot/gemini-3.1-pro", "high"])
  })
})
