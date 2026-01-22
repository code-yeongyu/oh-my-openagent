import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared"
import { getMainSessionID } from "../../features/claude-code-session-state"
import { updatePhaseStatus, readBoulderState } from "../../features/boulder-state"
import {
  HOOK_NAME,
  PLANNING_FLOW_ORDER,
  PHASE_AGENT_PATTERNS,
  FLOW_WARNINGS,
  PHASE_GUIDANCE,
  type PlanningPhase,
} from "./constants"

export * from "./constants"

/**
 * Detects which planning phase an agent belongs to.
 */
function detectPlanningPhase(agentName: string): PlanningPhase | null {
  for (const phase of PLANNING_FLOW_ORDER) {
    if (PHASE_AGENT_PATTERNS[phase].test(agentName)) {
      return phase
    }
  }
  return null
}

/**
 * Creates the planning flow guide hook.
 *
 * This hook monitors sisyphus_task calls targeting planning agents (Metis, Prometheus, Momus)
 * and provides guidance when the flow order is non-standard. It does NOT block execution,
 * only warns and guides.
 */
export function createPlanningFlowGuideHook(ctx: PluginInput) {
  // Track planning phases per session
  const sessionPlanningState = new Map<
    string,
    {
      phasesCompleted: Set<PlanningPhase>
      lastPhase: PlanningPhase | null
      momusRejected: boolean
    }
  >()

  return {
    "tool.execute.after": async (
      input: {
        sessionID: string
        agent?: string
        tool: string
        args?: Record<string, unknown>
      },
      output: { result?: unknown; output: string }
    ): Promise<void> => {
      // Adapt to new interface - tool name is now input.tool, args is input.args
      const toolName = input.tool
      const toolInput = input.args ?? {}
      // Only monitor sisyphus_task calls
      if (toolName !== "sisyphus_task") {
        return
      }

      // Only track in main session
      const mainSessionID = getMainSessionID()
      if (mainSessionID && input.sessionID !== mainSessionID) {
        return
      }

      const targetAgent = toolInput.subagent_type as string | undefined
      if (!targetAgent) {
        return
      }

      const phase = detectPlanningPhase(targetAgent)
      if (!phase) {
        return
      }

      // Get or create session state
      let state = sessionPlanningState.get(input.sessionID)
      if (!state) {
        state = {
          phasesCompleted: new Set(),
          lastPhase: null,
          momusRejected: false,
        }
        sessionPlanningState.set(input.sessionID, state)
      }

      const messages: Array<{ type: string; text: string }> = []

      // Check for non-standard flow and add warnings
      if (phase === "prometheus" && !state.phasesCompleted.has("metis")) {
        messages.push({
          type: "text",
          text: FLOW_WARNINGS["prometheus-without-metis"],
        })
      }

      if (phase === "momus") {
        if (!state.phasesCompleted.has("prometheus")) {
          messages.push({
            type: "text",
            text: FLOW_WARNINGS["momus-without-prometheus"],
          })
        } else if (!state.phasesCompleted.has("metis")) {
          messages.push({
            type: "text",
            text: FLOW_WARNINGS["momus-without-metis"],
          })
        }
      }

      // Add phase guidance
      messages.push({
        type: "text",
        text: PHASE_GUIDANCE[phase],
      })

      // Update state
      state.phasesCompleted.add(phase)
      state.lastPhase = phase

      // Update boulder PhaseStatus based on detected phase (Task 11)
      try {
        const boulderState = readBoulderState(ctx.directory)
        if (boulderState) {
          if (phase === "metis" || phase === "prometheus") {
            updatePhaseStatus(ctx.directory, "planning")
            log(`[${HOOK_NAME}] PhaseStatus updated to 'planning'`, { sessionID: input.sessionID, phase })
          } else if (phase === "momus") {
            updatePhaseStatus(ctx.directory, "reviewing")
            log(`[${HOOK_NAME}] PhaseStatus updated to 'reviewing'`, { sessionID: input.sessionID, phase })
          }
        }
      } catch (err) {
        log(`[${HOOK_NAME}] Failed to update PhaseStatus`, { sessionID: input.sessionID, error: String(err) })
      }

      // Check for Momus rejection in output
      const resultStr = typeof output.result === "string" ? output.result : JSON.stringify(output.result)
      if (phase === "momus" && /reject|revision\s+required|not\s+approved|needs\s+revision|incomplete|insufficient/i.test(resultStr)) {
        state.momusRejected = true
        messages.push({
          type: "text",
          text: `⚠️ **Momus REJECTED the plan.**

**REQUIRED ACTION**: Return to Prometheus with the rejection feedback.

\`\`\`typescript
sisyphus_task(
  subagent_type="prometheus",
  prompt="""
  REVISION REQUIRED: Momus rejected the previous plan.
  
  FEEDBACK FROM MOMUS:
  [Insert Momus rejection feedback here]
  
  INSTRUCTIONS:
  1. Address each concern raised by Momus
  2. Revise the plan accordingly
  3. Ensure all acceptance criteria are clearer
  4. Re-submit for Momus review after revision
  """
)
\`\`\`

**DO NOT**: 
- Skip the revision and proceed to implementation
- Ignore Momus feedback
- Submit the same plan without changes`,
        })
      }

      // Check for Momus OKAY → transition to executing (Task 12)
      if (phase === "momus" && /\bOKAY\b|approved|plan\s+is\s+ready|looks\s+good/i.test(resultStr)) {
        state.momusRejected = false
        try {
          updatePhaseStatus(ctx.directory, "executing")
          log(`[${HOOK_NAME}] Momus OKAY detected - PhaseStatus updated to 'executing'`, { sessionID: input.sessionID })
          messages.push({
            type: "text",
            text: `✅ **Momus APPROVED the plan.**

**PhaseStatus updated**: reviewing → executing

**Next step**: Run \`/start-work\` to begin execution, or the plan will be picked up automatically.`,
          })
        } catch (err) {
          log(`[${HOOK_NAME}] Failed to update PhaseStatus to executing`, { sessionID: input.sessionID, error: String(err) })
        }
      }

      log(`[${HOOK_NAME}] Planning phase detected`, {
        sessionID: input.sessionID,
        phase,
        phasesCompleted: Array.from(state.phasesCompleted),
        momusRejected: state.momusRejected,
      })

      // Append messages to output instead of returning (tool.execute.after doesn't support return messages)
      if (messages.length > 0) {
        const messageText = messages.map(m => m.text).join("\n\n")
        output.output += `\n\n${messageText}`
      }
    },
  }
}
