export const HOOK_NAME = "plan-exit-subagent-guard"

/**
 * OpenCode native plan-mode lifecycle tools. Inside a delegated subagent
 * session these strand the parent agent: plan_exit shows the primary-TUI
 * handoff prompt ("switch to build and implement?") inside the subagent, and
 * a No/Esc answer throws RejectedError without returning the plan to the
 * parent (#5850).
 */
export const NATIVE_PLAN_TOOLS: readonly string[] = ["plan_enter", "plan_exit"]

export function buildPlanToolDenialMessage(toolName: string): string {
  return (
    `[${HOOK_NAME}] ${toolName} is unavailable inside a delegated subagent session. ` +
    `The native plan handoff only exists in the primary session; running it here strands the parent agent waiting on this subagent. ` +
    `Do not retry. End your turn now and return the complete plan as your final message so the parent agent receives it.`
  )
}
