declare const require: (name: string) => any
const { describe, it, expect, beforeEach, afterEach, beforeAll } = require("bun:test")
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

let __resetModelCache: () => void
let fetchAvailableModels: (client?: unknown, options?: { connectedProviders?: string[] | null }) => Promise<Set<string>>
let fuzzyMatchModel: (target: string, available: Set<string>, providers?: string[]) => string | null
let isModelAvailable: (targetModel: string, availableModels: Set<string>) => boolean
let getConnectedProviders: (client: unknown) => Promise<string[]>

beforeAll(async () => {
  ;({
    __resetModelCache,
    fetchAvailableModels,
    fuzzyMatchModel,
    isModelAvailable,
    getConnectedProviders,
  } = await import("./model-availability"))
})

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

  it("#given cache file with models #when fetchAvailableModels called with connectedProviders #then returns Set of model IDs", async () => {
    writeModelsCache({
      openai: { id: "openai", models: { "gpt-5.2": { id: "gpt-5.2" } } },
      anthropic: { id: "anthropic", models: { "claude-opus-4-6": { id: "claude-opus-4-6" } } },
      google: { id: "google", models: { "gemini-3-pro": { id: "gemini-3-pro" } } },
    })

    const result = await fetchAvailableModels(undefined, {
      connectedProviders: ["openai", "anthropic", "google"]
    })

    expect(result).toBeInstanceOf(Set)
    expect(result.size).toBe(3)
    expect(result.has("openai/gpt-5.2")).toBe(true)
    expect(result.has("anthropic/claude-opus-4-6")).toBe(true)
    expect(result.has("google/gemini-3-pro")).toBe(true)
  })

  it("#given connectedProviders unknown #when fetchAvailableModels called without options #then returns empty Set", async () => {
    writeModelsCache({
      openai: { id: "openai", models: { "gpt-5.2": { id: "gpt-5.2" } } },
    })

    const result = await fetchAvailableModels()

    expect(result).toBeInstanceOf(Set)
    expect(result.size).toBe(0)
  })

  it("#given connectedProviders unknown but client can list #when fetchAvailableModels called with client #then returns models from API filtered by connected providers", async () => {
    const client = {
      provider: {
        list: async () => ({ data: { connected: ["openai"] } }),
      },
      model: {
        list: async () => ({
          data: [
            { id: "gpt-5.3-codex", provider: "openai" },
            { id: "gemini-3-pro", provider: "google" },
          ],
        }),
      },
    }

    const result = await fetchAvailableModels(client)

    expect(result).toBeInstanceOf(Set)
    expect(result.has("openai/gpt-5.3-codex")).toBe(true)
    expect(result.has("google/gemini-3-pro")).toBe(false)
  })

  it("#given cache file not found #when fetchAvailableModels called with connectedProviders #then returns empty Set", async () => {
    const result = await fetchAvailableModels(undefined, { connectedProviders: ["openai"] })

    expect(result).toBeInstanceOf(Set)
    expect(result.size).toBe(0)
  })

  it("#given cache missing but client can list #when fetchAvailableModels called with connectedProviders #then returns models from API", async () => {
    const client = {
      provider: {
        list: async () => ({ data: { connected: ["openai", "google"] } }),
      },
      model: {
        list: async () => ({
          data: [
            { id: "gpt-5.3-codex", provider: "openai" },
            { id: "gemini-3-pro", provider: "google" },
          ],
        }),
      },
    }

    const result = await fetchAvailableModels(client, { connectedProviders: ["openai", "google"] })

    expect(result).toBeInstanceOf(Set)
    expect(result.has("openai/gpt-5.3-codex")).toBe(true)
    expect(result.has("google/gemini-3-pro")).toBe(true)
  })

  it("#given cache read twice #when second call made with same providers #then reads fresh each time", async () => {
    writeModelsCache({
      openai: { id: "openai", models: { "gpt-5.2": { id: "gpt-5.2" } } },
      anthropic: { id: "anthropic", models: { "claude-opus-4-6": { id: "claude-opus-4-6" } } },
    })

    const result1 = await fetchAvailableModels(undefined, { connectedProviders: ["openai"] })
    const result2 = await fetchAvailableModels(undefined, { connectedProviders: ["openai"] })

    expect(result1.size).toBe(result2.size)
    expect(result1.has("openai/gpt-5.2")).toBe(true)
  })

  it("#given empty providers in cache #when fetchAvailableModels called with connectedProviders #then returns empty Set", async () => {
    writeModelsCache({})

    const result = await fetchAvailableModels(undefined, { connectedProviders: ["openai"] })

    expect(result).toBeInstanceOf(Set)
    expect(result.size).toBe(0)
  })

  it("#given cache file with various providers #when fetchAvailableModels called with all providers #then extracts all IDs correctly", async () => {
    writeModelsCache({
      openai: { id: "openai", models: { "gpt-5.3-codex": { id: "gpt-5.3-codex" } } },
      anthropic: { id: "anthropic", models: { "claude-sonnet-4-5": { id: "claude-sonnet-4-5" } } },
      google: { id: "google", models: { "gemini-3-flash": { id: "gemini-3-flash" } } },
      opencode: { id: "opencode", models: { "gpt-5-nano": { id: "gpt-5-nano" } } },
    })

    const result = await fetchAvailableModels(undefined, {
      connectedProviders: ["openai", "anthropic", "google", "opencode"]
    })

    expect(result.size).toBe(4)
    expect(result.has("openai/gpt-5.3-codex")).toBe(true)
    expect(result.has("anthropic/claude-sonnet-4-5")).toBe(true)
    expect(result.has("google/gemini-3-flash")).toBe(true)
    expect(result.has("opencode/gpt-5-nano")).toBe(true)
  })
})

