import type { PluginInput } from "@opencode-ai/plugin"
import { loadClaudeHooksConfig } from "../config"
import { loadPluginExtendedConfig } from "../config-loader"
import {
	executePostToolUseHooks,
	type PostToolUseClient,
	type PostToolUseContext,
} from "../post-tool-use"
import { getToolInput } from "../tool-input-cache"
import { appendTranscriptEntry, getTranscriptPath } from "../transcript"
import type { PluginConfig } from "../types"
import { isHookDisabled, log } from "../../../shared"
import { normalizeHookText, normalizeHookTextList } from "../hook-text"
import {
	isApplyPatchTool,
	extractVirtualEdits,
	hasDirectApplyPatchMatcher,
	buildVirtualToolInput,
	deduplicateByFilePath,
} from "../apply-patch-adapter"

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getStringValue(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key]
	return typeof value === "string" && value.length > 0 ? value : undefined
}

function getNumberValue(record: Record<string, unknown>, key: string): number | undefined {
	const value = record[key]
	return typeof value === "number" ? value : undefined
}

function buildTranscriptToolOutput(outputText: string, metadata: unknown): Record<string, unknown> {
	const compactOutput: Record<string, unknown> = { output: outputText }
	if (!isRecord(metadata)) {
		return compactOutput
	}

	const filePath = getStringValue(metadata, "filePath")
		?? getStringValue(metadata, "path")
		?? getStringValue(metadata, "file")
	if (filePath) {
		compactOutput.filePath = filePath
	}

	const sessionId = getStringValue(metadata, "sessionId")
	if (sessionId) {
		compactOutput.sessionId = sessionId
	}

	const agent = getStringValue(metadata, "agent")
	if (agent) {
		compactOutput.agent = agent
	}

	for (const key of ["noopEdits", "deduplicatedEdits", "firstChangedLine"] as const) {
		const value = getNumberValue(metadata, key)
		if (value !== undefined) {
			compactOutput[key] = value
		}
	}

	const filediff = metadata.filediff
	if (isRecord(filediff)) {
		const additions = getNumberValue(filediff, "additions")
		const deletions = getNumberValue(filediff, "deletions")
		if (additions !== undefined || deletions !== undefined) {
			compactOutput.filediff = {
				...(additions !== undefined ? { additions } : {}),
				...(deletions !== undefined ? { deletions } : {}),
			}
		}
	}

	return compactOutput
}

function appendHookSections(outputText: string, sections: readonly (string | undefined)[]): string {
	const normalizedSections = normalizeHookTextList(sections)
	if (normalizedSections.length === 0) {
		return outputText
	}
	if (outputText.length === 0) {
		return normalizedSections.join("\n\n")
	}
	return [outputText, ...normalizedSections].join("\n\n")
}

