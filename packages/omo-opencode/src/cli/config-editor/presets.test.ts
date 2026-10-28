import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CATEGORY_MODEL_REQUIREMENTS, LATEST_MODEL_BY_FAMILY } from "@oh-my-opencode/model-core"
import { getEditorPresetPolicy } from "./preset-policy"
import { previewEditorPreset, readEditorPresetCache, stageEditorPreset } from "./presets"
import { isEditorModified, openEditorSession, readEditorValue } from "./backend"

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected test fixture value")
  return value
}
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "omo-editor-presets-"))
  roots.push(root)
  const path = join(root, "omo.jsonc")
  writeFileSync(path, '{}\n')
  return { root, path, session: openEditorSession(path, "project") }
}
function fullCache(id = "budget") {
  const models: Record<string, string[]> = {}
  for (const role of getEditorPresetPolicy(id)) for (const candidate of role.candidates) {
    const slash = candidate.indexOf("/")
    const provider = candidate.slice(0, slash)
    const model = candidate.slice(slash + 1)
    ;(models[provider] ??= []).push(model)
  }
  return { models, connected: Object.keys(models), updatedAt: "2026-10-28T12:00:00.000Z" }
}

test("all tiers resolve complete deterministic previews from fully listed caches", () => {
  for (const id of ["performance", "balanced", "budget"]) {
    const preview = previewEditorPreset(id, fullCache(id))
    expect(preview.complete).toBe(true)
    expect(preview.missingRoles).toEqual([])
    expect(preview.roles.every((role) => role.chain.length > 0)).toBe(true)
    expect(previewEditorPreset(id, fullCache(id))).toEqual(preview)
  }
})

test("cache selection requires exact provider and model, and only connected providers", () => {
  const cache = { connected: ["openai"], updatedAt: "2026-10-28T12:00:00Z", models: {
    openai: ["gpt-5.6-sol-preview", "vendor/gpt-5.6-sol", "GPT-5.6-SOL"],
    opencode: ["gpt-5.6-sol"],
  } }
  const preview = previewEditorPreset("budget", cache)
  expect(preview.roles.find((role) => role.name === "hephaestus")?.chain).toEqual([])
  expect(preview.complete).toBe(false)
  expect(preview.roles.find((role) => role.name === "hephaestus")?.skipped).toContainEqual({ model: "openai/gpt-5.6-sol", reason: "model not listed in cache" })
  cache.models.openai.push("gpt-5.6-sol")
  expect(previewEditorPreset("budget", cache).roles.find((role) => role.name === "hephaestus")?.chain).toEqual(["openai/gpt-5.6-sol"])
})

test("missing, empty and malformed cache fields never claim complete coverage", () => {
  for (const cache of [null, {}, [], { ...fullCache(), connected: undefined }, { ...fullCache(), connected: [] }, { ...fullCache(), connected: "openai" }, { ...fullCache(), models: [] }, { ...fullCache(), updatedAt: "bad" }, { ...fullCache(), updatedAt: 42 }, { ...fullCache(), updatedAt: "2026-02-31T12:00:00Z" }, { ...fullCache(), updatedAt: "2026-10-28T24:00:00Z" }]) {
    const preview = previewEditorPreset("budget", cache)
    expect(preview.complete).toBe(false)
    expect(preview.missingRoles.length).toBeGreaterThan(0)
  }
  expect(() => previewEditorPreset("unknown", fullCache())).toThrow("Unknown built-in preset")
})

test("metadata validates ids and provider ownership without trusting names or aliases", () => {
  const cache = { connected: ["openai"], updatedAt: "2026-10-28T12:00:00Z", models: { openai: [
    null, 1, {}, { id: "gpt-5.6-sol", provider: "other" }, { id: "gpt-5.6-sol\u001b" },
    { id: "another", name: "gpt-5.6-sol" },
  ] } }
  expect(previewEditorPreset("budget", cache).roles.find((role) => role.name === "hephaestus")?.chain).toEqual([])
  cache.models.openai.push({ id: "gpt-5.6-sol", provider: "openai" })
  expect(previewEditorPreset("budget", cache).roles.find((role) => role.name === "hephaestus")?.chain).toEqual(["openai/gpt-5.6-sol"])
})

test("OpenRouter exact routed aliases produce complete budget coverage", () => {
  const models = required(fullCache().models.openrouter)
  const preview = previewEditorPreset("budget", { models: { openrouter: models }, connected: ["openrouter"], updatedAt: "2026-10-28T12:00:00Z" })
  expect(preview.complete).toBe(true)
  expect(preview.roles.every((role) => role.chain.every((model) => model.startsWith("openrouter/")))).toBe(true)
  expect(preview.roles.find((role) => role.name === "hephaestus")?.chain).toEqual(["openrouter/openai/gpt-5.6-sol"])
})

