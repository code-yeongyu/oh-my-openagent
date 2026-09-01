// One-shot interaction policies declare agents whose sessions are fire-and-forget: the model may
// spawn them (task), cancel them (task_cancel), and read their output (task_output), but may never
// send them mid-run or post-completion messages (task_send is refused in every state). The
// promptContract field identifies agents whose spawn prompt the harness replaces with a canonical
// neutral document, discarding all caller prose. This module owns the policy data and the pure
// lookup; behavior wiring lives at the manager/tool boundary, exactly like invocation-guard.ts.

export type AgentInteractionPolicy = {
  readonly oneShot: true
  readonly promptContract: "plan-review"
  readonly sendDenialReminder: string
}

export const AGENT_INTERACTION_POLICIES = {
  momus: {
    oneShot: true,
    promptContract: "plan-review",
    sendDenialReminder: `<system-reminder>
Momus is a one-shot plan-review specialist. The only verbs available are task (create), task_cancel (cancel), and task_output (read); task_send is refused in every state - while running, while pending, and after completion - because each momus session runs a single review to completion without external steering.

The harness already replaced the spawn prompt with the canonical plan-review contract: a single .omo/plans/*.md path, analyzed for contradictions and blocking issues only. Any other prompt content the caller supplied was discarded before launch.

Appealing to, briefing, or explaining anything to momus is strictly forbidden. The reviewer does not accept context, clarifications, or follow-up instructions; it works solely from the plan document.

To get another review round after editing the plan, spawn a NEW momus task. Do not attempt to revive or message the completed session.
</system-reminder>`,
  },
} as const satisfies Readonly<Record<string, AgentInteractionPolicy>>

const POLICIES: Readonly<Record<string, AgentInteractionPolicy>> = AGENT_INTERACTION_POLICIES

export const ONE_SHOT_AGENT_NAMES: ReadonlySet<string> = new Set(
  Object.entries(POLICIES)
    .filter(([, policy]) => policy.oneShot)
    .map(([name]) => name),
)

export function interactionPolicyForAgent(agentName: string): AgentInteractionPolicy | undefined {
  return POLICIES[agentName]
}
