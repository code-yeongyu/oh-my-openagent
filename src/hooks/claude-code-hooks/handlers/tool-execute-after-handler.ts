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

export function createToolExecuteAfterHandler(ctx: PluginInput, config: PluginConfig) {
	return async (
		input: { tool: string; sessionID: string; callID: string },
		output: { title: string; output: string; metadata: unknown } | undefined,
	): Promise<void> => {
		if (!output) {
			return
		}

		const claudeConfig = await loadClaudeHooksConfig()
		const extendedConfig = await loadPluginExtendedConfig()

		const cachedInput = getToolInput(input.sessionID, input.tool, input.callID) || {}

		const metadata = output.metadata as Record<string, unknown> | undefined
		const hasMetadata =
			metadata && typeof metadata === "object" && Object.keys(metadata).length > 0
		const toolOutput = hasMetadata ? metadata : { output: output.output }

		appendTranscriptEntry(input.sessionID, {
			type: "tool_result",
			timestamp: new Date().toISOString(),
			tool_name: input.tool,
			tool_input: cachedInput,
			tool_output: toolOutput,
		})

		if (isHookDisabled(config, "PostToolUse")) {
			return
		}

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
