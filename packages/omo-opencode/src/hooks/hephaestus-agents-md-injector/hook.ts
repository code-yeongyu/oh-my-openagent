import { promises as fsPromises } from "node:fs"
import { createAgentsMdCache, findAgentsMdUp } from "@oh-my-opencode/rules-engine"
import type { AgentsMdCache } from "@oh-my-opencode/rules-engine"
import type { PluginInput } from "@opencode-ai/plugin"
import { formatAgentsMdContextBlock } from "@oh-my-opencode/agents-md-core"
import { createDynamicTruncator } from "../../shared/dynamic-truncator"
import type { ContextLimitModelCacheState } from "../../shared/context-limit-resolver"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { resolveSessionEventID } from "../../shared/event-session-id"
import { isRealUserTextPart } from "../../shared"

type ChatMessageInput = {
  readonly sessionID: string
  readonly agent?: string
}

type OutputPart = {
  readonly type: string
  text?: string
  readonly [key: string]: unknown
}

type ChatMessageOutput = {
  readonly message: Record<string, unknown>
  readonly parts: OutputPart[]
}

type EventInput = {
  readonly event: {
    readonly type: string
    readonly properties?: unknown
  }
}

type AgentsMdTruncator = {
  readonly truncate: (
    sessionID: string,
    output: string,
  ) => Promise<{ readonly result: string; readonly truncated: boolean }>
}

type HephaestusAgentsMdInjectorOptions = {
  readonly agentsMdCache?: AgentsMdCache
  readonly truncator?: AgentsMdTruncator
}

function getEffectiveAgent(input: ChatMessageInput, output: ChatMessageOutput): string {
  const outputAgent = output.message.agent
  if (typeof outputAgent === "string") return outputAgent
  return input.agent ?? ""
}

export function createHephaestusAgentsMdInjectorHook(
  ctx: PluginInput,
  modelCacheState?: ContextLimitModelCacheState,
  options?: HephaestusAgentsMdInjectorOptions,
) {
  const injectedSessions = new Set<string>()
  const agentsMdCache = options?.agentsMdCache ?? createAgentsMdCache()
  const truncator = options?.truncator ?? createDynamicTruncator(ctx, modelCacheState)

  async function chatMessage(
    input: ChatMessageInput,
    output: ChatMessageOutput,
  ): Promise<void> {
    if (injectedSessions.has(input.sessionID)) return
    if (getAgentConfigKey(getEffectiveAgent(input, output)) !== "hephaestus") return

    const textPart = output.parts.find(isRealUserTextPart)
    if (!textPart) return

    const agentsPaths = await findAgentsMdUp({
      startDir: ctx.directory,
      rootDir: ctx.directory,
      skipRoot: false,
      cache: agentsMdCache,
    })
    if (agentsPaths.length === 0) return

    const contextBlocks: string[] = []
    for (const agentsPath of agentsPaths) {
      const content = await fsPromises.readFile(agentsPath, "utf-8")
      const { result, truncated } = await truncator.truncate(input.sessionID, content)
      contextBlocks.push(formatAgentsMdContextBlock({
        agentsPath,
        content: result,
        truncated,
      }))
    }

    textPart.text = `${contextBlocks.join("")}\n\n---\n\n${textPart.text ?? ""}`
    injectedSessions.add(input.sessionID)
  }

  function clearSession(sessionID: string): void {
    injectedSessions.delete(sessionID)
    agentsMdCache.clear()
  }

  async function eventHandler({ event }: EventInput): Promise<void> {
    if (event.type !== "session.deleted" && event.type !== "session.compacted") {
      return
    }

    const sessionID = resolveSessionEventID(event.properties)
    if (sessionID) clearSession(sessionID)
  }

  return {
    "chat.message": chatMessage,
    event: eventHandler,
  }
}
