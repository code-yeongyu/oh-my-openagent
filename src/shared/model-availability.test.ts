import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { fetchAvailableModels, fuzzyMatchModel, __resetModelCache } from "./model-availability"

describe("fetchAvailableModels", () => {
  let tempDir: string
  let originalXdgCache: string | undefined

  beforeEach(() => {
    __resetModelCache()
    tempDir = mkdtempSync(join(tmpdir(), "opencode-test-"))
    originalXdgCache = process.env.XDG_CACHE_HOME
    process.env.XDG_CACHE_HOME = tempDir
  })

  afterEach(() => {
    if (originalXdgCache !== undefined) {
      process.env.XDG_CACHE_HOME = originalXdgCache
    } else {
      delete process.env.XDG_CACHE_HOME
    }
    rmSync(tempDir, { recursive: true, force: true })
  })

  function writeModelsCache(data: Record<string, any>) {
    const cacheDir = join(tempDir, "opencode")
    require("fs").mkdirSync(cacheDir, { recursive: true })
    writeFileSync(join(cacheDir, "models.json"), JSON.stringify(data))
  }

  it("#given cache file with models #when fetchAvailableModels called #then returns Set of model IDs", async () => {
    writeModelsCache({
      openai: { id: "openai", models: { "gpt-5.2": { id: "gpt-5.2" } } },
      anthropic: { id: "anthropic", models: { "claude-opus-4-5": { id: "claude-opus-4-5" } } },
      google: { id: "google", models: { "gemini-3-pro": { id: "gemini-3-pro" } } },
    })

    const result = await fetchAvailableModels()

    expect(result).toBeInstanceOf(Set)
    expect(result.size).toBe(3)
    expect(result.has("openai/gpt-5.2")).toBe(true)
    expect(result.has("anthropic/claude-opus-4-5")).toBe(true)
    expect(result.has("google/gemini-3-pro")).toBe(true)
  })

  it("#given cache file not found #when fetchAvailableModels called #then returns empty Set", async () => {
    const result = await fetchAvailableModels()

    expect(result).toBeInstanceOf(Set)
    expect(result.size).toBe(0)
  })

  it("#given cache read twice #when second call made #then uses cached result", async () => {
    writeModelsCache({
      openai: { id: "openai", models: { "gpt-5.2": { id: "gpt-5.2" } } },
      anthropic: { id: "anthropic", models: { "claude-opus-4-5": { id: "claude-opus-4-5" } } },
    })

    const result1 = await fetchAvailableModels()
    const result2 = await fetchAvailableModels()

    expect(result1).toEqual(result2)
    expect(result1.has("openai/gpt-5.2")).toBe(true)
  })

  it("#given empty providers in cache #when fetchAvailableModels called #then returns empty Set", async () => {
    writeModelsCache({})

    const result = await fetchAvailableModels()

    expect(result).toBeInstanceOf(Set)
    expect(result.size).toBe(0)
  })

  it("#given cache file with various providers #when fetchAvailableModels called #then extracts all IDs correctly", async () => {
    writeModelsCache({
      openai: { id: "openai", models: { "gpt-5.2-codex": { id: "gpt-5.2-codex" } } },
      anthropic: { id: "anthropic", models: { "claude-sonnet-4-5": { id: "claude-sonnet-4-5" } } },
      google: { id: "google", models: { "gemini-3-flash": { id: "gemini-3-flash" } } },
      opencode: { id: "opencode", models: { "gpt-5-nano": { id: "gpt-5-nano" } } },
    })

    const result = await fetchAvailableModels()

    expect(result.size).toBe(4)
    expect(result.has("openai/gpt-5.2-codex")).toBe(true)
    expect(result.has("anthropic/claude-sonnet-4-5")).toBe(true)
    expect(result.has("google/gemini-3-flash")).toBe(true)
    expect(result.has("opencode/gpt-5-nano")).toBe(true)
  })
})

