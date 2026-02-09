import type { PluginInput } from "@opencode-ai/plugin"
import { loadClaudeHooksConfig } from "../config"
import { loadPluginExtendedConfig } from "../config-loader"
import {
	executePreToolUseHooks,
	type PreToolUseContext,
} from "../pre-tool-use"
import { appendTranscriptEntry } from "../transcript"
import { cacheToolInput } from "../tool-input-cache"
import type { PluginConfig } from "../types"
import { isHookDisabled, log } from "../../../shared"

export function createToolExecuteBeforeHandler(ctx: PluginInput, config: PluginConfig) {
	return async (
		input: { tool: string; sessionID: string; callID: string },
		output: { args: Record<string, unknown> },
	): Promise<void> => {
		if (input.tool.trim() === "todowrite" && typeof output.args.todos === "string") {
			let parsed: unknown
			try {
				parsed = JSON.parse(output.args.todos)
			} catch {
				throw new Error(
					`[todowrite ERROR] Failed to parse todos string as JSON. ` +
						`Received: ${
							output.args.todos.length > 100
								? output.args.todos.slice(0, 100) + "..."
								: output.args.todos
						} ` +
						`Expected: Valid JSON array. Pass todos as an array, not a string.`,
				)
			}

			if (!Array.isArray(parsed)) {
				throw new Error(
					`[todowrite ERROR] Parsed JSON is not an array. ` +
						`Received type: ${typeof parsed}. ` +
						`Expected: Array of todo objects. Pass todos as [{id, content, status, priority}, ...].`,
				)
			}

			output.args.todos = parsed
			log("todowrite: parsed todos string to array", { sessionID: input.sessionID })
		}

		const claudeConfig = await loadClaudeHooksConfig()
		const extendedConfig = await loadPluginExtendedConfig()

		appendTranscriptEntry(input.sessionID, {
			type: "tool_use",
			timestamp: new Date().toISOString(),
			tool_name: input.tool,
			tool_input: output.args,
		})

		cacheToolInput(input.sessionID, input.tool, input.callID, output.args)

		if (isHookDisabled(config, "PreToolUse")) {
			return
		}

		const preCtx: PreToolUseContext = {
			sessionId: input.sessionID,
			toolName: input.tool,
			toolInput: output.args,
			cwd: ctx.directory,
			toolUseId: input.callID,
		}

		const result = await executePreToolUseHooks(preCtx, claudeConfig, extendedConfig)

		if (result.decision === "deny") {
			ctx.client.tui
				.showToast({
					body: {
						title: "PreToolUse Hook Executed",
						message: `[BLOCKED] ${result.toolName ?? input.tool} ${
							result.hookName ?? "hook"
						}: ${result.elapsedMs ?? 0}ms\n${result.inputLines ?? ""}`,
						variant: "error" as const,
						duration: 4000,
					},
				})
				.catch(() => {})
			throw new Error(result.reason ?? "Hook blocked the operation")
		}

		if (result.modifiedInput) {
			Object.assign(output.args, result.modifiedInput)
		}
	}
}
