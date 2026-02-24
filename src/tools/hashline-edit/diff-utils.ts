import { createTwoFilesPatch } from "diff"
import { computeLineHash } from "./hash-computation"

export function toHashlineContent(content: string): string {
	if (!content) return content
	const lines = content.split("\n")
	const lastLine = lines[lines.length - 1]
	const hasTrailingNewline = lastLine === ""
	const contentLines = hasTrailingNewline ? lines.slice(0, -1) : lines
	const hashlined = contentLines.map((line, i) => {
		const lineNum = i + 1
		const hash = computeLineHash(lineNum, line)
		return `${lineNum}#${hash}|${line}`
	})
	return hasTrailingNewline ? hashlined.join("\n") + "\n" : hashlined.join("\n")
}

export function generateUnifiedDiff(oldContent: string, newContent: string, filePath: string): string {
	return createTwoFilesPatch(filePath, filePath, oldContent, newContent)
}

export function countLineDiffs(oldContent: string, newContent: string): { additions: number; deletions: number } {
	const oldLines = oldContent.split("\n")
	const newLines = newContent.split("\n")

	const oldSet = new Map<string, number>()
	for (const line of oldLines) {
		oldSet.set(line, (oldSet.get(line) ?? 0) + 1)
	}

	const newSet = new Map<string, number>()
	for (const line of newLines) {
		newSet.set(line, (newSet.get(line) ?? 0) + 1)
	}

	let deletions = 0
	for (const [line, count] of oldSet) {
		const newCount = newSet.get(line) ?? 0
		if (count > newCount) {
			deletions += count - newCount
		}
	}

	let additions = 0
	for (const [line, count] of newSet) {
		const oldCount = oldSet.get(line) ?? 0
		if (count > oldCount) {
			additions += count - oldCount
		}
	}

	return { additions, deletions }
}
