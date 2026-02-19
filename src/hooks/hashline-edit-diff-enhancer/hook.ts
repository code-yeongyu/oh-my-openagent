import { log } from "../../shared"
import { toHashlineContent, generateUnifiedDiff, countLineDiffs } from "../../tools/hashline-edit/diff-utils"

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

function isWriteTool(toolName: string): boolean {
	return toolName.toLowerCase() === "write"
}

function extractFilePath(args: Record<string, unknown>): string | undefined {
	const path = args.path ?? args.filePath ?? args.file_path
	return typeof path === "string" ? path : undefined
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
			if (!enabled || !isWriteTool(input.tool)) return

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
			if (!enabled || !isWriteTool(input.tool)) return

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
			const oldHashlined = toHashlineContent(oldContent)
			const newHashlined = toHashlineContent(newContent)

			const unifiedDiff = generateUnifiedDiff(oldContent, newContent, filePath)
			
			output.metadata.filediff = {
				file: filePath,
				path: filePath,
				before: oldHashlined,
				after: newHashlined,
				additions,
				deletions,
			}
			
			// TUI reads metadata.diff (unified diff string), not filediff object
			output.metadata.diff = unifiedDiff

			output.title = filePath
		},
	}
}
