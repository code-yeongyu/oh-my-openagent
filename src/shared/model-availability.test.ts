import { describe, it, expect, beforeEach } from "bun:test"
import { fetchAvailableModels, fuzzyMatchModel, __resetModelCache } from "./model-availability"

describe("fetchAvailableModels", () => {
  let mockClient: any

  beforeEach(() => {
    __resetModelCache()
  })

  it("#given API returns list of models #when fetchAvailableModels called #then returns Set of model IDs", async () => {
    const mockModels = [
      { id: "openai/gpt-5.2", name: "GPT-5.2" },
      { id: "anthropic/claude-opus-4-5", name: "Claude Opus 4.5" },
      { id: "google/gemini-3-pro", name: "Gemini 3 Pro" },
    ]
    mockClient = {
      model: {
        list: async () => mockModels,
      },
    }

    const result = await fetchAvailableModels(mockClient)

    expect(result).toBeInstanceOf(Set)
    expect(result.size).toBe(3)
    expect(result.has("openai/gpt-5.2")).toBe(true)
    expect(result.has("anthropic/claude-opus-4-5")).toBe(true)
    expect(result.has("google/gemini-3-pro")).toBe(true)
  })

  it("#given API fails #when fetchAvailableModels called #then returns empty Set without throwing", async () => {
    mockClient = {
      model: {
        list: async () => {
          throw new Error("API connection failed")
        },
      },
    }

    const result = await fetchAvailableModels(mockClient)

    expect(result).toBeInstanceOf(Set)
    expect(result.size).toBe(0)
  })

  it("#given API called twice #when second call made #then uses cached result without re-fetching", async () => {
    let callCount = 0
    const mockModels = [
      { id: "openai/gpt-5.2", name: "GPT-5.2" },
      { id: "anthropic/claude-opus-4-5", name: "Claude Opus 4.5" },
    ]
    mockClient = {
      model: {
        list: async () => {
          callCount++
          return mockModels
        },
      },
    }

    const result1 = await fetchAvailableModels(mockClient)
    const result2 = await fetchAvailableModels(mockClient)

    expect(callCount).toBe(1)
    expect(result1).toEqual(result2)
    expect(result1.has("openai/gpt-5.2")).toBe(true)
  })

  it("#given empty model list from API #when fetchAvailableModels called #then returns empty Set", async () => {
    mockClient = {
      model: {
        list: async () => [],
      },
    }

    const result = await fetchAvailableModels(mockClient)

    expect(result).toBeInstanceOf(Set)
    expect(result.size).toBe(0)
  })

  it("#given API returns models with various formats #when fetchAvailableModels called #then extracts all IDs correctly", async () => {
    const mockModels = [
      { id: "openai/gpt-5.2-codex", name: "GPT-5.2 Codex" },
      { id: "anthropic/claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
      { id: "google/gemini-3-flash", name: "Gemini 3 Flash" },
      { id: "opencode/grok-code", name: "Grok Code" },
    ]
    mockClient = {
      model: {
        list: async () => mockModels,
      },
    }

    const result = await fetchAvailableModels(mockClient)

    expect(result.size).toBe(4)
    expect(result.has("openai/gpt-5.2-codex")).toBe(true)
    expect(result.has("anthropic/claude-sonnet-4-5")).toBe(true)
    expect(result.has("google/gemini-3-flash")).toBe(true)
	expect(result.has("opencode/grok-code")).toBe(true)
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
