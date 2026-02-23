import { computeLineHash } from "./hash-computation"
import { createTwoFilesPatch } from "diff"

export function toHashlineContent(content: string): string {
	if (!content) return content
	const lines = content.split("\n")
	const lastLine = lines[lines.length - 1]
	const hasTrailingNewline = lastLine === ""
	const contentLines = hasTrailingNewline ? lines.slice(0, -1) : lines
	const hashlined = contentLines.map((line, i) => {
		const lineNum = i + 1
		const hash = computeLineHash(lineNum, line)
		return `${lineNum}#${hash}:${line}`
	})
	return hasTrailingNewline ? hashlined.join("\n") + "\n" : hashlined.join("\n")
}

export function generateUnifiedDiff(oldContent: string, newContent: string, filePath: string): string {
	const patch = createTwoFilesPatch(filePath, filePath, oldContent, newContent, "", "", { context: 3 })

	// Strip "Index:" and "===..." header lines added by createTwoFilesPatch
	let result = patch
		.replace(/^Index: .*\n/, "")
		.replace(/^===================================================================\n/, "")
		// Strip trailing tabs from --- and +++ lines
		.replace(/^(--- |\+\+\+ ).*\t$/gm, "$1" + filePath)
		// Strip "\ No newline at end of file" markers if present
		.replace(/\\ No newline at end of file\n?/g, "")

	// Handle empty diff (no changes) - return just header
	if (!result.includes("@@")) {
		return `--- ${filePath}\n+++ ${filePath}\n`
	}

	return result
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
