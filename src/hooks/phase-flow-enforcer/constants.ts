/**
 * Phase Flow Enforcer Hook Constants
 *
 * Enforces the correct phase progression in the Sisyphus workflow.
 * Implements Task 9.3 from SUBAGENTS-COMPARISON.md
 */

export const HOOK_NAME = "phase-flow-enforcer"

/**
 * Valid phase progression order.
 * Each phase can only transition to the next phase or stay in current.
 */
export const PHASE_ORDER = [
  "idle",
  "planning",
  "reviewing",
  "executing",
  "awaiting_user",
  "completed",
  "failed",
] as const

export type Phase = typeof PHASE_ORDER[number]

/**
 * Valid phase transitions.
 * Key = current phase, Value = array of valid next phases
 */
export const VALID_TRANSITIONS: Record<Phase, Phase[]> = {
  idle: ["planning", "idle"],
  planning: ["reviewing", "planning", "idle"], // Can go back to idle if cancelled
  reviewing: ["executing", "planning", "reviewing"], // Can go back to planning if rejected
  executing: ["awaiting_user", "executing", "failed"],
  awaiting_user: ["completed", "executing", "awaiting_user"], // Can resume executing
  completed: ["idle", "completed"], // Can start new work
  failed: ["idle", "planning", "failed"], // Can restart from beginning
}

export const PHASE_SKIP_WARNING = (currentPhase: Phase, attemptedPhase: Phase) => `⚠️ **Phase Flow Violation Detected**

You attempted to transition from **${currentPhase}** to **${attemptedPhase}**.

**Valid transitions from ${currentPhase}:**
${VALID_TRANSITIONS[currentPhase].map(p => `- ${p}`).join("\n")}

**Required Phase Flow:**
\`\`\`
idle → planning → reviewing → executing → awaiting_user → completed
\`\`\`

**Action Required:**
Complete the current phase before proceeding. Do not skip phases.`
