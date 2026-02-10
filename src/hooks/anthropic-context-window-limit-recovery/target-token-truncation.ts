import type { AggressiveTruncateResult } from "./tool-part-types"
import { findToolResultsBySize, truncateToolResult } from "./tool-result-storage"

function calculateTargetBytesToRemove(
	currentTokens: number,
	maxTokens: number,
	targetRatio: number,
	charsPerToken: number
): { tokensToReduce: number; targetBytesToRemove: number } {
	const targetTokens = Math.floor(maxTokens * targetRatio)
	const tokensToReduce = currentTokens - targetTokens
	const targetBytesToRemove = tokensToReduce * charsPerToken
	return { tokensToReduce, targetBytesToRemove }
}

export function truncateUntilTargetTokens(
	sessionID: string,
	currentTokens: number,
	maxTokens: number,
	targetRatio: number = 0.8,
	charsPerToken: number = 4
): AggressiveTruncateResult {
	const { tokensToReduce, targetBytesToRemove } = calculateTargetBytesToRemove(
		currentTokens,
		maxTokens,
		targetRatio,
		charsPerToken
	)

	if (tokensToReduce <= 0) {
		return {
			success: true,
			sufficient: true,
			truncatedCount: 0,
			totalBytesRemoved: 0,
			targetBytesToRemove: 0,
			truncatedTools: [],
		}
	}

	const results = findToolResultsBySize(sessionID)

	if (results.length === 0) {
		return {
			success: false,
			sufficient: false,
			truncatedCount: 0,
			totalBytesRemoved: 0,
			targetBytesToRemove,
			truncatedTools: [],
		}
	}

	let totalRemoved = 0
	let truncatedCount = 0
	const truncatedTools: Array<{ toolName: string; originalSize: number }> = []

	for (const result of results) {
		const truncateResult = truncateToolResult(result.partPath)
		if (truncateResult.success) {
			truncatedCount++
			const removedSize = truncateResult.originalSize ?? result.outputSize
			totalRemoved += removedSize
			truncatedTools.push({
				toolName: truncateResult.toolName ?? result.toolName,
				originalSize: removedSize,
			})

			if (totalRemoved >= targetBytesToRemove) {
				break
			}
		}
	}

	const sufficient = totalRemoved >= targetBytesToRemove

	return {
		success: truncatedCount > 0,
		sufficient,
		truncatedCount,
		totalBytesRemoved: totalRemoved,
		targetBytesToRemove,
		truncatedTools,
	}
}
