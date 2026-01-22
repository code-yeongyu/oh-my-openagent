import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared"
import { HOOK_NAME, VALID_TRANSITIONS, PHASE_SKIP_WARNING, type Phase } from "./constants"

export * from "./constants"

/**
 * Creates the Phase Flow Enforcer hook.
 *
 * This hook monitors boulder state updates and warns when the agent
 * attempts to skip phases in the workflow. It enforces the correct
 * progression: idle → planning → reviewing → executing → awaiting_user → completed
 */
export function createPhaseFlowEnforcerHook(ctx: PluginInput) {
  let lastKnownPhase: Phase = "idle"

  return {
    "tool.execute.after": async (
      input: {
        sessionID: string
        tool: string
        args: Record<string, unknown>
      },
      output: {
        result: unknown
        output: string
      }
    ): Promise<void> => {
      const { sessionID, tool } = input

      // Only monitor tools that might change phase
      // We check after Write/Edit to .sisyphus/boulder.json
      if (tool !== "Write" && tool !== "Edit") {
        return
      }

      const filePath = input.args.filePath as string | undefined
      if (!filePath?.includes("boulder.json")) {
        return
      }

      // Try to detect phase change from the output or content
      try {
        const resultStr = typeof output.result === "string" 
          ? output.result 
          : JSON.stringify(output.result)
        
        // Extract phase from content if visible
        const phaseMatch = /"phase"\s*:\s*"(\w+)"/.exec(resultStr)
        if (!phaseMatch) {
          return
        }

        const newPhase = phaseMatch[1] as Phase
        
        // Check if transition is valid
        const validNextPhases = VALID_TRANSITIONS[lastKnownPhase]
        if (validNextPhases && !validNextPhases.includes(newPhase)) {
          log(`[${HOOK_NAME}] Invalid phase transition detected`, {
            sessionID,
            from: lastKnownPhase,
            to: newPhase,
          })
          output.output += `\n\n${PHASE_SKIP_WARNING(lastKnownPhase, newPhase)}`
        } else {
          log(`[${HOOK_NAME}] Valid phase transition`, {
            sessionID,
            from: lastKnownPhase,
            to: newPhase,
          })
        }

        lastKnownPhase = newPhase
      } catch (err) {
        log(`[${HOOK_NAME}] Error checking phase transition`, { 
          sessionID, 
          error: String(err) 
        })
      }
    },

    /**
     * Also check on session start by reading existing boulder state
     */
    "session.start": async (
      input: { sessionID: string }
    ): Promise<void> => {
      try {
        const { readBoulderState } = await import("../../features/boulder-state/storage")
        const state = readBoulderState(ctx.directory)
        if (state?.phase) {
          lastKnownPhase = state.phase as Phase
          log(`[${HOOK_NAME}] Restored phase from boulder state`, {
            sessionID: input.sessionID,
            phase: lastKnownPhase,
          })
        }
      } catch {
        // Boulder state doesn't exist yet, start from idle
        lastKnownPhase = "idle"
      }
    },
  }
}
