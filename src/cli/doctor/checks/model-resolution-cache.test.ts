import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { loadAvailableModelsFromCache } from "./model-resolution-cache"

describe("loadAvailableModelsFromCache", () => {
  const originalXDGCache = process.env.XDG_CACHE_HOME
  const originalXDGConfig = process.env.XDG_CONFIG_HOME
  let tempDir: string

  beforeEach(() => {
    tempDir = join("/tmp", `doctor-cache-test-${Date.now()}`)
    mkdirSync(join(tempDir, "cache", "opencode"), { recursive: true })
    mkdirSync(join(tempDir, "config", "opencode"), { recursive: true })
    process.env.XDG_CACHE_HOME = join(tempDir, "cache")
    process.env.XDG_CONFIG_HOME = join(tempDir, "config")
  })

  afterEach(() => {
    process.env.XDG_CACHE_HOME = originalXDGCache
    process.env.XDG_CONFIG_HOME = originalXDGConfig
    rmSync(tempDir, { recursive: true, force: true })
  })

  test("returns cacheExists: false when no models.json and no custom providers", () => {
    const result = loadAvailableModelsFromCache()
    expect(result.cacheExists).toBe(false)
    expect(result.providers).toEqual([])
    expect(result.modelCount).toBe(0)
  })

  test("reads providers from models.json cache", () => {
    writeFileSync(
      join(tempDir, "cache", "opencode", "models.json"),
      JSON.stringify({
        openai: { models: { "gpt-5.4": {} } },
        anthropic: { models: { "claude-opus-4-6": {}, "claude-sonnet-4-6": {} } },
      })
    )

    const result = loadAvailableModelsFromCache()
    expect(result.cacheExists).toBe(true)
    expect(result.providers).toContain("openai")
    expect(result.providers).toContain("anthropic")
    expect(result.modelCount).toBe(3)
  })

  test("includes custom providers from opencode.json even if not in cache", () => {
    writeFileSync(
      join(tempDir, "cache", "opencode", "models.json"),
      JSON.stringify({
        openai: { models: { "gpt-5.4": {} } },
      })
    )
    writeFileSync(
      join(tempDir, "config", "opencode", "opencode.json"),
      JSON.stringify({
        provider: {
          "openai-custom": {
            npm: "@ai-sdk/openai-compatible",
            models: { "gpt-5.4": {} },
          },
          "my-local-llm": {
            npm: "@ai-sdk/openai-compatible",
            models: { "local-model": {} },
          },
        },
      })
    )

    const result = loadAvailableModelsFromCache()
    expect(result.cacheExists).toBe(true)
    expect(result.providers).toContain("openai")
    expect(result.providers).toContain("openai-custom")
    expect(result.providers).toContain("my-local-llm")
  })

  test("deduplicates providers that appear in both cache and opencode.json", () => {
    writeFileSync(
      join(tempDir, "cache", "opencode", "models.json"),
      JSON.stringify({
        openai: { models: { "gpt-5.4": {} } },
      })
    )
    writeFileSync(
      join(tempDir, "config", "opencode", "opencode.json"),
      JSON.stringify({
        provider: {
          openai: { models: { "custom-model": {} } },
        },
      })
    )

    const result = loadAvailableModelsFromCache()
    const openaiCount = result.providers.filter((p) => p === "openai").length
    expect(openaiCount).toBe(1)
  })

  test("returns custom providers even without models.json cache", () => {
    // No models.json exists
    writeFileSync(
      join(tempDir, "config", "opencode", "opencode.json"),
      JSON.stringify({
        provider: {
          "openai-custom": {
            npm: "@ai-sdk/openai-compatible",
            models: { "gpt-5.4": {} },
          },
        },
      })
    )

    const result = loadAvailableModelsFromCache()
    expect(result.cacheExists).toBe(true) // custom providers make it effectively "exists"
    expect(result.providers).toContain("openai-custom")
  })

  test("reads from opencode.jsonc (JSONC variant)", () => {
    writeFileSync(
      join(tempDir, "config", "opencode", "opencode.jsonc"),
      `{
        // This is a comment
        "provider": {
          "my-provider": {
            "models": { "test-model": {} }
          }
        }
      }`
    )

    const result = loadAvailableModelsFromCache()
    expect(result.providers).toContain("my-provider")
  })

  test("ignores malformed opencode.json gracefully", () => {
    writeFileSync(
      join(tempDir, "cache", "opencode", "models.json"),
      JSON.stringify({ openai: { models: { "gpt-5.4": {} } } })
    )
    writeFileSync(
      join(tempDir, "config", "opencode", "opencode.json"),
      "this is not valid json {{{",
    )

    const result = loadAvailableModelsFromCache()
    expect(result.cacheExists).toBe(true)
    expect(result.providers).toContain("openai")
    // Should not crash, just skip the config
  })
})