describe("fuzzyMatchModel", () => {
	// #given available models from multiple providers
	// #when searching for a substring match
	// #then return the matching model
	it("should match substring in model name", () => {
		const available = new Set([
			"openai/gpt-5.2",
			"openai/gpt-5.2-codex",
			"anthropic/claude-opus-4-5",
		])
		const result = fuzzyMatchModel("gpt-5.2", available)
		expect(result).toBe("openai/gpt-5.2")
	})

	// #given available models with partial matches
	// #when searching for a substring
	// #then return exact match if it exists
	it("should prefer exact match over substring match", () => {
		const available = new Set([
			"openai/gpt-5.2",
			"openai/gpt-5.2-codex",
			"openai/gpt-5.2-ultra",
		])
		const result = fuzzyMatchModel("gpt-5.2", available)
		expect(result).toBe("openai/gpt-5.2")
	})

	// #given available models with multiple substring matches
	// #when searching for a substring
	// #then return the shorter model name (more specific)
	it("should prefer shorter model name when multiple matches exist", () => {
		const available = new Set([
			"openai/gpt-5.2-ultra",
			"openai/gpt-5.2-ultra-mega",
		])
		const result = fuzzyMatchModel("gpt-5.2", available)
		expect(result).toBe("openai/gpt-5.2-ultra")
	})

	// #given available models with claude variants
	// #when searching for claude-opus
	// #then return matching claude-opus model
	it("should match claude-opus to claude-opus-4-5", () => {
		const available = new Set([
			"anthropic/claude-opus-4-5",
			"anthropic/claude-sonnet-4-5",
		])
		const result = fuzzyMatchModel("claude-opus", available)
		expect(result).toBe("anthropic/claude-opus-4-5")
	})

	// #given available models from multiple providers
	// #when providers filter is specified
	// #then only search models from specified providers
	it("should filter by provider when providers array is given", () => {
		const available = new Set([
			"openai/gpt-5.2",
			"anthropic/claude-opus-4-5",
			"google/gemini-3",
		])
		const result = fuzzyMatchModel("gpt", available, ["openai"])
		expect(result).toBe("openai/gpt-5.2")
	})

	// #given available models from multiple providers
	// #when providers filter excludes matching models
	// #then return null
	it("should return null when provider filter excludes all matches", () => {
		const available = new Set([
			"openai/gpt-5.2",
			"anthropic/claude-opus-4-5",
		])
		const result = fuzzyMatchModel("claude", available, ["openai"])
		expect(result).toBeNull()
	})

	// #given available models
	// #when no substring match exists
	// #then return null
	it("should return null when no match found", () => {
		const available = new Set([
			"openai/gpt-5.2",
			"anthropic/claude-opus-4-5",
		])
		const result = fuzzyMatchModel("gemini", available)
		expect(result).toBeNull()
	})

	// #given available models with different cases
	// #when searching with different case
	// #then match case-insensitively
	it("should match case-insensitively", () => {
		const available = new Set([
			"openai/gpt-5.2",
			"anthropic/claude-opus-4-5",
		])
		const result = fuzzyMatchModel("GPT-5.2", available)
		expect(result).toBe("openai/gpt-5.2")
	})

	// #given available models with exact match and longer variants
	// #when searching for exact match
	// #then return exact match first
	it("should prioritize exact match over longer variants", () => {
		const available = new Set([
			"anthropic/claude-opus-4-5",
			"anthropic/claude-opus-4-5-extended",
		])
		const result = fuzzyMatchModel("claude-opus-4-5", available)
		expect(result).toBe("anthropic/claude-opus-4-5")
	})

	// #given available models with multiple providers
	// #when multiple providers are specified
	// #then search all specified providers
	it("should search all specified providers", () => {
		const available = new Set([
			"openai/gpt-5.2",
			"anthropic/claude-opus-4-5",
			"google/gemini-3",
		])
		const result = fuzzyMatchModel("gpt", available, ["openai", "google"])
		expect(result).toBe("openai/gpt-5.2")
	})

	// #given available models with provider prefix
	// #when searching with provider filter
	// #then only match models with correct provider prefix
	it("should only match models with correct provider prefix", () => {
		const available = new Set([
			"openai/gpt-5.2",
			"anthropic/gpt-something",
		])
		const result = fuzzyMatchModel("gpt", available, ["openai"])
		expect(result).toBe("openai/gpt-5.2")
	})

	// #given empty available set
	// #when searching
	// #then return null
	it("should return null for empty available set", () => {
		const available = new Set<string>()
		const result = fuzzyMatchModel("gpt", available)
		expect(result).toBeNull()
	})
})
