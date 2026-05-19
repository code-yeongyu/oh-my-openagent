import type { PluginInput } from "@opencode-ai/plugin"
import type { ContextCollector } from "../../../features/context-injector"
import { clearClaudeHooksConfigCache, loadClaudeHooksConfig } from "../config"
import { clearPluginExtendedConfigCache, loadPluginExtendedConfig } from "../config-loader"
import { executeStopHooks, type StopContext } from "../stop"
import { clearTranscriptCache } from "../transcript"
import { clearToolInputCache, stopToolInputCacheCleanup } from "../tool-input-cache"
import type { PluginConfig } from "../types"
import { createInternalAgentTextPart, isHookDisabled, log } from "../../../shared"
import { resolveSessionEventID } from "../../../shared/event-session-id"
import { dispatchInternalPrompt, isInternalPromptDispatchAccepted } from "../../../shared/prompt-async-gate"
import {
	clearAllSessionHookState,
	clearSessionHookState,
	sessionErrorState,
	sessionInterruptState,
} from "../session-hook-state"

export function createSessionEventHandler(
	ctx: PluginInput,
	config: PluginConfig,
	contextCollector?: ContextCollector,
) {
	const parentSessionIdCache = new Map<string, string | undefined>()

	return async (input: { event: { type: string; properties?: unknown } }) => {
		const { event } = input

		if (event.type === "session.error") {
			const props = event.properties as Record<string, unknown> | undefined
			const sessionID = resolveSessionEventID(props)
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
			const sessionID = resolveSessionEventID(props)
			if (sessionID) {
				parentSessionIdCache.delete(sessionID)
				clearTranscriptCache(sessionID)
				clearToolInputCache(sessionID)
				contextCollector?.clear(sessionID)
				clearSessionHookState(sessionID)
			}
			return
		}

		if (event.type !== "session.idle") {
			return
		}

		const props = event.properties as Record<string, unknown> | undefined
		const sessionID = resolveSessionEventID(props)
		if (!sessionID) return

		const claudeConfig = await loadClaudeHooksConfig()
		const extendedConfig = await loadPluginExtendedConfig()

		const errorStateBefore = sessionErrorState.get(sessionID)
		const endedWithErrorBefore = errorStateBefore?.hasError === true
		const interruptStateBefore = sessionInterruptState.get(sessionID)
		const interruptedBefore = interruptStateBefore?.interrupted === true

		let parentSessionId = parentSessionIdCache.get(sessionID)
		if (parentSessionId === undefined && !parentSessionIdCache.has(sessionID)) {
			try {
				const sessionInfo = await ctx.client.session.get({
					path: { id: sessionID },
				})
				parentSessionId = sessionInfo.data?.parentID
				parentSessionIdCache.set(sessionID, parentSessionId)
			} catch {
				parentSessionId = undefined
			}
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
				const promptResult = await dispatchInternalPrompt({
					mode: "sync",
					client: ctx.client,
					sessionID,
					source: "claude-code-stop-hook:inject-prompt",
					queueBehavior: "defer",
					input: {
						path: { id: sessionID },
						body: {
							parts: [createInternalAgentTextPart(stopResult.injectPrompt)],
						},
						query: { directory: ctx.directory },
					},
				})
				if (promptResult.status === "failed") {
					log("Failed to inject prompt from Stop hook", { error: String(promptResult.error) })
				} else if (!isInternalPromptDispatchAccepted(promptResult)) {
					log("Skipped prompt injection from Stop hook", { sessionID, status: promptResult.status })
				}
			} else if (stopResult.block) {
				log("Stop hook returned block", { sessionID, reason: stopResult.reason })
			}
		}

		clearSessionHookState(sessionID)
	}
}

export function disposeSessionEventHandler(contextCollector?: ContextCollector): void {
	clearTranscriptCache()
	clearClaudeHooksConfigCache()
	clearPluginExtendedConfigCache()
	stopToolInputCacheCleanup()
	contextCollector?.clearAll()
	clearAllSessionHookState()
}
