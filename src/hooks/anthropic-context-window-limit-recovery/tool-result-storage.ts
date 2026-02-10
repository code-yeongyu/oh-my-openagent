import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { getMessageIds } from "./message-storage-directory"
import { PART_STORAGE_DIR, TRUNCATION_MESSAGE } from "./storage-paths"
import type { StoredToolPart, ToolResultInfo } from "./tool-part-types"

export function findToolResultsBySize(sessionID: string): ToolResultInfo[] {
	const messageIds = getMessageIds(sessionID)
	const results: ToolResultInfo[] = []

	for (const messageID of messageIds) {
		const partDir = join(PART_STORAGE_DIR, messageID)
		if (!existsSync(partDir)) continue

		for (const file of readdirSync(partDir)) {
			if (!file.endsWith(".json")) continue
			try {
				const partPath = join(partDir, file)
				const content = readFileSync(partPath, "utf-8")
				const part = JSON.parse(content) as StoredToolPart

				if (part.type === "tool" && part.state?.output && !part.truncated) {
					results.push({
						partPath,
						partId: part.id,
						messageID,
						toolName: part.tool,
						outputSize: part.state.output.length,
					})
				}
			} catch {
				continue
			}
		}
	}

	return results.sort((a, b) => b.outputSize - a.outputSize)
}

export function findLargestToolResult(sessionID: string): ToolResultInfo | null {
	const results = findToolResultsBySize(sessionID)
	return results.length > 0 ? results[0] : null
}

export function truncateToolResult(partPath: string): {
	success: boolean
	toolName?: string
	originalSize?: number
} {
	try {
		const content = readFileSync(partPath, "utf-8")
		const part = JSON.parse(content) as StoredToolPart

		if (!part.state?.output) {
			return { success: false }
		}

		const originalSize = part.state.output.length
		const toolName = part.tool

		part.truncated = true
		part.originalSize = originalSize
		part.state.output = TRUNCATION_MESSAGE

		if (!part.state.time) {
			part.state.time = { start: Date.now() }
		}
		part.state.time.compacted = Date.now()

		writeFileSync(partPath, JSON.stringify(part, null, 2))

		return { success: true, toolName, originalSize }
	} catch {
		return { success: false }
	}
}

export function getTotalToolOutputSize(sessionID: string): number {
	const results = findToolResultsBySize(sessionID)
	return results.reduce((sum, result) => sum + result.outputSize, 0)
}

export function countTruncatedResults(sessionID: string): number {
	const messageIds = getMessageIds(sessionID)
	let count = 0

	for (const messageID of messageIds) {
		const partDir = join(PART_STORAGE_DIR, messageID)
		if (!existsSync(partDir)) continue

		for (const file of readdirSync(partDir)) {
			if (!file.endsWith(".json")) continue
			try {
				const content = readFileSync(join(partDir, file), "utf-8")
				const part = JSON.parse(content)
				if (part.truncated === true) {
					count++
				}
			} catch {
				continue
			}
		}
	}

	return count
}
