import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { ensureDirectory } from "./ensure-directory"

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
		ensureDirectory(dirname(filePath))
	}

	writeFileSync(filePath, JSON.stringify(data, null, 2))
}