describe("fuzzyMatchModel", () => {
	// given available models from multiple providers
	// when searching for a substring match
	// then return the matching model
	it("should match substring in model name", () => {
		const available = new Set([
			"openai/gpt-5.2",
			"openai/gpt-5.3-codex",
			"anthropic/claude-opus-4-6",
		])
		const result = fuzzyMatchModel("gpt-5.2", available)
		expect(result).toBe("openai/gpt-5.2")
	})

	// given available model with preview suffix
	// when searching with provider-prefixed base model
	// then return preview model
	it("should match preview suffix for gemini-3-flash", () => {
		const available = new Set(["google/gemini-3-flash-preview"])
		const result = fuzzyMatchModel(
			"google/gemini-3-flash",
			available,
			["google"],
		)
		expect(result).toBe("google/gemini-3-flash-preview")
	})

	// given available models with partial matches
	// when searching for a substring
	// then return exact match if it exists
	it("should prefer exact match over substring match", () => {
		const available = new Set([
			"openai/gpt-5.2",
			"openai/gpt-5.3-codex",
			"openai/gpt-5.2-ultra",
		])
		const result = fuzzyMatchModel("gpt-5.2", available)
		expect(result).toBe("openai/gpt-5.2")
	})

	// given available models with multiple substring matches
	// when searching for a substring
	// then return the shorter model name (more specific)
	it("should prefer shorter model name when multiple matches exist", () => {
		const available = new Set([
			"openai/gpt-5.2-ultra",
			"openai/gpt-5.2-ultra-mega",
		])
		const result = fuzzyMatchModel("gpt-5.2", available)
		expect(result).toBe("openai/gpt-5.2-ultra")
	})

	// given available models with claude variants
	// when searching for claude-opus
	// then return matching claude-opus model
	it("should match claude-opus to claude-opus-4-6", () => {
		const available = new Set([
			"anthropic/claude-opus-4-6",
			"anthropic/claude-sonnet-4-5",
		])
		const result = fuzzyMatchModel("claude-opus", available)
		expect(result).toBe("anthropic/claude-opus-4-6")
	})

	// given available models from multiple providers
	// when providers filter is specified
	// then only search models from specified providers
	it("should filter by provider when providers array is given", () => {
		const available = new Set([
			"openai/gpt-5.2",
			"anthropic/claude-opus-4-6",
			"google/gemini-3",
		])
		const result = fuzzyMatchModel("gpt", available, ["openai"])
		expect(result).toBe("openai/gpt-5.2")
	})

	// given available models from multiple providers
	// when providers filter excludes matching models
	// then return null
	it("should return null when provider filter excludes all matches", () => {
		const available = new Set([
			"openai/gpt-5.2",
			"anthropic/claude-opus-4-6",
		])
		const result = fuzzyMatchModel("claude", available, ["openai"])
		expect(result).toBeNull()
	})

	// given available models
	// when no substring match exists
	// then return null
	it("should return null when no match found", () => {
		const available = new Set([
			"openai/gpt-5.2",
			"anthropic/claude-opus-4-6",
		])
		const result = fuzzyMatchModel("gemini", available)
		expect(result).toBeNull()
	})

	// given available models with different cases
	// when searching with different case
	// then match case-insensitively
	it("should match case-insensitively", () => {
		const available = new Set([
			"openai/gpt-5.2",
			"anthropic/claude-opus-4-6",
		])
		const result = fuzzyMatchModel("GPT-5.2", available)
		expect(result).toBe("openai/gpt-5.2")
	})

	// given available models with exact match and longer variants
	// when searching for exact match
	// then return exact match first
	it("should prioritize exact match over longer variants", () => {
		const available = new Set([
			"anthropic/claude-opus-4-6",
			"anthropic/claude-opus-4-6-extended",
		])
		const result = fuzzyMatchModel("claude-opus-4-6", available)
		expect(result).toBe("anthropic/claude-opus-4-6")
	})

	// given available models with similar model IDs (e.g., glm-4.7 and glm-4.7-free)
	// when searching for the longer variant (glm-4.7-free)
	// then return exact model ID match, not the shorter one
	it("should prefer exact model ID match over shorter substring match", () => {
		const available = new Set([
			"zai-coding-plan/glm-4.7",
			"zai-coding-plan/glm-4.7-free",
		])
		const result = fuzzyMatchModel("glm-4.7-free", available)
		expect(result).toBe("zai-coding-plan/glm-4.7-free")
	})

	// given available models with similar model IDs
	// when searching for the shorter variant
	// then return the shorter match (existing behavior preserved)
	it("should still prefer shorter match when searching for shorter variant", () => {
		const available = new Set([
			"zai-coding-plan/glm-4.7",
			"zai-coding-plan/glm-4.7-free",
		])
		const result = fuzzyMatchModel("glm-4.7", available)
		expect(result).toBe("zai-coding-plan/glm-4.7")
	})

	// given same model ID from multiple providers
	// when searching for exact model ID
	// then return shortest full string (preserves tie-break behavior)
	it("should use shortest tie-break when multiple providers have same model ID", () => {
		const available = new Set([
			"opencode/gpt-5.2",
			"openai/gpt-5.2",
		])
		const result = fuzzyMatchModel("gpt-5.2", available)
		expect(result).toBe("openai/gpt-5.2")
	})

	// given available models with multiple providers
	// when multiple providers are specified
	// then search all specified providers
	it("should search all specified providers", () => {
		const available = new Set([
			"openai/gpt-5.2",
			"anthropic/claude-opus-4-6",
			"google/gemini-3",
		])
		const result = fuzzyMatchModel("gpt", available, ["openai", "google"])
		expect(result).toBe("openai/gpt-5.2")
	})

	// given available models with provider prefix
	// when searching with provider filter
	// then only match models with correct provider prefix
	it("should only match models with correct provider prefix", () => {
		const available = new Set([
			"openai/gpt-5.2",
			"anthropic/gpt-something",
		])
		const result = fuzzyMatchModel("gpt", available, ["openai"])
		expect(result).toBe("openai/gpt-5.2")
	})

	// given empty available set
	// when searching
	// then return null
	it("should return null for empty available set", () => {
		const available = new Set<string>()
		const result = fuzzyMatchModel("gpt", available)
		expect(result).toBeNull()
	})
})

