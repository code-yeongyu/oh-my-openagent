import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import * as dataPath from "./data-path"
import { updateConnectedProvidersCache, readProviderModelsCache } from "./connected-providers-cache"

describe("updateConnectedProvidersCache", () => {
	let cacheDirSpy: ReturnType<typeof spyOn>
	let testCacheDir: string

	beforeEach(() => {
		testCacheDir = mkdtempSync(join(tmpdir(), "omo-connected-providers-"))
		cacheDirSpy = spyOn(dataPath, "getOmoOpenCodeCacheDir").mockReturnValue(testCacheDir)
		if (existsSync(testCacheDir)) {
			rmSync(testCacheDir, { recursive: true })
		}
		mkdirSync(testCacheDir, { recursive: true })
	})

	afterEach(() => {
		cacheDirSpy.mockRestore()
		if (existsSync(testCacheDir)) {
			rmSync(testCacheDir, { recursive: true })
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
									"gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4" },
								},
							},
							{
								id: "anthropic",
								name: "Anthropic",
								env: [],
								models: {
									"claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
									"claude-sonnet-4-6": { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
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
			openai: ["gpt-5.3-codex", "gpt-5.4"],
			anthropic: ["claude-opus-4-6", "claude-sonnet-4-6"],
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
