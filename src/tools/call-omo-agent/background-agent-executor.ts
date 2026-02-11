import type { BackgroundManager } from "../../features/background-agent"
import { findFirstMessageWithAgent, findNearestMessageWithFields } from "../../features/hook-message-injector"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { log } from "../../shared"
import type { CallOmoAgentArgs } from "./types"
import type { ToolContextWithMetadata } from "./tool-context-with-metadata"
import { getMessageDir } from "./message-storage-directory"

export async function executeBackgroundAgent(
	args: CallOmoAgentArgs,
	toolContext: ToolContextWithMetadata,
	manager: BackgroundManager,
): Promise<string> {
	try {
		const messageDir = getMessageDir(toolContext.sessionID)
		const prevMessage = messageDir ? findNearestMessageWithFields(messageDir) : null
		const firstMessageAgent = messageDir ? findFirstMessageWithAgent(messageDir) : null
		const sessionAgent = getSessionAgent(toolContext.sessionID)
		const parentAgent =
			toolContext.agent ?? sessionAgent ?? firstMessageAgent ?? prevMessage?.agent

		log("[call_omo_agent] parentAgent resolution", {
			sessionID: toolContext.sessionID,
			messageDir,
			ctxAgent: toolContext.agent,
			sessionAgent,
			firstMessageAgent,
			prevMessageAgent: prevMessage?.agent,
			resolvedParentAgent: parentAgent,
		})

		const task = await manager.launch({
			description: args.description,
			prompt: args.prompt,
			agent: args.subagent_type,
			parentSessionID: toolContext.sessionID,
			parentMessageID: toolContext.messageID,
			parentAgent,
		})

		const waitStart = Date.now()
		const waitTimeoutMs = 30_000
		const waitIntervalMs = 50

		let sessionId = task.sessionID
		while (!sessionId && Date.now() - waitStart < waitTimeoutMs) {
			if (toolContext.abort?.aborted) {
				return `Task aborted while waiting for session to start.\n\nTask ID: ${task.id}`
			}
			const updated = manager.getTask(task.id)
			if (updated?.status === "error" || updated?.status === "cancelled" || updated?.status === "interrupt") {
				return `Task failed to start (status: ${updated.status}).\n\nTask ID: ${task.id}`
			}
			await new Promise<void>((resolve) => {
				setTimeout(resolve, waitIntervalMs)
			})
			sessionId = manager.getTask(task.id)?.sessionID
		}

		await toolContext.metadata?.({
			title: args.description,
			metadata: { sessionId: sessionId ?? "pending" },
		})

		return `Background agent task launched successfully.

Task ID: ${task.id}
Session ID: ${sessionId ?? "pending"}
Description: ${task.description}
Agent: ${task.agent} (subagent)
Status: ${task.status}

The system will notify you when the task completes.
Use \`background_output\` tool with task_id="${task.id}" to check progress:
- block=false (default): Check status immediately - returns full status info
- block=true: Wait for completion (rarely needed since system notifies)`
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		return `Failed to launch background agent task: ${message}`
	}
}
