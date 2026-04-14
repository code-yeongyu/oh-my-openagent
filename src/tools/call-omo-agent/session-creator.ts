import type { CallOmoAgentArgs } from "./types"
import type { PluginInput } from "@opencode-ai/plugin"
import type { DelegatedModelConfig } from "../../shared/model-resolution-types"
import { subagentSessions, syncSubagentSessions } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"
import { buildSubagentSessionCreateBody } from "../../shared/subagent-context-window"

export async function createOrGetSession(
  args: CallOmoAgentArgs,
  toolContext: {
    sessionID: string
    messageID: string
    agent: string
    abort: AbortSignal
    metadata?: (input: { title?: string; metadata?: Record<string, unknown> }) => void
  },
  ctx: PluginInput,
  model?: DelegatedModelConfig,
): Promise<{ sessionID: string; isNew: boolean }> {
  if (args.session_id) {
    log(`[call_omo_agent] Using existing session: ${args.session_id}`)
    const sessionResult = await ctx.client.session.get({
      path: { id: args.session_id },
    })
    if (sessionResult.error) {
      log(`[call_omo_agent] Session get error:`, sessionResult.error)
      throw new Error(`Failed to get existing session: ${sessionResult.error}`)
    }
    return { sessionID: args.session_id, isNew: false }
  } else {
    log(`[call_omo_agent] Creating new session with parent: ${toolContext.sessionID}`)
    const parentSession = await ctx.client.session.get({
      path: { id: toolContext.sessionID },
    }).catch((err) => {
      log(`[call_omo_agent] Failed to get parent session:`, err)
      return null
    })
    log(`[call_omo_agent] Parent session dir: ${parentSession?.data?.directory}, fallback: ${ctx.directory}`)
    const parentDirectory = parentSession?.data?.directory ?? ctx.directory

    const createResult = await ctx.client.session.create({
      body: buildSubagentSessionCreateBody({
        parentSessionID: toolContext.sessionID,
        title: `${args.description} (@${args.subagent_type} subagent)`,
        model,
      }),
      query: {
        directory: parentDirectory,
      },
    })

    if (createResult.error) {
      log(`[call_omo_agent] Session create error:`, createResult.error)
      const errorStr = String(createResult.error)
      if (errorStr.toLowerCase().includes("unauthorized")) {
        throw new Error(`Failed to create session (Unauthorized). This may be due to:
1. OAuth token restrictions (e.g., Claude Code credentials are restricted to Claude Code only)
2. Provider authentication issues
3. Session permission inheritance problems

Try using a different provider or API key authentication.

Original error: ${createResult.error}`)
      }
      throw new Error(`Failed to create session: ${createResult.error}`)
    }

    const sessionID = createResult.data.id
    log(`[call_omo_agent] Created session: ${sessionID}`)
    subagentSessions.add(sessionID)
    syncSubagentSessions.add(sessionID)
    return { sessionID, isNew: true }
  }
}
