import type { PluginInput } from "@opencode-ai/plugin"
import { loadClaudeHooksConfig } from "../config"
import { loadPluginExtendedConfig } from "../config-loader"
import { executePreCompactHooks, type PreCompactContext } from "../pre-compact"
import type { PluginConfig } from "../types"
import { isHookDisabled, log } from "../../../shared"

export function createPreCompactHandler(ctx: PluginInput, config: PluginConfig) {
	return async (
		input: { sessionID: string },
		output: { context: string[] },
	): Promise<void> => {
		if (isHookDisabled(config, "PreCompact")) {
			return
		}

		const claudeConfig = await loadClaudeHooksConfig()
		const extendedConfig = await loadPluginExtendedConfig()

		const preCompactCtx: PreCompactContext = {
			sessionId: input.sessionID,
			cwd: ctx.directory,
		}

		const result = await executePreCompactHooks(
			preCompactCtx,
			claudeConfig,
			extendedConfig,
		)

		if (result.context.length > 0) {
			log("PreCompact hooks injecting context", {
				sessionID: input.sessionID,
				contextCount: result.context.length,
				hookName: result.hookName,
				elapsedMs: result.elapsedMs,
			})
			output.context.push(...result.context)
		}
	}
}
