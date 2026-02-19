import { log } from "../../shared"
import { computeLineHash } from "../../tools/hashline-edit/hash-computation"

interface HashlineEditDiffEnhancerConfig {
	hashline_edit?: { enabled: boolean }
}

type BeforeInput = { tool: string; sessionID: string; callID: string }
type BeforeOutput = { args: Record<string, unknown> }
type AfterInput = { tool: string; sessionID: string; callID: string }
type AfterOutput = { title: string; output: string; metadata: Record<string, unknown> }

const STALE_TIMEOUT_MS = 5 * 60 * 1000

const pendingCaptures = new Map<string, { content: string; filePath: string; storedAt: number }>()

function makeKey(sessionID: string, callID: string): string {
	return `${sessionID}:${callID}`
}

function cleanupStaleEntries(): void {
	const now = Date.now()
	for (const [key, entry] of pendingCaptures) {
		if (now - entry.storedAt > STALE_TIMEOUT_MS) {
			pendingCaptures.delete(key)
		}
	}
}

function isEditOrWriteTool(toolName: string): boolean {
	const lower = toolName.toLowerCase()
	return lower === "edit" || lower === "write"
}

function extractFilePath(args: Record<string, unknown>): string | undefined {
	const path = args.path ?? args.filePath ?? args.file_path
	return typeof path === "string" ? path : undefined
}

function toHashlineContent(content: string): string {
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

function generateUnifiedDiff(oldContent: string, newContent: string, filePath: string): string {
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
				// Start new hunk
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
			// Context line within hunk
			hunkLines.push(` ${oldLine}`)
			oldCount++
			newCount++
			
			// End hunk if we've seen enough context
			if (hunkLines.length > 6) {
				diff += `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n`
				diff += hunkLines.join("\n") + "\n"
				inHunk = false
			}
		}
	}
	
	// Close remaining hunk
	if (inHunk && hunkLines.length > 0) {
		diff += `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n`
		diff += hunkLines.join("\n") + "\n"
	}
	
	return diff || `--- ${filePath}\n+++ ${filePath}\n`
}

function countLineDiffs(oldContent: string, newContent: string): { additions: number; deletions: number } {
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

async function captureOldContent(filePath: string): Promise<string> {
	try {
		const file = Bun.file(filePath)
		if (await file.exists()) {
			return await file.text()
		}
	} catch {
		log("[hashline-edit-diff-enhancer] failed to read old content", { filePath })
	}
	return ""
}

export function createHashlineEditDiffEnhancerHook(config: HashlineEditDiffEnhancerConfig) {
	const enabled = config.hashline_edit?.enabled ?? false

	return {
		"tool.execute.before": async (input: BeforeInput, output: BeforeOutput) => {
			if (!enabled || !isEditOrWriteTool(input.tool)) return

			const filePath = extractFilePath(output.args)
			if (!filePath) return

			cleanupStaleEntries()
			const oldContent = await captureOldContent(filePath)
			pendingCaptures.set(makeKey(input.sessionID, input.callID), {
				content: oldContent,
				filePath,
				storedAt: Date.now(),
			})
		},

		"tool.execute.after": async (input: AfterInput, output: AfterOutput) => {
			if (!enabled || !isEditOrWriteTool(input.tool)) return

			const key = makeKey(input.sessionID, input.callID)
			const captured = pendingCaptures.get(key)
			if (!captured) return
			pendingCaptures.delete(key)

			const { content: oldContent, filePath } = captured

			let newContent: string
			try {
				newContent = await Bun.file(filePath).text()
			} catch {
				log("[hashline-edit-diff-enhancer] failed to read new content", { filePath })
				return
			}

			const { additions, deletions } = countLineDiffs(oldContent, newContent)

			const unifiedDiff = generateUnifiedDiff(oldContent, newContent, filePath)
			
			output.metadata.filediff = {
				file: filePath,
				path: filePath,
				before: toHashlineContent(oldContent),
				after: toHashlineContent(newContent),
				additions,
				deletions,
			}
			
			// TUI reads metadata.diff (unified diff string), not filediff object
			output.metadata.diff = unifiedDiff

			output.title = filePath
		},
	}
}
