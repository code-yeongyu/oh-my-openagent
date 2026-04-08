/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

type ConnectedProvidersCacheModule = typeof import("./connected-providers-cache")

async function importFreshConnectedProvidersCacheModule(): Promise<ConnectedProvidersCacheModule> {
  return await import(
    new URL(`./connected-providers-cache.ts?real-connected-providers-cache-test=${Date.now()}-${Math.random()}`, import.meta.url).href
  )
}

function createTestCacheContext(
  createConnectedProvidersCacheStore: ConnectedProvidersCacheModule["createConnectedProvidersCacheStore"],
) {
	const fakeUserCacheRoot = mkdtempSync(join(tmpdir(), "connected-providers-user-cache-"))
	const testCacheDir = join(fakeUserCacheRoot, "oh-my-opencode")
	const testCacheStore = createConnectedProvidersCacheStore(() => testCacheDir)

	return {
		fakeUserCacheRoot,
		testCacheDir,
		testCacheStore,
	}
}

function cleanupTestCacheContext(fakeUserCacheRoot: string): void {
	if (existsSync(fakeUserCacheRoot)) {
		rmSync(fakeUserCacheRoot, { recursive: true, force: true })
	}
}

describe("updateConnectedProvidersCache", () => {
	test("extracts models from provider.list().all response", async () => {
		const { createConnectedProvidersCacheStore } = await importFreshConnectedProvidersCacheModule()
		const { testCacheStore, fakeUserCacheRoot } = createTestCacheContext(createConnectedProvidersCacheStore)

		try {
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
			await testCacheStore.updateConnectedProvidersCache(mockClient)

			//#then
			const cache = testCacheStore.readProviderModelsCache()
			expect(cache).not.toBeNull()
			expect(cache!.connected).toEqual(["openai", "anthropic"])
			expect(cache!.models).toEqual({
				openai: [
					{ id: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
					{ id: "gpt-5.4", name: "GPT-5.4" },
				],
				anthropic: [
					{ id: "claude-opus-4-6", name: "Claude Opus 4.6" },
					{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
				],
			})
		} finally {
			cleanupTestCacheContext(fakeUserCacheRoot)
		}
	})

	test("writes empty models when provider has no models", async () => {
		const { createConnectedProvidersCacheStore } = await importFreshConnectedProvidersCacheModule()
		const { testCacheStore, fakeUserCacheRoot } = createTestCacheContext(createConnectedProvidersCacheStore)

		try {
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
			await testCacheStore.updateConnectedProvidersCache(mockClient)

			//#then
			const cache = testCacheStore.readProviderModelsCache()
			expect(cache).not.toBeNull()
			expect(cache!.models).toEqual({})
		} finally {
			cleanupTestCacheContext(fakeUserCacheRoot)
		}
	})

	test("writes empty models when all field is missing", async () => {
		const { createConnectedProvidersCacheStore } = await importFreshConnectedProvidersCacheModule()
		const { testCacheStore, fakeUserCacheRoot } = createTestCacheContext(createConnectedProvidersCacheStore)

		try {
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
			await testCacheStore.updateConnectedProvidersCache(mockClient)

			//#then
			const cache = testCacheStore.readProviderModelsCache()
			expect(cache).not.toBeNull()
			expect(cache!.models).toEqual({})
		} finally {
			cleanupTestCacheContext(fakeUserCacheRoot)
		}
	})

	test("does nothing when client.provider.list is not available", async () => {
		const { createConnectedProvidersCacheStore } = await importFreshConnectedProvidersCacheModule()
		const { testCacheStore, fakeUserCacheRoot } = createTestCacheContext(createConnectedProvidersCacheStore)

		try {
			//#given
			const mockClient = {}

			//#when
			await testCacheStore.updateConnectedProvidersCache(mockClient)

			//#then
			const cache = testCacheStore.readProviderModelsCache()
			expect(cache).toBeNull()
		} finally {
			cleanupTestCacheContext(fakeUserCacheRoot)
		}
	})

	test("does not remove unrelated files in the cache directory", async () => {
		const { createConnectedProvidersCacheStore } = await importFreshConnectedProvidersCacheModule()
		const { testCacheStore, fakeUserCacheRoot } = createTestCacheContext(createConnectedProvidersCacheStore)

		//#given
		const realCacheDir = join(fakeUserCacheRoot, "oh-my-opencode")
		const sentinelPath = join(realCacheDir, "connected-providers-cache.test-sentinel.json")
		mkdirSync(realCacheDir, { recursive: true })
		writeFileSync(sentinelPath, JSON.stringify({ keep: true }))

		const mockClient = {
			provider: {
				list: async () => ({
					data: {
						connected: ["openai"],
						all: [
							{
								id: "openai",
								models: {
									"gpt-5.4": { id: "gpt-5.4" },
								},
							},
						],
					},
				}),
			},
		}

		try {
			//#when
			await testCacheStore.updateConnectedProvidersCache(mockClient)

			//#then
			expect(testCacheStore.readConnectedProvidersCache()).toEqual(["openai"])
			expect(existsSync(sentinelPath)).toBe(true)
			expect(readFileSync(sentinelPath, "utf-8")).toBe(JSON.stringify({ keep: true }))
		} finally {
			if (existsSync(sentinelPath)) {
				rmSync(sentinelPath, { force: true })
			}
			cleanupTestCacheContext(fakeUserCacheRoot)
		}
	})

	test("findProviderModelMetadata returns rich cached metadata", async () => {
		const {
			createConnectedProvidersCacheStore,
			findProviderModelMetadata,
		} = await importFreshConnectedProvidersCacheModule()
		const { testCacheStore, fakeUserCacheRoot } = createTestCacheContext(createConnectedProvidersCacheStore)

		try {
			//#given
			const mockClient = {
				provider: {
					list: async () => ({
						data: {
							connected: ["openai"],
							all: [
								{
									id: "openai",
									models: {
										"gpt-5.4": {
											id: "gpt-5.4",
											name: "GPT-5.4",
											temperature: false,
											variants: {
												low: {},
												high: {},
											},
											limit: { output: 128000 },
										},
									},
								},
							],
						},
					}),
				},
			}

			await testCacheStore.updateConnectedProvidersCache(mockClient)
			const cache = testCacheStore.readProviderModelsCache()

			//#when
			const result = findProviderModelMetadata("openai", "gpt-5.4", cache)

			//#then
			expect(result).toEqual({
				id: "gpt-5.4",
				name: "GPT-5.4",
				temperature: false,
				variants: {
					low: {},
					high: {},
				},
				limit: { output: 128000 },
			})
		} finally {
			cleanupTestCacheContext(fakeUserCacheRoot)
		}
	})

	test("keeps normalized fallback ids when raw metadata id is not a string", async () => {
		const {
			createConnectedProvidersCacheStore,
			findProviderModelMetadata,
		} = await importFreshConnectedProvidersCacheModule()
		const { testCacheStore, fakeUserCacheRoot } = createTestCacheContext(createConnectedProvidersCacheStore)

		try {
			const mockClient = {
				provider: {
					list: async () => ({
						data: {
							connected: ["openai"],
							all: [
								{
									id: "openai",
									models: {
										"o3-mini": {
											id: 123,
											name: "o3-mini",
										},
									},
								},
							],
						},
					}),
				},
			}

			await testCacheStore.updateConnectedProvidersCache(mockClient)
			const cache = testCacheStore.readProviderModelsCache()

			expect(cache?.models.openai).toEqual([
				{ id: "o3-mini", name: "o3-mini" },
			])
			expect(findProviderModelMetadata("openai", "o3-mini", cache)).toEqual({
				id: "o3-mini",
				name: "o3-mini",
			})
		} finally {
			cleanupTestCacheContext(fakeUserCacheRoot)
		}
	})
})
