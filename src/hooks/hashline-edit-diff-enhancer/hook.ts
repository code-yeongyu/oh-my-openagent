import { log } from "../../shared"

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

function isEditTool(toolName: string): boolean {
	return toolName === "edit"
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
			if (!enabled || !isEditTool(input.tool)) return

			const filePath = typeof output.args.path === "string" ? output.args.path : undefined
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
			if (!enabled || !isEditTool(input.tool)) return

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

			output.metadata.filediff = {
				file: filePath,
				path: filePath,
				before: oldContent,
				after: newContent,
				additions,
				deletions,
			}

			output.title = filePath
		},
	}
}
