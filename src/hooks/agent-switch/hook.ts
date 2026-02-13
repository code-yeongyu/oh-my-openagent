import type { PluginInput } from "@opencode-ai/plugin"
import { consumePendingSwitch } from "../../features/agent-switch"
import { log } from "../../shared/logger"

const HOOK_NAME = "agent-switch" as const

export function createAgentSwitchHook(ctx: PluginInput) {
  return {
    event: async (input: { event: { type: string; properties?: Record<string, unknown> } }): Promise<void> => {
      if (input.event.type !== "session.idle") return

      const props = input.event.properties as Record<string, unknown> | undefined
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      const pending = consumePendingSwitch(sessionID)
      if (!pending) return

      log(`[${HOOK_NAME}] Switching to ${pending.agent}`, { sessionID })

      try {
        await ctx.client.session.promptAsync({
          path: { id: sessionID },
          body: {
            agent: pending.agent,
            parts: [{ type: "text", text: pending.context }],
          },
          query: { directory: ctx.directory },
        })

        log(`[${HOOK_NAME}] Switch to ${pending.agent} complete`, { sessionID })
      } catch (err) {
        log(`[${HOOK_NAME}] Switch failed`, { sessionID, error: String(err) })
      }
    },
  }
}
