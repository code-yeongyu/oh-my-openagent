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
		return `${lineNum}:${hash}|${line}`
	})
	return hasTrailingNewline ? hashlined.join("\n") + "\n" : hashlined.join("\n")
}

export function generateUnifiedDiff(oldContent: string, newContent: string, filePath: string): string {
	const oldLines = oldContent.split("\n")
	const newLines = newContent.split("\n")
	const maxLines = Math.max(oldLines.length, newLines.length)

	let diff = `--- ${filePath}\n+++ ${filePath}\n`
	let inHunk = false
	let oldStart = 1
	let newStart = 1
	let oldCount = 0
	let newCount = 0
	let hunkLines: string[] = []

	for (let i = 0; i < maxLines; i++) {
		const oldLine = oldLines[i] ?? ""
		const newLine = newLines[i] ?? ""

		if (oldLine !== newLine) {
			if (!inHunk) {
				oldStart = i + 1
				newStart = i + 1
				oldCount = 0
				newCount = 0
				hunkLines = []
				inHunk = true
			}

			if (oldLines[i] !== undefined) {
				hunkLines.push(`-${oldLine}`)
				oldCount++
			}
			if (newLines[i] !== undefined) {
				hunkLines.push(`+${newLine}`)
				newCount++
			}
		} else if (inHunk) {
			hunkLines.push(` ${oldLine}`)
			oldCount++
			newCount++

			if (hunkLines.length > 6) {
				diff += `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n`
				diff += hunkLines.join("\n") + "\n"
				inHunk = false
			}
		}
	}

	if (inHunk && hunkLines.length > 0) {
		diff += `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n`
		diff += hunkLines.join("\n") + "\n"
	}

	return diff || `--- ${filePath}\n+++ ${filePath}\n`
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
