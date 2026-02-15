import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

export function readJsonFile<T>(filePath: string): T | null {
	if (!existsSync(filePath)) {
		return null
	}

	try {
		const content = readFileSync(filePath, "utf-8")
		return JSON.parse(content) as T
	} catch {
		return null
	}
}

export function writeJsonFile<T>(filePath: string, data: T, options?: { ensureDir?: boolean }): void {
	if (options?.ensureDir) {
		mkdirSync(dirname(filePath), { recursive: true })
	}

	writeFileSync(filePath, JSON.stringify(data, null, 2))
}
