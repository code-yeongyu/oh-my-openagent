import { describe, expect, test } from "bun:test"

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadSenpiBarrel } from "../lazy/senpi-barrel"
import { DEFAULT_CATEGORIES } from "./builtins"
import { CATEGORY_FALLBACK_CHAINS } from "./fallback-chains"
import { resolveCategory } from "./resolver"
import type { SenpiModelPort, SenpiModelRegistryPort } from "./types"

// #10187: Argon at its lowest thinking level leads visual-engineering and writing. The
// rung resolves only when the live registry serves the model, so with an engine pin whose catalog
// has no Argon row both categories keep today's head; a registry that serves it gets Argon first.

const ARGON_RUNG = { providers: ["google", "google-vertex", "opencode"], model: "gemini-4-argon", variant: "low" }
type ArgonCategory = "visual-engineering" | "writing"
const ARGON_CATEGORIES: readonly ArgonCategory[] = ["visual-engineering", "writing"]

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

describe("Argon leads visual-engineering and writing (#10187)", () => {
  test.each<ArgonCategory>([...ARGON_CATEGORIES])("#given the builtin %s chain #then its head is the Argon low rung and the rest is the previous chain", (name) => {
    const chain = CATEGORY_FALLBACK_CHAINS[name]
    expect(chain[0]).toEqual(ARGON_RUNG)
    expect(DEFAULT_CATEGORIES[name]).toMatchObject({ model: "google/gemini-4-argon", variant: "low" })
  })

  test.each<ArgonCategory>([...ARGON_CATEGORIES])("#given a registry serving google/gemini-4-argon #when %s resolves #then Argon low is a primary hit", (name) => {
    const models = registry([model("google", "gemini-4-argon"), model("anthropic", "claude-fable-5-1"), model("anthropic", "claude-opus-5-5")])

    const resolved = expectResolved(resolveCategory(name, {}, models))

    expect(resolved.spec.provider).toBe("google")
    expect(resolved.spec.modelId).toBe("gemini-4-argon")
    expect(resolved.spec.variant).toBe("low")
    expect(resolved.modelSelection.matchedFallback).toBe(false)
  })

  test("#given a registry serving only the previous heads #when both resolve #then they land on the previous head rung", () => {
    const models = registry([model("anthropic", "claude-fable-5-1"), model("anthropic", "claude-opus-5-5")])

    const visual = expectResolved(resolveCategory("visual-engineering", {}, models))
    const writing = expectResolved(resolveCategory("writing", {}, models))

    expect([visual.spec.provider, visual.spec.modelId, visual.spec.variant]).toEqual(["anthropic", "claude-fable-5-1", "max"])
    expect([writing.spec.provider, writing.spec.modelId, writing.spec.variant]).toEqual(["anthropic", "claude-opus-5-5", "low"])
  })

  test("#given the pinned engine catalog on an Anthropic-only machine #when both resolve #then the result is today's head, so the rung takes effect only once the pin serves Argon", async () => {
    const senpi = await loadSenpiBarrel()
    const root = mkdtempSync(join(tmpdir(), "senpi-task-10187-"))
    try {
      const agentDir = join(root, "agent")
      mkdirSync(agentDir, { recursive: true })
      const authPath = join(agentDir, "auth.json")
      writeFileSync(authPath, JSON.stringify({ anthropic: { type: "api_key", key: "test-key" }, google: { type: "api_key", key: "test-key" } }))
      const modelRuntime = await senpi.ModelRuntime.create({ agentDir, authPath, allowModelNetwork: false })
      const live = new senpi.ModelRegistry(modelRuntime)
      const servesArgon = live.getAvailable().some((entry) => entry.provider === "google" && entry.id === "gemini-4-argon")

      const visual = expectResolved(resolveCategory("visual-engineering", {}, live))
      const writing = expectResolved(resolveCategory("writing", {}, live))

      if (servesArgon) {
        expect([visual.spec.provider, visual.spec.modelId, visual.spec.variant]).toEqual(["google", "gemini-4-argon", "low"])
        expect([writing.spec.provider, writing.spec.modelId, writing.spec.variant]).toEqual(["google", "gemini-4-argon", "low"])
      } else {
        expect([visual.spec.provider, visual.spec.modelId, visual.spec.variant]).toEqual(["anthropic", "claude-fable-5-1", "max"])
        expect([writing.spec.provider, writing.spec.modelId, writing.spec.variant]).toEqual(["anthropic", "claude-opus-5-5", "low"])
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
