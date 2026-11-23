import { describe, expect, test } from "bun:test"

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadSenpiBarrel } from "../lazy/senpi-barrel"
import { DEFAULT_CATEGORIES } from "./builtins"
import { CATEGORY_FALLBACK_CHAINS } from "./fallback-chains"
import { resolveCategory } from "./resolver"
import type { SenpiModelPort, SenpiModelRegistryPort } from "./types"

const ARGON_RUNG = { providers: ["google", "google-vertex", "opencode"], model: "gemini-4-argon", variant: "low" } as const

function model(provider: string, id: string): SenpiModelPort {
  return { provider, id }
}

function registry(models: readonly SenpiModelPort[]): SenpiModelRegistryPort<SenpiModelPort> {
  return {
    getAvailable: () => models,
    find: (provider: string, id: string) => models.find((entry) => entry.provider === provider && entry.id === id),
  }
}

function expectResolved(result: ReturnType<typeof resolveCategory<SenpiModelPort>>) {
  if (result.kind !== "resolved") throw new Error(`expected resolved, got ${result.kind}`)
  return result
}

describe("visual-engineering and writing routing", () => {
  test("writing retains its declared primary", () => {
    expect(CATEGORY_FALLBACK_CHAINS.writing[0]).toEqual({ ...ARGON_RUNG, providers: [...ARGON_RUNG.providers] })
    expect(DEFAULT_CATEGORIES.writing).toMatchObject({
      model: `${ARGON_RUNG.providers[0]}/${ARGON_RUNG.model}`,
      variant: "low",
    })
  })

  test("visual-engineering keeps the subscription-first rung while writing keeps its own primary", () => {
    const models = registry([
      model(ARGON_RUNG.providers[0], ARGON_RUNG.model),
      model("anthropic", "claude-fable-5-2"),
      model("anthropic-subscription", "claude-fable-5-2"),
      model("anthropic", "claude-opus-5-5"),
    ])

    const visual = expectResolved(resolveCategory("visual-engineering", {}, models))
    const writing = expectResolved(resolveCategory("writing", {}, models))

    expect(visual.modelSelection).toMatchObject({
      selectedModel: "anthropic-subscription/claude-fable-5-2",
      matchedFallback: false,
    })
    expect(visual.spec.variant).toBe("max")
    expect(writing.modelSelection).toMatchObject({
      selectedModel: `${ARGON_RUNG.providers[0]}/${ARGON_RUNG.model}`,
      matchedFallback: false,
    })
    expect(writing.spec.variant).toBe("low")
  })

  test("#given a registry serving only the previous heads #when both resolve #then they land on the previous head rung", () => {
    const models = registry([model("anthropic", "claude-fable-5-1"), model("anthropic", "claude-opus-5-5")])

    const visual = expectResolved(resolveCategory("visual-engineering", {}, models))
    const writing = expectResolved(resolveCategory("writing", {}, models))

    expect([visual.spec.provider, visual.spec.modelId, visual.spec.variant]).toEqual([
      "anthropic",
      "claude-fable-5-1",
      "max",
    ])
    expect([writing.spec.provider, writing.spec.modelId, writing.spec.variant]).toEqual([
      "anthropic",
      "claude-opus-5-5",
      "low",
    ])
  })

  test("the pinned engine catalog changes Writing only when it serves the Writing primary", async () => {
    const senpi = await loadSenpiBarrel()
    const root = mkdtempSync(join(tmpdir(), "senpi-task-10187-"))
    try {
      const agentDir = join(root, "agent")
      mkdirSync(agentDir, { recursive: true })
      const authPath = join(agentDir, "auth.json")
      writeFileSync(
        authPath,
        JSON.stringify({
          anthropic: { type: "api_key", key: "test-key" },
          google: { type: "api_key", key: "test-key" },
        }),
      )
      const modelRuntime = await senpi.ModelRuntime.create({ agentDir, authPath, allowModelNetwork: false })
      const live = new senpi.ModelRegistry(modelRuntime)
      const servesArgon = live
        .getAvailable()
        .some((entry) => entry.provider === "google" && entry.id === "gemini-4-argon")

      const visual = expectResolved(resolveCategory("visual-engineering", {}, live))
      const writing = expectResolved(resolveCategory("writing", {}, live))

      expect([visual.spec.provider, visual.spec.modelId, visual.spec.variant]).toEqual([
        "anthropic",
        live.getAvailable().some((entry) => entry.provider === "anthropic" && entry.id === "claude-fable-5-2")
          ? "claude-fable-5-2"
          : "claude-fable-5-1",
        "max",
      ])
      if (servesArgon) {
        expect([writing.spec.provider, writing.spec.modelId, writing.spec.variant]).toEqual([
          "google",
          "gemini-4-argon",
          "low",
        ])
      } else {
        expect([writing.spec.provider, writing.spec.modelId, writing.spec.variant]).toEqual([
          "anthropic",
          "claude-opus-5-5",
          "low",
        ])
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
