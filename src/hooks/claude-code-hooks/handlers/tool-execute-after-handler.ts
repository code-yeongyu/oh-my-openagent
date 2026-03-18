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
import { isHookDisabled } from "../../../shared"

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
				.catch(() => {})
		}

		if (result.warnings && result.warnings.length > 0) {
			output.output = `${output.output}\n\n${result.warnings.join("\n")}`
		}

		if (result.message) {
			output.output = `${output.output}\n\n${result.message}`
		}

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
				.catch(() => {})
		}
	}
}
