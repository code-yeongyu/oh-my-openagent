import type { HookDeps } from "./types"
import { normalizeAgentName, resolveAgentForSession } from "./agent-resolver"
import { extractSessionMessages } from "./session-messages"

export function createAgentContextResolver(deps: HookDeps) {
  const { ctx } = deps

  return async (
    sessionID: string,
    eventAgent?: string,
  ): Promise<string | undefined> => {
    const resolved = resolveAgentForSession(sessionID, eventAgent)
    if (resolved) return resolved

    try {
      const messagesResp = await ctx.client.session.messages({
        path: { id: sessionID },
        query: { directory: ctx.directory },
      })
      const msgs = extractSessionMessages(messagesResp)
      if (!msgs || msgs.length === 0) return undefined

      for (let i = msgs.length - 1; i >= 0; i--) {
        const info = msgs[i]?.info
        const infoAgent = typeof info?.agent === "string" ? info.agent : undefined
        const normalized = normalizeAgentName(infoAgent)
        if (normalized) {
          return normalized
        }
      }
    } catch (error) {
      if (error instanceof Error) return undefined
      return undefined
    }

    return undefined
  }
}