test("preview is recursively immutable and staging revalidates cache rather than trusting previews", () => {
  const { session, path } = fixture()
  const cache = fullCache()
  const preview = previewEditorPreset("budget", cache)
  expect(Object.isFrozen(preview)).toBe(true)
  expect(Object.isFrozen(preview.roles[0]?.chain)).toBe(true)
  expect(() => (required(preview.roles[0]).chain as string[]).push("openai/premium")).toThrow()
  const before = structuredClone(session)
  expect(() => stageEditorPreset(session, "forged", "budget", { ...preview, complete: true })).toThrow("missing")
  expect(session).toEqual(before)
  delete cache.models.openai
  delete cache.models["chatgpt-subscription"]
  delete cache.models["github-copilot"]
  delete cache.models.opencode
  delete cache.models.openrouter
  expect(() => stageEditorPreset(session, "changed", "budget", cache)).toThrow("missing")
  expect(session).toEqual(before)
  expect(readFileSync(path, "utf8")).toBe('{}\n')
})

test("complete import stages editable model declarations only, collisions and incomplete imports are atomic", () => {
  const { session, path } = fixture()
  stageEditorPreset(session, "budget", "budget", fullCache())
  const block = readEditorValue(session, ["profiles", "budget", "[opencode]"]) as Record<string, Record<string, Record<string, unknown>>>
  expect(Object.keys(required(block.agents))).toHaveLength(11)
  expect(Object.keys(required(block.categories))).toEqual(Object.keys(CATEGORY_MODEL_REQUIREMENTS))
  expect(block.agents?.hephaestus?.models).toEqual(previewEditorPreset("budget", fullCache()).roles.find((role) => role.name === "hephaestus")?.chain)
  for (const entry of Object.values(required(block.categories))) {
    expect(typeof entry.model).toBe("string")
    expect(Array.isArray(entry.fallback_models)).toBe(true)
    expect(entry.models).toBeUndefined()
    expect(entry.variant).toBeUndefined()
  }
  expect(isEditorModified(session)).toBe(true)
  const before = structuredClone(session)
  for (const name of ["budget", "", "__proto__", " x", "x\u001b"]) {
    expect(() => stageEditorPreset(session, name, "budget", fullCache())).toThrow()
    expect(session).toEqual(before)
  }
  expect(() => stageEditorPreset(session, "incomplete", "budget", null)).toThrow("missing")
  expect(session).toEqual(before)
  expect(readFileSync(path, "utf8")).toBe('{}\n')
})

test("provider-cache reader is offline, validates malformed JSON and preserves cache bytes", () => {
  const { root } = fixture()
  const path = join(root, "provider-models.json")
  const bytes = JSON.stringify(fullCache())
  writeFileSync(path, bytes)
  expect(previewEditorPreset("budget", readEditorPresetCache({ providerCacheDirectory: root })).complete).toBe(true)
  expect(readFileSync(path, "utf8")).toBe(bytes)
  writeFileSync(path, 'not json')
  expect(previewEditorPreset("budget", readEditorPresetCache({ providerCacheDirectory: root })).complete).toBe(false)
})


test("literal OpenRouter catalog supports complete budget import without borrowing premium models", () => {
  const preview = previewEditorPreset("budget", {
    models: { openrouter: [
      `moonshotai/${LATEST_MODEL_BY_FAMILY.kimi}`,
      "openai/gpt-5.6-sol", "openai/gpt-5-nano",
      `anthropic/${LATEST_MODEL_BY_FAMILY.claudeHaiku}`,
      `anthropic/${LATEST_MODEL_BY_FAMILY.claudeOpus}`,
    ] },
    connected: ["openrouter"], updatedAt: "2026-10-28T12:00:00Z",
  })
  expect(preview.complete).toBe(true)
  expect(preview.roles.find((role) => role.name === "sisyphus")?.chain).toEqual([`openrouter/moonshotai/${LATEST_MODEL_BY_FAMILY.kimi}`])
  expect(preview.roles.find((role) => role.name === "explore")?.chain).toEqual([`openrouter/anthropic/${LATEST_MODEL_BY_FAMILY.claudeHaiku}`])
  expect(preview.roles.every((role) => role.chain.every((model) => !model.includes("opus")))).toBe(true)
})


test("premium-only cache cannot turn a missing budget candidate into an expensive fallback", () => {
  const premiumOnly = {
    connected: ["anthropic", "openai"], updatedAt: "2026-10-28T12:00:00Z",
    models: { anthropic: [LATEST_MODEL_BY_FAMILY.claudeOpus], openai: [LATEST_MODEL_BY_FAMILY.gptAstra] },
  }
  const preview = previewEditorPreset("budget", premiumOnly)
  expect(preview.complete).toBe(false)
  expect(preview.roles.every((role) => role.chain.length === 0)).toBe(true)
  const { session } = fixture()
  const before = structuredClone(session)
  expect(() => stageEditorPreset(session, "unavailable", "budget", premiumOnly)).toThrow("missing")
  expect(session).toEqual(before)
})
