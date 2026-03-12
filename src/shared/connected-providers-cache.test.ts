/// <reference types="bun-types" />

import { beforeAll, beforeEach, afterEach, describe, expect, mock, test } from "bun:test"

import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as dataPath from "./data-path"

let testCacheDir = ""
let moduleImportCounter = 0

const getOmoOpenCodeCacheDirMock = mock(() => testCacheDir)

let updateConnectedProvidersCache: typeof import("./connected-providers-cache").updateConnectedProvidersCache
let readProviderModelsCache: typeof import("./connected-providers-cache").readProviderModelsCache

describe("updateConnectedProvidersCache", () => {
	beforeAll(() => {
		mock.restore()
	})

	beforeEach(async () => {
		mock.restore()
		const realCacheDir = join(dataPath.getCacheDir(), "oh-my-opencode")
		if (existsSync(realCacheDir)) {
			rmSync(realCacheDir, { recursive: true, force: true })
		}

		testCacheDir = mkdtempSync(join(tmpdir(), "connected-providers-cache-test-"))
		getOmoOpenCodeCacheDirMock.mockClear()
		mock.module("./data-path", () => ({
			getOmoOpenCodeCacheDir: getOmoOpenCodeCacheDirMock,
		}))
		moduleImportCounter += 1
		;({ updateConnectedProvidersCache, readProviderModelsCache } = await import(`./connected-providers-cache?test=${moduleImportCounter}`))
	})

	afterEach(() => {
		mock.restore()
		if (existsSync(testCacheDir)) {
			rmSync(testCacheDir, { recursive: true, force: true })
		}
		testCacheDir = ""
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
