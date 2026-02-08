import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared"
import { extractNewSessionOutput, type SessionMessage } from "./session-message-output-extractor"
import { waitForSessionCompletion } from "./session-completion-poller"
import { resolveOrCreateSessionId } from "./subagent-session-creator"
import { promptSubagentSession } from "./subagent-session-prompter"
import type { CallOmoAgentArgs } from "./types"
import type { ToolContextWithMetadata } from "./tool-context-with-metadata"

function buildTaskMetadata(sessionID: string): string {
	return ["<task_metadata>", `session_id: ${sessionID}`, "</task_metadata>"].join(
		"\n",
	)
}

function getMessagesArray(result: unknown): SessionMessage[] {
	if (Array.isArray(result)) return result as SessionMessage[]
	if (typeof result !== "object" || result === null) return []
	if (!("data" in result)) return []
	const data = (result as { data?: unknown }).data
	return Array.isArray(data) ? (data as SessionMessage[]) : []
}

export async function executeSyncAgent(
	args: CallOmoAgentArgs,
	toolContext: ToolContextWithMetadata,
	ctx: PluginInput,
): Promise<string> {
	const sessionResult = await resolveOrCreateSessionId(ctx, args, toolContext)
	if (!sessionResult.ok) {
		return sessionResult.error
	}
	const sessionID = sessionResult.sessionID

	await toolContext.metadata?.({
		title: args.description,
		metadata: { sessionId: sessionID },
	})

	log(`[call_omo_agent] Sending prompt to session ${sessionID}`)
	log("[call_omo_agent] Prompt preview", { preview: args.prompt.substring(0, 100) })

	const promptResult = await promptSubagentSession(ctx, {
		sessionID,
		agent: args.subagent_type,
		prompt: args.prompt,
	})
	if (!promptResult.ok) {
		const errorMessage = promptResult.error
		if (errorMessage.includes("agent.name") || errorMessage.includes("undefined")) {
			return `Error: Agent "${args.subagent_type}" not found. Make sure the agent is registered in your opencode.json or provided by a plugin.\n\n${buildTaskMetadata(sessionID)}`
		}
		return `Error: Failed to send prompt: ${errorMessage}\n\n${buildTaskMetadata(sessionID)}`
	}

	log("[call_omo_agent] Prompt sent, polling for completion...")
	const completion = await waitForSessionCompletion(ctx, {
		sessionID,
		abortSignal: toolContext.abort,
		maxPollTimeMs: 5 * 60 * 1000,
		pollIntervalMs: 500,
		stabilityRequired: 3,
	})
	if (!completion.ok) {
		if (completion.reason === "aborted") {
			return `Task aborted.\n\n${buildTaskMetadata(sessionID)}`
		}
		return `Error: Agent task timed out after 5 minutes.\n\n${buildTaskMetadata(sessionID)}`
	}

	const messagesResult = await ctx.client.session.messages({
		path: { id: sessionID },
	})
	if (messagesResult.error) {
		log("[call_omo_agent] Messages error", { error: messagesResult.error })
		return `Error: Failed to get messages: ${messagesResult.error}`
	}

	const messages = getMessagesArray(messagesResult)
	log("[call_omo_agent] Got messages", { count: messages.length })

	const extracted = extractNewSessionOutput(sessionID, messages)
	if (!extracted.hasNewOutput) {
		return `No new output since last check.\n\n${buildTaskMetadata(sessionID)}`
	}

	log("[call_omo_agent] Got response", { length: extracted.output.length })
	return `${extracted.output}\n\n${buildTaskMetadata(sessionID)}`
}
