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
	/**
	 * The part of a value that decides whether writeIfChanged rewrites the file.
	 * Lets a store ignore volatile fields such as a generation timestamp.
	 */
	comparable?: (value: TValue) => unknown
}

type JsonFileCacheStore<TValue> = {
	read: () => TValue | null
	has: () => boolean
	write: (value: TValue) => void
	/**
	 * Write only when the content differs from what is already on disk.
	 * Returns true when the file was rewritten, false when the write was
	 * skipped because nothing changed.
	 */
	writeIfChanged: (value: TValue) => boolean
	resetMemory: () => void
}

function toLogLabel(cacheLabel: string): string {
	return cacheLabel.toLowerCase()
}

export function createJsonFileCacheStore<TValue>(
	options: JsonFileCacheStoreOptions<TValue>,
): JsonFileCacheStore<TValue> {
	let memoryValue: TValue | null | undefined
	let writtenInCurrentProcess = false

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
		// First check if we have a valid in-memory cache value
		// This handles sandbox environments where existsSync may fail across contexts
		if (memoryValue !== undefined && memoryValue !== null) {
			return true
		}
		// Check if we've written to this cache in the current process
		// This helps in sandbox environments where filesystem state may not persist across contexts
		if (writtenInCurrentProcess) {
			return true
		}
		// Fall back to filesystem check
		return existsSync(getCacheFilePath())
	}

	function write(value: TValue): void {
		ensureCacheDir()
		const cacheFile = getCacheFilePath()

		try {
			writeFileSync(cacheFile, options.serialize?.(value) ?? JSON.stringify(value, null, 2))
			memoryValue = value
			writtenInCurrentProcess = true
			log(`[${options.logPrefix}] ${options.cacheLabel} written`, options.describe(value))
		} catch (error) {
			log(`[${options.logPrefix}] Error writing ${toLogLabel(options.cacheLabel)}`, {
				error: String(error),
			})
		}
	}

	function writeIfChanged(value: TValue): boolean {
		ensureCacheDir()
		const cacheFile = getCacheFilePath()
		const serialized = options.serialize?.(value) ?? JSON.stringify(value, null, 2)

		try {
			const existing = existsSync(cacheFile) ? readFileSync(cacheFile, "utf-8") : undefined
			const unchanged = existing !== undefined && (
				existing === serialized ||
				(options.comparable !== undefined &&
					JSON.stringify(options.comparable(JSON.parse(existing) as TValue)) ===
						JSON.stringify(options.comparable(value)))
			)
			if (unchanged) {
				memoryValue = value
				writtenInCurrentProcess = true
				log(
					`[${options.logPrefix}] ${options.cacheLabel} unchanged; skipped write`,
					options.describe(value),
				)
				return false
			}
		} catch {
			// A read failure must not block the write below.
		}

		try {
			writeFileSync(cacheFile, serialized)
			memoryValue = value
			writtenInCurrentProcess = true
			log(`[${options.logPrefix}] ${options.cacheLabel} written`, options.describe(value))
			return true
		} catch (error) {
			log(`[${options.logPrefix}] Error writing ${toLogLabel(options.cacheLabel)}`, {
				error: String(error),
			})
			return false
		}
	}

	function resetMemory(): void {
		memoryValue = undefined
		writtenInCurrentProcess = false
	}

	return {
		read,
		has,
		write,
		writeIfChanged,
		resetMemory,
	}
}