describe("getConnectedProviders", () => {
	// given SDK client with connected providers
	// when provider.list returns data
	// then returns connected array
	it("should return connected providers from SDK", async () => {
		const mockClient = {
			provider: {
				list: async () => ({
					data: { connected: ["anthropic", "opencode", "google"] }
				})
			}
		}

		const result = await getConnectedProviders(mockClient)

		expect(result).toEqual(["anthropic", "opencode", "google"])
	})

	// given SDK client
	// when provider.list throws error
	// then returns empty array
	it("should return empty array on SDK error", async () => {
		const mockClient = {
			provider: {
				list: async () => { throw new Error("Network error") }
			}
		}

		const result = await getConnectedProviders(mockClient)

		expect(result).toEqual([])
	})

	// given SDK client with empty connected array
	// when provider.list returns empty
	// then returns empty array
	it("should return empty array when no providers connected", async () => {
		const mockClient = {
			provider: {
				list: async () => ({ data: { connected: [] } })
			}
		}

		const result = await getConnectedProviders(mockClient)

		expect(result).toEqual([])
	})

	// given SDK client without provider.list method
	// when getConnectedProviders called
	// then returns empty array
	it("should return empty array when client.provider.list not available", async () => {
		const mockClient = {}

		const result = await getConnectedProviders(mockClient)

		expect(result).toEqual([])
	})

	// given null client
	// when getConnectedProviders called
	// then returns empty array
	it("should return empty array for null client", async () => {
		const result = await getConnectedProviders(null)

		expect(result).toEqual([])
	})

	// given SDK client with missing data.connected
	// when provider.list returns without connected field
	// then returns empty array
	it("should return empty array when data.connected is undefined", async () => {
		const mockClient = {
			provider: {
				list: async () => ({ data: {} })
			}
		}

		const result = await getConnectedProviders(mockClient)

		expect(result).toEqual([])
	})
})

