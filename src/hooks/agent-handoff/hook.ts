import type { PluginInput } from "@opencode-ai/plugin"
import { consumePendingHandoff } from "../../features/agent-handoff"
import { log } from "../../shared/logger"

const HOOK_NAME = "agent-handoff" as const

export function createAgentHandoffHook(ctx: PluginInput) {
  return {
    event: async (input: { event: { type: string; properties?: Record<string, unknown> } }): Promise<void> => {
      if (input.event.type !== "session.idle") return

      const props = input.event.properties as Record<string, unknown> | undefined
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      const handoff = consumePendingHandoff(sessionID)
      if (!handoff) return

      log(`[${HOOK_NAME}] Executing handoff to ${handoff.agent}`, { sessionID })

      try {
        await ctx.client.session.promptAsync({
          path: { id: sessionID },
          body: {
            agent: handoff.agent,
            parts: [{ type: "text", text: handoff.context }],
          },
          query: { directory: ctx.directory },
        })

        log(`[${HOOK_NAME}] Handoff to ${handoff.agent} complete`, { sessionID })
      } catch (err) {
        log(`[${HOOK_NAME}] Handoff failed`, { sessionID, error: String(err) })
      }
    },
  }
}
