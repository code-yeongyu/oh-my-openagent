import { existsSync } from "fs"

import { findSgCliPathSync, getSgCliPath, setSgCliPath } from "./constants"

let resolvedCliPath: string | null = null
let initPromise: Promise<string | null> | null = null

export async function getAstGrepPath(): Promise<string | null> {
	if (resolvedCliPath !== null && existsSync(resolvedCliPath)) {
		return resolvedCliPath
	}

	if (initPromise) {
		return initPromise
	}

	initPromise = (async () => {
		const syncPath = findSgCliPathSync()
		if (syncPath && existsSync(syncPath)) {
			resolvedCliPath = syncPath
			setSgCliPath(syncPath)
			return syncPath
		}

		return null
	})()

	return initPromise
}

export function startBackgroundInit(): void {
	if (!initPromise) {
		initPromise = getAstGrepPath()
		initPromise.catch(() => {})
	}
}

export function isCliAvailable(): boolean {
	const path = findSgCliPathSync()
	return path !== null && existsSync(path)
}

export async function ensureCliAvailable(): Promise<boolean> {
	const path = await getAstGrepPath()
	return path !== null && existsSync(path)
}

export function getResolvedSgCliPath(): string | null {
	const path = getSgCliPath()
	if (path && existsSync(path)) return path
	return null
}
