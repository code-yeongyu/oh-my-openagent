import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { log } from "./logger"

type JsonFileCacheStoreOptions<TValue> = {
	getCacheDir: () => string
	filename: string
	logPrefix: string
	cacheLabel: string
	describe: (value: TValue) => Record<string, unknown>
	serialize?: (value: TValue) => string
}

type JsonFileCacheStore<TValue> = {
	read: () => TValue | null
	has: () => boolean
	write: (value: TValue) => void
	resetMemory: () => void
}

function toLogLabel(cacheLabel: string): string {
	return cacheLabel.toLowerCase()
}

export function createJsonFileCacheStore<TValue>(
	options: JsonFileCacheStoreOptions<TValue>,
): JsonFileCacheStore<TValue> {
	let memoryValue: TValue | null | undefined

	function getCacheFilePath(): string {
		return join(options.getCacheDir(), options.filename)
	}

	function ensureCacheDir(): void {
		const cacheDir = options.getCacheDir()
		if (!existsSync(cacheDir)) {
			mkdirSync(cacheDir, { recursive: true })
		}
	}

	function read(): TValue | null {
		if (memoryValue !== undefined) {
			return memoryValue
		}

		const cacheFile = getCacheFilePath()
		if (!existsSync(cacheFile)) {
			memoryValue = null
			log(`[${options.logPrefix}] ${options.cacheLabel} file not found`, { cacheFile })
			return null
		}

		try {
			const content = readFileSync(cacheFile, "utf-8")
			const value = JSON.parse(content) as TValue
			memoryValue = value
			log(`[${options.logPrefix}] Read ${toLogLabel(options.cacheLabel)}`, options.describe(value))
			return value
		} catch (error) {
			memoryValue = null
			log(`[${options.logPrefix}] Error reading ${toLogLabel(options.cacheLabel)}`, {
				error: String(error),
			})
			return null
		}
	}

	function has(): boolean {
		return existsSync(getCacheFilePath())
	}

	function write(value: TValue): void {
		ensureCacheDir()
		const cacheFile = getCacheFilePath()

		try {
			writeFileSync(cacheFile, options.serialize?.(value) ?? JSON.stringify(value, null, 2))
			memoryValue = value
			log(`[${options.logPrefix}] ${options.cacheLabel} written`, options.describe(value))
		} catch (error) {
			log(`[${options.logPrefix}] Error writing ${toLogLabel(options.cacheLabel)}`, {
				error: String(error),
			})
		}
	}

	function resetMemory(): void {
		memoryValue = undefined
	}

	return {
		read,
		has,
		write,
		resetMemory,
	}
}
