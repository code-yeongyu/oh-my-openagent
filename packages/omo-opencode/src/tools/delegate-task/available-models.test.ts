/// <reference types="bun-types" />

import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { getAvailableModelsForDelegateTask } from "./available-models"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import type { ProviderModelsCache } from "../../shared/connected-providers-cache"
import * as exhaustedProvidersCache from "../../shared/exhausted-providers-cache"

function fakeClientWithModelList(rows: Array<{ provider: string; id: string }>) {
	return {
		model: {
			list: async () => rows,
		},
	}
}

describe("getAvailableModelsForDelegateTask", () => {
	let exhaustedIDsSpy: ReturnType<typeof spyOn> | undefined

	afterEach(() => {
		exhaustedIDsSpy?.mockRestore()
	})

	describe("#given warm provider-models cache with two connected providers", () => {
		test("#when no provider is exhausted #then returns models from all connected providers", async () => {
			const warmCache: ProviderModelsCache = {
				models: {
					anthropic: ["claude-opus-5"],
					openai: ["gpt-5.6-sol"],
				},
				connected: ["anthropic", "openai"],
				updatedAt: new Date().toISOString(),
			}
			const readWarmSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue(warmCache)
			exhaustedIDsSpy = spyOn(exhaustedProvidersCache, "getExhaustedProviderIDs").mockReturnValue([])

			const result = await getAvailableModelsForDelegateTask(fakeClientWithModelList([]) as never)

			expect(result).toEqual(new Set(["anthropic/claude-opus-5", "openai/gpt-5.6-sol"]))
			readWarmSpy.mockRestore()
		})

		test("#when one provider is exhausted #then its models are excluded", async () => {
			const warmCache: ProviderModelsCache = {
				models: {
					anthropic: ["claude-opus-5"],
					openai: ["gpt-5.6-sol"],
				},
				connected: ["anthropic", "openai"],
				updatedAt: new Date().toISOString(),
			}
			const readWarmSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue(warmCache)
			exhaustedIDsSpy = spyOn(exhaustedProvidersCache, "getExhaustedProviderIDs").mockReturnValue(["anthropic"])

			const result = await getAvailableModelsForDelegateTask(fakeClientWithModelList([]) as never)

			expect(result).toEqual(new Set(["openai/gpt-5.6-sol"]))
			readWarmSpy.mockRestore()
		})

		test("#when another provider is exhausted #then Kimi remains available", async () => {
			const warmCache: ProviderModelsCache = {
				models: {
					"kimi-for-coding": ["k3"],
					openai: ["gpt-5.6-sol"],
				},
				connected: ["kimi-for-coding", "openai"],
				updatedAt: new Date().toISOString(),
			}
			const readWarmSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue(warmCache)
			exhaustedIDsSpy = spyOn(exhaustedProvidersCache, "getExhaustedProviderIDs").mockReturnValue(["openai"])

			const result = await getAvailableModelsForDelegateTask(fakeClientWithModelList([]) as never)

			expect(result).toEqual(new Set(["kimi-for-coding/k3"]))
			readWarmSpy.mockRestore()
		})
	})

	describe("#given cold cache with connected providers only", () => {
		test("#when one provider is exhausted #then client.model.list rows for it are excluded", async () => {
			const readWarmSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue(null)
			const readConnectedSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([
				"anthropic",
				"openai",
			])
			exhaustedIDsSpy = spyOn(exhaustedProvidersCache, "getExhaustedProviderIDs").mockReturnValue(["anthropic"])

			const client = fakeClientWithModelList([
				{ provider: "anthropic", id: "claude-opus-5" },
				{ provider: "openai", id: "gpt-5.6-sol" },
			])

			const result = await getAvailableModelsForDelegateTask(client as never)

			expect(result).toEqual(new Set(["openai/gpt-5.6-sol"]))
			readWarmSpy.mockRestore()
			readConnectedSpy.mockRestore()
		})
	})
})
