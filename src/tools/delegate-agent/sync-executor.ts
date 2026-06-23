import type { PluginInput } from "@opencode-ai/plugin"
import { getAgentToolRestrictions, log } from "../../shared"
import { waitForCompletion } from "./completion-poller"
import { processMessages } from "./message-processor"
import { createOrGetSession } from "./session-creator"
import type { DelegateAgentArgs } from "./types"

type ExecuteSyncDeps = {
  createOrGetSession: typeof createOrGetSession
  waitForCompletion: typeof waitForCompletion
  processMessages: typeof processMessages
}

const defaultDeps: ExecuteSyncDeps = {
  createOrGetSession,
  waitForCompletion,
  processMessages,
}

export async function executeSync(
  args: DelegateAgentArgs,
  toolContext: {
    sessionID: string
    messageID: string
    agent: string
    abort: AbortSignal
    metadata?: (input: { title?: string; metadata?: Record<string, unknown> }) => void
  },
  ctx: PluginInput,
  deps: ExecuteSyncDeps = defaultDeps
): Promise<string> {
  const { sessionID } = await deps.createOrGetSession(args, toolContext, ctx)

  await toolContext.metadata?.({
    title: args.description,
    metadata: { sessionId: sessionID },
  })

  log(`[delegate_agent] Sending prompt to session ${sessionID}`)
  log(`[delegate_agent] Prompt text:`, args.prompt.substring(0, 100))

  try {
    await ctx.client.session.promptAsync({
      path: { id: sessionID },
      body: {
        agent: args.subagent_type,
        tools: {
          ...getAgentToolRestrictions(args.subagent_type),
          task: false,
          question: false,
        },
        parts: [{ type: "text", text: args.prompt }],
      },
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log(`[delegate_agent] Prompt error:`, errorMessage)
    if (errorMessage.includes("agent.name") || errorMessage.includes("undefined")) {
      return `Error: Agent "${args.subagent_type}" not found. Make sure the agent is registered in your opencode.json or provided by a plugin.\n\n<task_metadata>\nsession_id: ${sessionID}\n</task_metadata>`
    }
    return `Error: Failed to send prompt: ${errorMessage}\n\n<task_metadata>\nsession_id: ${sessionID}\n</task_metadata>`
  }

  await deps.waitForCompletion(sessionID, toolContext, ctx)

  const responseText = await deps.processMessages(sessionID, ctx)

  const output =
    `${responseText}\n\n${["<task_metadata>", `session_id: ${sessionID}`, "</task_metadata>"].join("\n")}`

  return output
}
