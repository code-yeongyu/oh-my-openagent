import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createExhaustedProvidersCacheStore } from "./exhausted-providers-cache"

describe("createExhaustedProvidersCacheStore", () => {
	let cacheDir: string

	beforeEach(() => {
		cacheDir = mkdtempSync(join(tmpdir(), "exhausted-providers-cache-test-"))
	})

	afterEach(() => {
		rmSync(cacheDir, { recursive: true, force: true })
	})

	describe("#given a fresh store", () => {
		test("#then no provider is exhausted before marking", () => {
			const store = createExhaustedProvidersCacheStore({ getCacheDir: () => cacheDir })

			expect(store.isProviderExhausted("kimi-for-coding")).toBe(false)
			expect(store.getExhaustedProviderIDs()).toEqual([])
		})
	})

	describe("#given a marked provider", () => {
		test("#then isProviderExhausted reports it and getExhaustedProviderIDs lists it", () => {
			const store = createExhaustedProvidersCacheStore({ getCacheDir: () => cacheDir })

			store.markProviderExhausted("kimi-for-coding", "quota_exceeded")

			expect(store.isProviderExhausted("kimi-for-coding")).toBe(true)
			expect(store.getExhaustedProviderIDs()).toEqual(["kimi-for-coding"])
		})

		test("#then other providers remain unmarked", () => {
			const store = createExhaustedProvidersCacheStore({ getCacheDir: () => cacheDir })

			store.markProviderExhausted("kimi-for-coding", "quota_exceeded")

			expect(store.isProviderExhausted("openai")).toBe(false)
		})

		test("#then state persists across store instances via the cache file", () => {
			const store = createExhaustedProvidersCacheStore({ getCacheDir: () => cacheDir })
			store.markProviderExhausted("xai", "insufficient credits")

		 const reloaded = createExhaustedProvidersCacheStore({ getCacheDir: () => cacheDir })

			expect(reloaded.isProviderExhausted("xai")).toBe(true)
		})
	})

	describe("#given an expired entry (tiny TTL)", () => {
		test("#then isProviderExhausted returns false after the TTL elapses", async () => {
			const store = createExhaustedProvidersCacheStore({ getCacheDir: () => cacheDir, ttlMs: 5 })

			store.markProviderExhausted("openai", "quota_exceeded")
			await new Promise((resolve) => setTimeout(resolve, 15))

			expect(store.isProviderExhausted("openai")).toBe(false)
		})

		test("#then clearExpiredEntries drops the expired entry from the cache file", async () => {
			const store = createExhaustedProvidersCacheStore({ getCacheDir: () => cacheDir, ttlMs: 5 })
			store.markProviderExhausted("openai", "quota_exceeded")
			await new Promise((resolve) => setTimeout(resolve, 15))

			const expired = store.clearExpiredEntries()

			expect(expired).toEqual(["openai"])
			expect(store.getExhaustedProviderIDs()).toEqual([])
		})

		test("#then getExhaustedProviderIDs skips expired entries without listing them", async () => {
			const store = createExhaustedProvidersCacheStore({ getCacheDir: () => cacheDir, ttlMs: 5 })
			store.markProviderExhausted("openai", "quota_exceeded")
			store.markProviderExhausted("anthropic", "quota_exceeded")
			await new Promise((resolve) => setTimeout(resolve, 15))
			store.markProviderExhausted("xai", "quota_exceeded")

			expect(store.getExhaustedProviderIDs()).toEqual(["xai"])
		})
	})
})
