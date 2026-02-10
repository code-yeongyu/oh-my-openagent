import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "fs"
import { join } from "path"
import * as dataPath from "./data-path"
import { updateConnectedProvidersCache, readProviderModelsCache } from "./connected-providers-cache"

const TEST_CACHE_DIR = join(import.meta.dir, "__test-cache__")

describe("updateConnectedProvidersCache", () => {
	let cacheDirSpy: ReturnType<typeof spyOn>

	beforeEach(() => {
		cacheDirSpy = spyOn(dataPath, "getOmoOpenCodeCacheDir").mockReturnValue(TEST_CACHE_DIR)
		if (existsSync(TEST_CACHE_DIR)) {
			rmSync(TEST_CACHE_DIR, { recursive: true })
		}
		mkdirSync(TEST_CACHE_DIR, { recursive: true })
	})

	afterEach(() => {
		cacheDirSpy.mockRestore()
		if (existsSync(TEST_CACHE_DIR)) {
			rmSync(TEST_CACHE_DIR, { recursive: true })
		}
	})

	test("extracts models from provider.list().all response", async () => {
		//#given
		const mockClient = {
			provider: {
				list: async () => ({
					data: {
						connected: ["openai", "anthropic"],
						all: [
							{
								id: "openai",
								name: "OpenAI",
								env: [],
								models: {
									"gpt-5.3-codex": { id: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
									"gpt-5.2": { id: "gpt-5.2", name: "GPT-5.2" },
								},
							},
							{
								id: "anthropic",
								name: "Anthropic",
								env: [],
								models: {
									"claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
									"claude-sonnet-4-5": { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
								},
							},
						],
					},
				}),
			},
		}

		//#when
		await updateConnectedProvidersCache(mockClient)

		//#then
		const cache = readProviderModelsCache()
		expect(cache).not.toBeNull()
		expect(cache!.connected).toEqual(["openai", "anthropic"])
		expect(cache!.models).toEqual({
			openai: ["gpt-5.3-codex", "gpt-5.2"],
			anthropic: ["claude-opus-4-6", "claude-sonnet-4-5"],
		})
	})

	test("writes empty models when provider has no models", async () => {
		//#given
		const mockClient = {
			provider: {
				list: async () => ({
					data: {
						connected: ["empty-provider"],
						all: [
							{
								id: "empty-provider",
								name: "Empty",
								env: [],
								models: {},
							},
						],
					},
				}),
			},
		}

		//#when
		await updateConnectedProvidersCache(mockClient)

		//#then
		const cache = readProviderModelsCache()
		expect(cache).not.toBeNull()
		expect(cache!.models).toEqual({})
	})

	test("writes empty models when all field is missing", async () => {
		//#given
		const mockClient = {
			provider: {
				list: async () => ({
					data: {
						connected: ["openai"],
					},
				}),
			},
		}

		//#when
		await updateConnectedProvidersCache(mockClient)

		//#then
		const cache = readProviderModelsCache()
		expect(cache).not.toBeNull()
		expect(cache!.models).toEqual({})
	})

	test("does nothing when client.provider.list is not available", async () => {
		//#given
		const mockClient = {}

		//#when
		await updateConnectedProvidersCache(mockClient)

		//#then
		const cache = readProviderModelsCache()
		expect(cache).toBeNull()
	})
})
