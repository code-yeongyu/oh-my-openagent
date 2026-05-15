import type { PluginInput } from "@opencode-ai/plugin"
import type { RalphLoopOptions, RalphLoopState } from "./types"
import { getTranscriptPath as getDefaultTranscriptPath } from "../claude-code-hooks/transcript"
import { releasePromptAsyncReservation } from "../shared/prompt-async-gate"
import { createLoopStateController } from "./loop-state-controller"
import { createRalphLoopEventHandler } from "./ralph-loop-event-handler"

export interface RalphLoopHook {
  event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
  startLoop: (
    sessionID: string,
    prompt: string,
    options?: {
      maxIterations?: number
      completionPromise?: string
      messageCountAtStart?: number
      ultrawork?: boolean
      strategy?: "reset" | "continue"
    }
  ) => boolean
  cancelLoop: (sessionID: string) => boolean
  getState: () => RalphLoopState | null
}

const DEFAULT_API_TIMEOUT = 5000 as const
const DEFAULT_IDLE_SETTLE_MS = 150 as const

function getMessageCountFromResponse(messagesResponse: unknown): number {
  if (Array.isArray(messagesResponse)) {
    return messagesResponse.length
  }

  if (typeof messagesResponse === "object" && messagesResponse !== null && "data" in messagesResponse) {
    const data = (messagesResponse as { data?: unknown }).data
    return Array.isArray(data) ? data.length : 0
  }

  return 0
}

export function createRalphLoopHook(
  ctx: PluginInput,
  options?: RalphLoopOptions
): RalphLoopHook {
  const config = options?.config
  const stateDir = config?.state_dir
  const getTranscriptPath = options?.getTranscriptPath ?? getDefaultTranscriptPath
  const apiTimeout = options?.apiTimeout ?? DEFAULT_API_TIMEOUT
  const idleSettleMs = options?.idleSettleMs ?? DEFAULT_IDLE_SETTLE_MS
  const checkSessionExists = options?.checkSessionExists
  const backgroundManager = options?.backgroundManager

	const loopState = createLoopStateController({
		directory: ctx.directory,
		stateDir,
		config,
	})

	const event = createRalphLoopEventHandler(ctx, {
		directory: ctx.directory,
		apiTimeoutMs: apiTimeout,
		idleSettleMs,
		getTranscriptPath,
		checkSessionExists,
		backgroundManager,
		loopState,
	})

	return {
		event,
		startLoop: (sessionID, prompt, loopOptions): boolean => {
			const startSuccess = loopState.startLoop(sessionID, prompt, loopOptions)
			if (startSuccess) {
				releasePromptAsyncReservation(sessionID, "ralph-loop:start-loop")
			}
			if (!startSuccess || typeof loopOptions?.messageCountAtStart === "number") {
				return startSuccess
			}

			const startedState = loopState.getState()
			const expectedStartedAt = startedState?.session_id === sessionID
				? startedState.started_at
				: undefined

			ctx.client.session
				.messages({
					path: { id: sessionID },
					query: { directory: ctx.directory },
				})
				.then((messagesResponse: unknown) => {
					const messageCountAtStart = getMessageCountFromResponse(messagesResponse)
					loopState.setMessageCountAtStart(sessionID, messageCountAtStart, expectedStartedAt)
				})
				.catch(() => {})

			return startSuccess
		},
		cancelLoop: loopState.cancelLoop,
		getState: loopState.getState as () => RalphLoopState | null,
	}
}
