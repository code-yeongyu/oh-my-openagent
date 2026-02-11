import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared"
import { subagentSessions } from "../../features/claude-code-session-state"
import type { CallOmoAgentArgs } from "./types"
import type { ToolContextWithMetadata } from "./tool-context-with-metadata"

export async function resolveOrCreateSessionId(
	ctx: PluginInput,
	args: CallOmoAgentArgs,
	toolContext: ToolContextWithMetadata,
): Promise<{ ok: true; sessionID: string } | { ok: false; error: string }> {
	if (args.session_id) {
		log(`[call_omo_agent] Using existing session: ${args.session_id}`)
		const sessionResult = await ctx.client.session.get({
			path: { id: args.session_id },
		})
		if (sessionResult.error) {
			log("[call_omo_agent] Session get error", { error: sessionResult.error })
			return {
				ok: false,
				error: `Error: Failed to get existing session: ${sessionResult.error}`,
			}
		}
		return { ok: true, sessionID: args.session_id }
	}

	log(`[call_omo_agent] Creating new session with parent: ${toolContext.sessionID}`)
	const parentSession = await ctx.client.session
		.get({ path: { id: toolContext.sessionID } })
		.catch((err) => {
			log("[call_omo_agent] Failed to get parent session", { error: String(err) })
			return null
		})
	const parentDirectory = parentSession?.data?.directory ?? ctx.directory

	const body = {
		parentID: toolContext.sessionID,
		title: `${args.description} (@${args.subagent_type} subagent)`,
	}

	const createResult = await ctx.client.session.create({
		body,
		query: { directory: parentDirectory },
	})

	if (createResult.error) {
		log("[call_omo_agent] Session create error", { error: createResult.error })
		const errorStr = String(createResult.error)
		if (errorStr.toLowerCase().includes("unauthorized")) {
			return {
				ok: false,
				error: `Error: Failed to create session (Unauthorized). This may be due to:
1. OAuth token restrictions (e.g., Claude Code credentials are restricted to Claude Code only)
2. Provider authentication issues
3. Session permission inheritance problems

Try using a different provider or API key authentication.

Original error: ${createResult.error}`,
			}
		}
		return { ok: false, error: `Error: Failed to create session: ${createResult.error}` }
	}

	const sessionID = createResult.data.id
	log(`[call_omo_agent] Created session: ${sessionID}`)
	subagentSessions.add(sessionID)
	return { ok: true, sessionID }
}
