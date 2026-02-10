import type { PluginInput } from "@opencode-ai/plugin"
import { loadClaudeHooksConfig } from "../config"
import { loadPluginExtendedConfig } from "../config-loader"
import { executeStopHooks, type StopContext } from "../stop"
import type { PluginConfig } from "../types"
import { isHookDisabled, log } from "../../../shared"
import {
	clearSessionHookState,
	sessionErrorState,
	sessionInterruptState,
} from "../session-hook-state"

export function createSessionEventHandler(ctx: PluginInput, config: PluginConfig) {
	return async (input: { event: { type: string; properties?: unknown } }) => {
		const { event } = input

		if (event.type === "session.error") {
			const props = event.properties as Record<string, unknown> | undefined
			const sessionID = props?.sessionID as string | undefined
			if (sessionID) {
				sessionErrorState.set(sessionID, {
					hasError: true,
					errorMessage: String(props?.error ?? "Unknown error"),
				})
			}
			return
		}

		if (event.type === "session.deleted") {
			const props = event.properties as Record<string, unknown> | undefined
			const sessionInfo = props?.info as { id?: string } | undefined
			if (sessionInfo?.id) {
				clearSessionHookState(sessionInfo.id)
			}
			return
		}

		if (event.type !== "session.idle") {
			return
		}

		const props = event.properties as Record<string, unknown> | undefined
		const sessionID = props?.sessionID as string | undefined
		if (!sessionID) return

		const claudeConfig = await loadClaudeHooksConfig()
		const extendedConfig = await loadPluginExtendedConfig()

		const errorStateBefore = sessionErrorState.get(sessionID)
		const endedWithErrorBefore = errorStateBefore?.hasError === true
		const interruptStateBefore = sessionInterruptState.get(sessionID)
		const interruptedBefore = interruptStateBefore?.interrupted === true

		let parentSessionId: string | undefined
		try {
			const sessionInfo = await ctx.client.session.get({
				path: { id: sessionID },
			})
			parentSessionId = sessionInfo.data?.parentID
		} catch {
			parentSessionId = undefined
		}

		if (!isHookDisabled(config, "Stop")) {
			const stopCtx: StopContext = {
				sessionId: sessionID,
				parentSessionId,
				cwd: ctx.directory,
			}

			const stopResult = await executeStopHooks(stopCtx, claudeConfig, extendedConfig)

			const errorStateAfter = sessionErrorState.get(sessionID)
			const endedWithErrorAfter = errorStateAfter?.hasError === true
			const interruptStateAfter = sessionInterruptState.get(sessionID)
			const interruptedAfter = interruptStateAfter?.interrupted === true

			const shouldBypass =
				endedWithErrorBefore ||
				endedWithErrorAfter ||
				interruptedBefore ||
				interruptedAfter

			if (shouldBypass && stopResult.block) {
				log("Stop hook block ignored", {
					sessionID,
					block: stopResult.block,
					interrupted: interruptedBefore || interruptedAfter,
					endedWithError: endedWithErrorBefore || endedWithErrorAfter,
				})
			} else if (stopResult.block && stopResult.injectPrompt) {
				log("Stop hook returned block with inject_prompt", { sessionID })
				ctx.client.session
					.prompt({
						path: { id: sessionID },
						body: {
							parts: [{ type: "text", text: stopResult.injectPrompt }],
						},
						query: { directory: ctx.directory },
					})
					.catch((err: unknown) =>
						log("Failed to inject prompt from Stop hook", { error: String(err) }),
					)
			} else if (stopResult.block) {
				log("Stop hook returned block", { sessionID, reason: stopResult.reason })
			}
		}

		clearSessionHookState(sessionID)
	}
}
