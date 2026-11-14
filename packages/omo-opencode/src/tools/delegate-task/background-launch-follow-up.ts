import type { DelegateTaskArgs } from "./types"

/** How a background launch tells the model to proceed: wait for the notice, or carry on when wake "none" holds it for the next turn. */
export function backgroundLaunchFollowUp(wake: DelegateTaskArgs["wake"]): string {
  if (wake === "none") {
    return 'Do NOT call background_output now, and do not wait for it: with wake "none" the result does not start a turn. It is saved and reaches you with your next turn. Carry on with other work, or end your turn.'
  }
  return "Do NOT call background_output now. Wait for <system-reminder> notification first. The system will deliver the result when the task completes; you do not need to poll for it."
}
