import { log } from "../../shared"
import { bunFile } from "../../shared/bun-file-shim"
import { generateUnifiedDiff, countLineDiffs } from "../../tools/hashline-edit/diff-utils"
import {
	pruneStalePendingCaptures,
	setPendingCapture,
	stopPendingCaptureCleanup,
	takePendingCapture,
} from "./pending-captures"

interface HashlineEditDiffEnhancerConfig {
	hashline_edit?: { enabled: boolean }
}

type BeforeInput = { tool: string; sessionID: string; callID: string }
type BeforeOutput = { args: Record<string, unknown> }
type AfterInput = { tool: string; sessionID: string; callID: string }
type AfterOutput = { title: string; output: string; metadata: Record<string, unknown> }

function isWriteTool(toolName: string): boolean {
	return toolName.toLowerCase() === "write"
}

function extractFilePath(args: Record<string, unknown>): string | undefined {
	const path = args.path ?? args.filePath ?? args.file_path
	return typeof path === "string" ? path : undefined
}

async function captureOldContent(filePath: string): Promise<string> {
	try {
		const file = bunFile(filePath)
		if (await file.exists()) {
			return await file.text()
		}
	} catch (error) {
		if (!(error instanceof Error)) {
			throw error
		}
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

			pruneStalePendingCaptures()
			const oldContent = await captureOldContent(filePath)
			setPendingCapture(input.sessionID, input.callID, {
				content: oldContent,
				filePath,
			})
		},

		"tool.execute.after": async (input: AfterInput, output: AfterOutput) => {
			if (!enabled || !isWriteTool(input.tool)) return

			const captured = takePendingCapture(input.sessionID, input.callID)
			if (!captured) return

			const { content: oldContent, filePath } = captured

			let newContent: string
			try {
				newContent = await bunFile(filePath).text()
			} catch (error) {
				if (!(error instanceof Error)) {
					throw error
				}
				log("[hashline-edit-diff-enhancer] failed to read new content", { filePath })
				return
			}

			const { additions, deletions } = countLineDiffs(oldContent, newContent)
			const unifiedDiff = generateUnifiedDiff(oldContent, newContent, filePath)
			
			output.metadata.filediff = {
				file: filePath,
				path: filePath,
				before: oldContent,
				after: newContent,
				additions,
				deletions,
			}
			
			// TUI reads metadata.diff (unified diff string), not filediff object
			output.metadata.diff = unifiedDiff

			output.title = filePath
		},

		dispose: (): void => {
			stopPendingCaptureCleanup()
		},
	}
}
