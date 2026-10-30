import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { collectEditorModels, readEditorModels, validateEditorModel } from "./models"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("config editor model catalog", () => {
  test("reads canonical wrapped metadata and merges legacy provider maps without duplicates", () => {
    // given
    const providerCache = {
      models: { anthropic: [{ id: "claude-sonnet" }, { id: "claude-opus" }], openai: ["gpt", null, 8] },
      connected: ["anthropic"],
      updatedAt: "cached",
    }
    const legacy = { anthropic: { models: { "claude-sonnet": {}, haiku: { id: "claude-haiku" } } } }

    // when
    const models = collectEditorModels(providerCache, legacy)

    // then
    expect([...models]).toEqual([
      ["anthropic", ["claude-haiku", "claude-opus", "claude-sonnet"]],
      ["openai", ["gpt"]],
    ])
  })

  test("handles null legacy entries and rejects unsafe provider names and terminal controls", () => {
    // given
    const providerCache: unknown = JSON.parse('{"models":{"__proto__":["bad"],"constructor":["bad"],"good":["ok","\\u001b[31mbad"]}}')
    const legacy = [null, false, { provider: "prototype", id: "bad" }, { provider: "good", id: "other" }]

    // when
    const models = collectEditorModels(providerCache, legacy)

    // then
    expect([...models]).toEqual([["good", ["ok", "other"]]])
    expect(Object.prototype).not.toHaveProperty("bad")
  })

  test("malformed plugin cache falls back to OpenCode cache and does not rewrite either file", () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-editor-models-"))
    roots.push(root)
    const directory = join(root, "plugin")
    mkdirSync(directory)
    const providerFile = join(directory, "provider-models.json")
    const modelsFile = join(root, "models.json")
    writeFileSync(providerFile, "{broken")
    const original = JSON.stringify([{ provider: "openai", id: "gpt" }])
    writeFileSync(modelsFile, original)

    // when
    const models = readEditorModels({ providerCacheDirectory: directory, modelsPath: modelsFile })

    // then
    expect([...models]).toEqual([["openai", ["gpt"]]])
    expect(readFileSync(providerFile, "utf-8")).toBe("{broken")
    expect(readFileSync(modelsFile, "utf-8")).toBe(original)
  })

  test("reads metadata ids from the real canonical provider cache", () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-editor-provider-models-"))
    roots.push(root)
    writeFileSync(join(root, "provider-models.json"), JSON.stringify({
      models: { provider: [{ id: "model", context: 200000 }] },
      connected: ["provider"],
      updatedAt: "cached",
    }))

    // when
    const models = readEditorModels({ providerCacheDirectory: root, modelsPath: join(root, "missing.json") })

    // then
    expect([...models]).toEqual([["provider", ["model"]]])
  })

  test("missing caches permit an empty catalog", () => {
    const root = mkdtempSync(join(tmpdir(), "omo-editor-empty-models-"))
    roots.push(root)
    expect(readEditorModels({ providerCacheDirectory: root, modelsPath: join(root, "missing") }).size).toBe(0)
  })

  test("custom model input requires a trimmed provider and nonempty model id", () => {
    expect(validateEditorModel(" openai/gpt-6.1-sol ")).toBeUndefined()
    expect(validateEditorModel("gateway/vendor/model")).toBeUndefined()
    for (const invalid of [undefined, "", "   ", "openai", "openai/", "/model", "bad provider/model", "__proto__/bad", "p/model\nother"]) {
      expect(validateEditorModel(invalid)).toBeString()
    }
  })
})