describe("fetchAvailableModels with connected providers filtering", () => {
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

	// given cache with multiple providers
	// when connectedProviders specifies one provider
	// then only returns models from that provider
	it("should filter models by connected providers", async () => {
		writeModelsCache({
			openai: { models: { "gpt-5.2": { id: "gpt-5.2" } } },
			anthropic: { models: { "claude-opus-4-6": { id: "claude-opus-4-6" } } },
			google: { models: { "gemini-3-pro": { id: "gemini-3-pro" } } },
		})

		const result = await fetchAvailableModels(undefined, {
			connectedProviders: ["anthropic"]
		})

		expect(result.size).toBe(1)
		expect(result.has("anthropic/claude-opus-4-6")).toBe(true)
		expect(result.has("openai/gpt-5.2")).toBe(false)
		expect(result.has("google/gemini-3-pro")).toBe(false)
	})

	// given cache with multiple providers
	// when connectedProviders specifies multiple providers
	// then returns models from all specified providers
	it("should filter models by multiple connected providers", async () => {
		writeModelsCache({
			openai: { models: { "gpt-5.2": { id: "gpt-5.2" } } },
			anthropic: { models: { "claude-opus-4-6": { id: "claude-opus-4-6" } } },
			google: { models: { "gemini-3-pro": { id: "gemini-3-pro" } } },
		})

		const result = await fetchAvailableModels(undefined, {
			connectedProviders: ["anthropic", "google"]
		})

		expect(result.size).toBe(2)
		expect(result.has("anthropic/claude-opus-4-6")).toBe(true)
		expect(result.has("google/gemini-3-pro")).toBe(true)
		expect(result.has("openai/gpt-5.2")).toBe(false)
	})

	// given cache with models
	// when connectedProviders is empty array
	// then returns empty set
	it("should return empty set when connectedProviders is empty", async () => {
		writeModelsCache({
			openai: { models: { "gpt-5.2": { id: "gpt-5.2" } } },
			anthropic: { models: { "claude-opus-4-6": { id: "claude-opus-4-6" } } },
		})

		const result = await fetchAvailableModels(undefined, {
			connectedProviders: []
		})

		expect(result.size).toBe(0)
	})

	// given cache with models
	// when connectedProviders is undefined (no options)
	// then returns empty set (triggers fallback in resolver)
	it("should return empty set when connectedProviders not specified", async () => {
		writeModelsCache({
			openai: { models: { "gpt-5.2": { id: "gpt-5.2" } } },
			anthropic: { models: { "claude-opus-4-6": { id: "claude-opus-4-6" } } },
		})

		const result = await fetchAvailableModels()

		expect(result.size).toBe(0)
	})

	// given cache with models
	// when connectedProviders contains provider not in cache
	// then returns empty set for that provider
	it("should handle provider not in cache gracefully", async () => {
		writeModelsCache({
			openai: { models: { "gpt-5.2": { id: "gpt-5.2" } } },
		})

		const result = await fetchAvailableModels(undefined, {
			connectedProviders: ["azure"]
		})

		expect(result.size).toBe(0)
	})

	// given cache with models and mixed connected providers
	// when some providers exist in cache and some don't
	// then returns models only from matching providers
	it("should return models from providers that exist in both cache and connected list", async () => {
		writeModelsCache({
			openai: { models: { "gpt-5.2": { id: "gpt-5.2" } } },
			anthropic: { models: { "claude-opus-4-6": { id: "claude-opus-4-6" } } },
		})

		const result = await fetchAvailableModels(undefined, {
			connectedProviders: ["anthropic", "azure", "unknown"]
		})

		expect(result.size).toBe(1)
		expect(result.has("anthropic/claude-opus-4-6")).toBe(true)
	})

	// given filtered fetch
	// when called twice with different filters
	// then does NOT use cache (dynamic per-session)
	it("should not cache filtered results", async () => {
		writeModelsCache({
			openai: { models: { "gpt-5.2": { id: "gpt-5.2" } } },
			anthropic: { models: { "claude-opus-4-6": { id: "claude-opus-4-6" } } },
		})

		// First call with anthropic
		const result1 = await fetchAvailableModels(undefined, {
			connectedProviders: ["anthropic"]
		})
		expect(result1.size).toBe(1)

		// Second call with openai - should work, not cached
		const result2 = await fetchAvailableModels(undefined, {
			connectedProviders: ["openai"]
		})
		expect(result2.size).toBe(1)
		expect(result2.has("openai/gpt-5.2")).toBe(true)
	})

	// given connectedProviders unknown
	// when called twice without connectedProviders
	// then always returns empty set (triggers fallback)
	it("should return empty set when connectedProviders unknown", async () => {
		writeModelsCache({
			openai: { models: { "gpt-5.2": { id: "gpt-5.2" } } },
		})

		const result1 = await fetchAvailableModels()
		const result2 = await fetchAvailableModels()

		expect(result1.size).toBe(0)
		expect(result2.size).toBe(0)
	})
})

