import { log } from "./logger"
import * as dataPath from "./data-path"
import { createJsonFileCacheStore } from "./json-file-cache-store"

const EXHAUSTED_PROVIDERS_CACHE_FILE = "exhausted-providers.json"

export const DEFAULT_EXHAUSTED_PROVIDER_TTL_MS = 4 * 60 * 60 * 1000

export interface ExhaustedProviderEntry {
	reason: string
	exhaustedAt: string
	ttlMs: number
}

interface ExhaustedProvidersCache {
	providers: Record<string, ExhaustedProviderEntry>
	updatedAt: string
}

type ExhaustedProvidersCacheStoreOptions = {
	getCacheDir?: () => string
	ttlMs?: number
}

function isEntryExpired(entry: ExhaustedProviderEntry, now: number): boolean {
	const exhaustedAtMs = Date.parse(entry.exhaustedAt)
	if (Number.isNaN(exhaustedAtMs)) return true
	return now - exhaustedAtMs >= entry.ttlMs
}

export function createExhaustedProvidersCacheStore(options: ExhaustedProvidersCacheStoreOptions = {}) {
	const getCacheDir = options.getCacheDir ?? dataPath.getOmoOpenCodeCacheDir
	const defaultTtlMs = options.ttlMs ?? DEFAULT_EXHAUSTED_PROVIDER_TTL_MS

	const store = createJsonFileCacheStore<ExhaustedProvidersCache>({
		getCacheDir,
		filename: EXHAUSTED_PROVIDERS_CACHE_FILE,
		logPrefix: "exhausted-providers-cache",
		cacheLabel: "Exhausted-providers cache",
		describe: (value) => ({ count: Object.keys(value.providers).length, updatedAt: value.updatedAt }),
	})

	function readProviders(): Record<string, ExhaustedProviderEntry> {
		return store.read()?.providers ?? {}
	}

	function clearExpiredEntries(now: number = Date.now()): string[] {
		const providers = readProviders()
		const expired: string[] = []
		const remaining: Record<string, ExhaustedProviderEntry> = {}
		for (const [providerID, entry] of Object.entries(providers)) {
			if (isEntryExpired(entry, now)) {
				expired.push(providerID)
			} else {
				remaining[providerID] = entry
			}
		}
		if (expired.length === 0) return []
		store.write({ providers: remaining, updatedAt: new Date().toISOString() })
		log("[exhausted-providers-cache] Cleared expired entries", { expired })
		return expired
	}

	function markProviderExhausted(providerID: string, reason: string): void {
		clearExpiredEntries()
		const providers = readProviders()
		providers[providerID] = {
			reason,
			exhaustedAt: new Date().toISOString(),
			ttlMs: defaultTtlMs,
		}
		store.write({ providers, updatedAt: new Date().toISOString() })
		log("[exhausted-providers-cache] Marked provider exhausted", { providerID, reason })
	}

	function isProviderExhausted(providerID: string, now: number = Date.now()): boolean {
		const entry = readProviders()[providerID]
		return entry !== undefined && !isEntryExpired(entry, now)
	}

	function getExhaustedProviderIDs(now: number = Date.now()): string[] {
		clearExpiredEntries(now)
		return Object.keys(readProviders())
	}

	function _resetMemCacheForTesting(): void {
		store.resetMemory()
	}

	return {
		markProviderExhausted,
		isProviderExhausted,
		getExhaustedProviderIDs,
		clearExpiredEntries,
		_resetMemCacheForTesting,
	}
}

const defaultExhaustedProvidersCacheStore = createExhaustedProvidersCacheStore()

export const {
	markProviderExhausted,
	isProviderExhausted,
	getExhaustedProviderIDs,
	clearExpiredEntries,
	_resetMemCacheForTesting,
} = defaultExhaustedProvidersCacheStore