export function createToolExecuteAfterHandler(ctx: PluginInput, config: PluginConfig) {
	return async (
		input: { tool: string; sessionID: string; callID: string },
		output: { title: string; output: string; metadata: unknown } | undefined,
	): Promise<void> => {
		if (!output) {
			return
		}


		const cachedInput = getToolInput(input.sessionID, input.tool, input.callID) || {}

		appendTranscriptEntry(input.sessionID, {
			type: "tool_result",
			timestamp: new Date().toISOString(),
			tool_name: input.tool,
			tool_input: cachedInput,
			tool_output: buildTranscriptToolOutput(output.output, output.metadata),
		})

		if (isHookDisabled(config, "PostToolUse")) {
			return
		}

		const claudeConfig = await loadClaudeHooksConfig()
		const extendedConfig = await loadPluginExtendedConfig()

		const postClient: PostToolUseClient = {
			session: {
				messages: (opts) => ctx.client.session.messages(opts),
			},
		}

		const postCtx: PostToolUseContext = {
			sessionId: input.sessionID,
			toolName: input.tool,
			toolInput: cachedInput,
			toolOutput: {
				title: input.tool,
				output: output.output,
				metadata: output.metadata as Record<string, unknown>,
			},
			cwd: ctx.directory,
			transcriptPath: getTranscriptPath(input.sessionID),
			toolUseId: input.callID,
			client: postClient,
			permissionMode: "bypassPermissions",
		}

		const result = await executePostToolUseHooks(postCtx, claudeConfig, extendedConfig)

		if (result.block) {
			ctx.client.tui
				.showToast({
					body: {
						title: "PostToolUse Hook Warning",
						message: result.reason ?? "Hook returned warning",
						variant: "warning",
						duration: 4000,
					},
				})
				.catch((error: unknown) => {
					if (error instanceof Error) {
						log("PostToolUse hook warning toast failed", {
							sessionID: input.sessionID,
							error: error.message,
						})
					} else {
						log("PostToolUse hook warning toast failed", {
							sessionID: input.sessionID,
							error: String(error),
						})
					}
				})
		}

		output.output = appendHookSections(output.output, [
			...(result.warnings ?? []),
			...(normalizeHookText(result.additionalContext) === undefined ? [] : [result.additionalContext]),
			...(result.message === undefined ? [] : [result.message]),
		])

		if (result.hookName) {
			ctx.client.tui
				.showToast({
					body: {
						title: "PostToolUse Hook Executed",
						message: `▶ ${result.toolName ?? input.tool} ${result.hookName}: ${
							result.elapsedMs ?? 0
						}ms`,
						variant: "success",
						duration: 2000,
					},
				})
				.catch((error: unknown) => {
					if (error instanceof Error) {
						log("PostToolUse hook success toast failed", {
							sessionID: input.sessionID,
							error: error.message,
						})
					} else {
						log("PostToolUse hook success toast failed", {
							sessionID: input.sessionID,
							error: String(error),
						})
					}
				})
		}

		// Virtual hook expansion: apply_patch → Edit/Write for CC hook compatibility
		if (
			isApplyPatchTool(input.tool) &&
			!hasDirectApplyPatchMatcher(claudeConfig, "PostToolUse")
		) {
			const virtualEdits = extractVirtualEdits(output.metadata, cachedInput)
			const virtualSections: string[] = []

			for (const edit of deduplicateByFilePath(virtualEdits)) {
				const virtualPostCtx: PostToolUseContext = {
					sessionId: input.sessionID,
					toolName: edit.ccToolName === "Write" ? "write" : "edit",
					toolInput: buildVirtualToolInput(edit),
					toolOutput: {
						title: edit.ccToolName,
						output: output.output,
						metadata: output.metadata as Record<string, unknown>,
					},
					cwd: ctx.directory,
					transcriptPath: getTranscriptPath(input.sessionID),
					toolUseId: input.callID,
					client: postClient,
					permissionMode: "bypassPermissions",
				}

				const virtualResult = await executePostToolUseHooks(virtualPostCtx, claudeConfig, extendedConfig)

				if (virtualResult.block) {
					ctx.client.tui
						.showToast({
							body: {
								title: "PostToolUse Hook Warning",
								message: `[apply_patch→${edit.ccToolName}] ${virtualResult.reason ?? "Hook returned warning"}`,
								variant: "warning",
								duration: 4000,
							},
						})
						.catch((error: unknown) => {
							if (error instanceof Error) {
								log("apply_patch virtual PostToolUse hook toast failed", {
									sessionID: input.sessionID,
									error: error.message,
								})
							} else {
								log("apply_patch virtual PostToolUse hook toast failed", {
									sessionID: input.sessionID,
									error: String(error),
								})
							}
						})
				}

				virtualSections.push(
					...(virtualResult.warnings ?? []),
					...(() => {
						const normalized = normalizeHookText(virtualResult.additionalContext)
						return normalized === undefined ? [] : [normalized]
					})(),
					...(virtualResult.message === undefined ? [] : [virtualResult.message]),
				)

				if (virtualResult.hookName) {
					ctx.client.tui
						.showToast({
							body: {
								title: "PostToolUse Hook Executed",
								message: `▶ ${virtualResult.toolName ?? edit.ccToolName} ${
									virtualResult.hookName
								} (apply_patch→${edit.ccToolName}): ${virtualResult.elapsedMs ?? 0}ms`,
								variant: "success",
								duration: 2000,
							},
						})
						.catch((error: unknown) => {
							if (error instanceof Error) {
								log("apply_patch virtual PostToolUse hook toast failed", {
									sessionID: input.sessionID,
									error: error.message,
								})
							} else {
								log("apply_patch virtual PostToolUse hook toast failed", {
									sessionID: input.sessionID,
									error: String(error),
								})
							}
						})
				}
			}

			output.output = appendHookSections(output.output, virtualSections)
		}
	}
}