describe("fetchAvailableModels with provider-models cache (whitelist-filtered)", () => {
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

	function writeProviderModelsCache(data: { models: Record<string, string[] | any[]>; connected: string[] }) {
		const cacheDir = join(tempDir, "oh-my-opencode")
		require("fs").mkdirSync(cacheDir, { recursive: true })
		writeFileSync(join(cacheDir, "provider-models.json"), JSON.stringify({
			...data,
			updatedAt: new Date().toISOString()
		}))
	}

	function writeModelsCache(data: Record<string, any>) {
		const cacheDir = join(tempDir, "opencode")
		require("fs").mkdirSync(cacheDir, { recursive: true })
		writeFileSync(join(cacheDir, "models.json"), JSON.stringify(data))
	}

	// given provider-models cache exists (whitelist-filtered)
	// when fetchAvailableModels called
	// then uses provider-models cache instead of models.json
	it("should prefer provider-models cache over models.json", async () => {
		writeProviderModelsCache({
			models: {
				opencode: ["glm-4.7-free", "gpt-5-nano"],
				anthropic: ["claude-opus-4-6"]
			},
			connected: ["opencode", "anthropic"]
		})
		writeModelsCache({
			opencode: { models: { "glm-4.7-free": {}, "gpt-5-nano": {}, "gpt-5.2": {} } },
			anthropic: { models: { "claude-opus-4-6": {}, "claude-sonnet-4-5": {} } }
		})

		const result = await fetchAvailableModels(undefined, {
			connectedProviders: ["opencode", "anthropic"]
		})

		expect(result.size).toBe(3)
		expect(result.has("opencode/glm-4.7-free")).toBe(true)
		expect(result.has("opencode/gpt-5-nano")).toBe(true)
		expect(result.has("anthropic/claude-opus-4-6")).toBe(true)
		expect(result.has("opencode/gpt-5.2")).toBe(false)
		expect(result.has("anthropic/claude-sonnet-4-5")).toBe(false)
	})

	// given provider-models cache exists but has no models (API failure)
	// when fetchAvailableModels called
	// then falls back to models.json so fuzzy matching can still work
	it("should fall back to models.json when provider-models cache is empty", async () => {
		writeProviderModelsCache({
			models: {
			},
			connected: ["google"],
		})
		writeModelsCache({
			google: { models: { "gemini-3-flash-preview": {} } },
		})

		const availableModels = await fetchAvailableModels(undefined, {
			connectedProviders: ["google"],
		})
		const match = fuzzyMatchModel("google/gemini-3-flash", availableModels, ["google"])

		expect(match).toBe("google/gemini-3-flash-preview")
	})

	// given only models.json exists (no provider-models cache)
	// when fetchAvailableModels called
	// then falls back to models.json (no whitelist filtering)
	it("should fallback to models.json when provider-models cache not found", async () => {
		writeModelsCache({
			opencode: { models: { "glm-4.7-free": {}, "gpt-5-nano": {}, "gpt-5.2": {} } },
		})

		const result = await fetchAvailableModels(undefined, {
			connectedProviders: ["opencode"]
		})

		expect(result.size).toBe(3)
		expect(result.has("opencode/glm-4.7-free")).toBe(true)
		expect(result.has("opencode/gpt-5-nano")).toBe(true)
		expect(result.has("opencode/gpt-5.2")).toBe(true)
	})

	// given provider-models cache with whitelist
	// when connectedProviders filters to subset
	// then only returns models from connected providers
	it("should filter by connectedProviders even with provider-models cache", async () => {
		writeProviderModelsCache({
			models: {
				opencode: ["glm-4.7-free"],
				anthropic: ["claude-opus-4-6"],
				google: ["gemini-3-pro"]
			},
			connected: ["opencode", "anthropic", "google"]
		})

		const result = await fetchAvailableModels(undefined, {
			connectedProviders: ["opencode"]
		})

		expect(result.size).toBe(1)
		expect(result.has("opencode/glm-4.7-free")).toBe(true)
		expect(result.has("anthropic/claude-opus-4-6")).toBe(false)
		expect(result.has("google/gemini-3-pro")).toBe(false)
	})

	it("should handle object[] format with metadata (Ollama-style)", async () => {
		writeProviderModelsCache({
			models: {
				ollama: [
					{ id: "ministral-3:14b-32k-agent", provider: "ollama", context: 32768, output: 8192 },
					{ id: "qwen3-coder:32k-agent", provider: "ollama", context: 32768, output: 8192 }
				]
			},
			connected: ["ollama"]
		})

		const result = await fetchAvailableModels(undefined, {
			connectedProviders: ["ollama"]
		})

		expect(result.size).toBe(2)
		expect(result.has("ollama/ministral-3:14b-32k-agent")).toBe(true)
		expect(result.has("ollama/qwen3-coder:32k-agent")).toBe(true)
	})

	it("should handle mixed string[] and object[] formats across providers", async () => {
		writeProviderModelsCache({
			models: {
				anthropic: ["claude-opus-4-6", "claude-sonnet-4-5"],
				ollama: [
					{ id: "ministral-3:14b-32k-agent", provider: "ollama" },
					{ id: "qwen3-coder:32k-agent", provider: "ollama" }
				]
			},
			connected: ["anthropic", "ollama"]
		})

		const result = await fetchAvailableModels(undefined, {
			connectedProviders: ["anthropic", "ollama"]
		})

		expect(result.size).toBe(4)
		expect(result.has("anthropic/claude-opus-4-6")).toBe(true)
		expect(result.has("anthropic/claude-sonnet-4-5")).toBe(true)
		expect(result.has("ollama/ministral-3:14b-32k-agent")).toBe(true)
		expect(result.has("ollama/qwen3-coder:32k-agent")).toBe(true)
	})

	it("should skip invalid entries in object[] format", async () => {
		writeProviderModelsCache({
			models: {
				ollama: [
					{ id: "valid-model", provider: "ollama" },
					{ provider: "ollama" },
					{ id: "", provider: "ollama" },
					null,
					"string-model"
				]
			},
			connected: ["ollama"]
		})

		const result = await fetchAvailableModels(undefined, {
			connectedProviders: ["ollama"]
		})

		expect(result.size).toBe(2)
		expect(result.has("ollama/valid-model")).toBe(true)
		expect(result.has("ollama/string-model")).toBe(true)
	})
})

describe("isModelAvailable", () => {
	it("returns true when model exists via fuzzy match", () => {
		// given
		const available = new Set(["openai/gpt-5.3-codex", "anthropic/claude-opus-4-6"])

		// when
		const result = isModelAvailable("gpt-5.3-codex", available)

		// then
		expect(result).toBe(true)
	})

	it("returns false when model not found", () => {
		// given
		const available = new Set(["anthropic/claude-opus-4-6"])

		// when
		const result = isModelAvailable("gpt-5.3-codex", available)

		// then
		expect(result).toBe(false)
	})

	it("returns false for empty available set", () => {
		// given
		const available = new Set<string>()

		// when
		const result = isModelAvailable("gpt-5.3-codex", available)

		// then
		expect(result).toBe(false)
	})
})
