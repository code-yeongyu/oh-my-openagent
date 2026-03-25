import type { CallOmoAgentArgs } from "./types"
import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared"
import type { FallbackEntry } from "../../shared/model-requirements"
import { getAgentToolRestrictions } from "../../shared"
import { setSessionFallbackChain } from "../../hooks/model-fallback/hook"
import { createOrGetSession } from "./session-creator"
import { waitForCompletion } from "./completion-poller"
import { processMessages } from "./message-processor"
import { getSessionMemoryBankContext } from "../../features/claude-code-session-state"

type SessionWithPromptAsync = {
  promptAsync: (opts: { path: { id: string }; body: Record<string, unknown> }) => Promise<unknown>
}

type ExecuteSyncDeps = {
  createOrGetSession: typeof createOrGetSession
  waitForCompletion: typeof waitForCompletion
  processMessages: typeof processMessages
  setSessionFallbackChain: typeof setSessionFallbackChain
}

const defaultDeps: ExecuteSyncDeps = {
  createOrGetSession,
  waitForCompletion,
  processMessages,
  setSessionFallbackChain,
}

export async function executeSync(
  args: CallOmoAgentArgs,
  toolContext: {
    sessionID: string
    messageID: string
    agent: string
    abort: AbortSignal
    metadata?: (input: { title?: string; metadata?: Record<string, unknown> }) => void
  },
  ctx: PluginInput,
  deps: ExecuteSyncDeps = defaultDeps,
  fallbackChain?: FallbackEntry[],
): Promise<string> {
  const { sessionID } = await deps.createOrGetSession(args, toolContext, ctx)

  if (fallbackChain && fallbackChain.length > 0) {
    deps.setSessionFallbackChain(sessionID, fallbackChain)
  }

  await toolContext.metadata?.({
    title: args.description,
    metadata: { sessionId: sessionID },
  })

  log(`[call_omo_agent] Sending prompt to session ${sessionID}`)
  log(`[call_omo_agent] Prompt text:`, args.prompt.substring(0, 100))

  const memoryBankContext = getSessionMemoryBankContext(toolContext.sessionID)
  const enhancedPrompt = memoryBankContext
    ? `<MemoryBankContext>\n${memoryBankContext}\n</MemoryBankContext>\n\n${args.prompt}`
    : args.prompt

  if (memoryBankContext) {
    log(`[call_omo_agent] Injected memory-bank context from parent session`, {
      parentSessionID: toolContext.sessionID,
      subagentSessionID: sessionID,
      contextLength: memoryBankContext.length,
    })
  }

  try {
    await (ctx.client.session as unknown as SessionWithPromptAsync).promptAsync({
      path: { id: sessionID },
      body: {
        agent: args.subagent_type,
        tools: {
          ...getAgentToolRestrictions(args.subagent_type),
          task: false,
          question: false,
        },
        parts: [{ type: "text", text: enhancedPrompt }],
      },
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log(`[call_omo_agent] Prompt error:`, errorMessage)
    if (errorMessage.includes("agent.name") || errorMessage.includes("undefined")) {
      return `Error: Agent "${args.subagent_type}" not found. Make sure the agent is registered in your opencode.json or provided by a plugin.\n\n<task_metadata>\nsession_id: ${sessionID}\n</task_metadata>`
    }
    return `Error: Failed to send prompt: ${errorMessage}\n\n<task_metadata>\nsession_id: ${sessionID}\n</task_metadata>`
  }

  await deps.waitForCompletion(sessionID, toolContext, ctx)

  const responseText = await deps.processMessages(sessionID, ctx)

  const output =
    responseText + "\n\n" + ["<task_metadata>", `session_id: ${sessionID}`, "</task_metadata>"].join("\n")

  return output
}
