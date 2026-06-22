import type { PluginInput } from "@opencode-ai/plugin"
import type { OhMyOpenCodeConfig } from "../../config"
import { resolveSessionEventID } from "../../shared/event-session-id"
import { SandboxManager } from "./sandbox-manager"
import { log } from "../../shared/logger"

const sessionVerificationRetries = new Map<string, number>()

export function createSandboxGateHook(ctx: PluginInput, pluginConfig: OhMyOpenCodeConfig) {
  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    if (event.type !== "session.idle") {
      return
    }

    const props = event.properties as Record<string, unknown> | undefined
    const sessionID = resolveSessionEventID(props) || (props?.sessionID as string)
    if (!sessionID) {
      return
    }

    const retries = sessionVerificationRetries.get(sessionID) ?? 0
    if (retries >= 3) {
      log(`[sandbox-gate] Session ${sessionID} reached max self-repair retries (3). Allowing idle state.`)
      sessionVerificationRetries.delete(sessionID)
      return
    }

    const verifyCommand = (pluginConfig as any).sandbox_verify_command || "npm run compile || bun test"
    const manager = new SandboxManager(ctx.directory)

    try {
      const result = await manager.verify(verifyCommand)
      if (!result.success) {
        sessionVerificationRetries.set(sessionID, retries + 1)
        log(`[sandbox-gate] Verification failed for session ${sessionID} (Attempt ${retries + 1}/3). Injecting error stack...`)

        const repairPrompt = `[Verification Gate: FAILED] Compiler or test suite returned errors in the isolated sandbox. Please fix these specific issues:\n\n${result.output}\n\nDo not mark the task as done until these issues are resolved.`
        
        await ctx.client.session.promptAsync({
          path: { id: sessionID },
          body: {
            parts: [{ type: "text", text: repairPrompt }]
          },
          query: { directory: ctx.directory }
        })
      } else {
        log(`[sandbox-gate] Verification succeeded for session ${sessionID}.`)
        sessionVerificationRetries.delete(sessionID)
      }
    } catch (err) {
      log(`[sandbox-gate] Error during verification gate:`, err)
    }
  }

  return {
    event: eventHandler,
  }
}
