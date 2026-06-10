import { extractApplyPatchEdits } from "@oh-my-opencode/comment-checker-core"
import type { CheckerEdit } from "@oh-my-opencode/comment-checker-core"
import { findMatchingHooks } from "../../shared"
import type { ClaudeHooksConfig } from "./types"

export interface ApplyPatchVirtualEdit {
	filePath: string
	ccToolName: "Edit" | "Write"
	isNewFile: boolean
	before: string
	after: string
}

export function isApplyPatchTool(toolName: string): boolean {
	return toolName.trim() === "apply_patch"
}

export function extractVirtualEdits(
	metadata: unknown,
	args?: Record<string, unknown>,
): ApplyPatchVirtualEdit[] {
	const edits = extractApplyPatchEdits(metadata, args)
	if (edits.length === 0) return []

	return edits.map(mapToVirtualEdit)
}

function mapToVirtualEdit(edit: CheckerEdit): ApplyPatchVirtualEdit {
	const isNewFile = edit.before.length === 0
	return {
		filePath: edit.filePath,
		ccToolName: isNewFile ? "Write" : "Edit",
		isNewFile,
		before: edit.before,
		after: edit.after,
	}
}

export function hasDirectApplyPatchMatcher(
	config: ClaudeHooksConfig | null,
	eventType: "PreToolUse" | "PostToolUse",
): boolean {
	if (!config) return false
	return findMatchingHooks(config, eventType, "ApplyPatch").length > 0
}

export function buildVirtualToolInput(edit: ApplyPatchVirtualEdit): Record<string, unknown> {
	if (edit.isNewFile) {
		return {
			file_path: edit.filePath,
			content: edit.after,
		}
	}
	return {
		file_path: edit.filePath,
		old_string: edit.before,
		new_string: edit.after,
	}
}

export function deduplicateByFilePath(edits: ApplyPatchVirtualEdit[]): ApplyPatchVirtualEdit[] {
	const seen = new Set<string>()
	return edits.filter((edit) => {
		const key = `${edit.ccToolName}:${edit.filePath}`
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
}
