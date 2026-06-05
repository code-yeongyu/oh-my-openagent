import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { HOOK_NAME } from "./constants"
import { handleDetectedCompletion } from "./completion-handler"
import {
	detectCompletionInSessionMessages,
	detectCompletionInTranscript,
} from "./completion-promise-detector"
import type { RalphLoopState } from "./types"
import type { RalphLoopEventHandlerOptions } from "./event-handler-types"

async function completionDetectedForState(
	ctx: PluginInput,
	options: RalphLoopEventHandlerOptions,
	sessionID: string,
	state: RalphLoopState,
	verificationSessionID: string | undefined,
): Promise<"transcript_file" | "session_messages_api" | null> {
	const completionSessionID = verificationSessionID ?? sessionID
	const transcriptPath = completionSessionID ? options.getTranscriptPath(completionSessionID) : undefined
	const completionViaTranscript = completionSessionID
		? detectCompletionInTranscript(
			transcriptPath,
			state.completion_promise,
			state.started_at,
		)
		: false
	if (completionViaTranscript) return "transcript_file"

	const completionViaApi = verificationSessionID
		? await detectCompletionInSessionMessages(ctx, {
			sessionID: verificationSessionID,
			promise: state.completion_promise,
			apiTimeoutMs: options.apiTimeoutMs,
			directory: options.directory,
			sinceMessageIndex: undefined,
		})
		: await detectCompletionInSessionMessages(ctx, {
			sessionID,
			promise: state.completion_promise,
			apiTimeoutMs: options.apiTimeoutMs,
			directory: options.directory,
			sinceMessageIndex: state.message_count_at_start,
		})

	return completionViaApi ? "session_messages_api" : null
}

export async function handleCompletionIfDetected(
	ctx: PluginInput,
	options: RalphLoopEventHandlerOptions,
	input: {
		readonly sessionID: string
		readonly state: RalphLoopState
		readonly verificationSessionID: string | undefined
		readonly runtimeErrorRetriedSessions: Map<string, number>
	},
): Promise<boolean> {
	const detectedVia = await completionDetectedForState(
		ctx,
		options,
		input.sessionID,
		input.state,
		input.verificationSessionID,
	)
	if (!detectedVia) return false

	input.runtimeErrorRetriedSessions.delete(input.sessionID)
	log(`[${HOOK_NAME}] Completion detected!`, {
		sessionID: input.sessionID,
		iteration: input.state.iteration,
		promise: input.state.completion_promise,
		detectedVia,
	})
	await handleDetectedCompletion(ctx, {
		sessionID: input.sessionID,
		state: input.state,
		loopState: options.loopState,
		directory: options.directory,
		apiTimeoutMs: options.apiTimeoutMs,
	})
	return true
}
