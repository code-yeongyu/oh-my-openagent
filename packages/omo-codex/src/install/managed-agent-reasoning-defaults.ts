export interface PreservedAgentReasoning {
  readonly model: string | null
  readonly effort: string
}

interface ManagedReasoningUpgrade {
  readonly previous: PreservedAgentReasoning
  readonly current: PreservedAgentReasoning
}

const MANAGED_REASONING_DEFAULT_UPGRADES = new Map<string, ManagedReasoningUpgrade>([
  [
    "explorer",
    {
      previous: { model: "gpt-5.4-mini", effort: "low" },
      current: { model: "gpt-5.6-terra", effort: "medium" },
    },
  ],
  [
    "librarian",
    {
      previous: { model: "gpt-5.4-mini", effort: "low" },
      current: { model: "gpt-5.6-terra", effort: "medium" },
    },
  ],
  [
    "momus",
    {
      previous: { model: "gpt-5.5", effort: "xhigh" },
      current: { model: "gpt-5.6-sol", effort: "ultra" },
    },
  ],
])

export function resolveManagedAgentReasoning(input: {
  readonly agentName: string
  readonly bundledModel: string | null
  readonly bundledEffort: string | null
  readonly preserved: PreservedAgentReasoning
}): string {
  const upgrade = MANAGED_REASONING_DEFAULT_UPGRADES.get(input.agentName)
  if (
    upgrade !== undefined &&
    input.preserved.model === upgrade.previous.model &&
    input.preserved.effort === upgrade.previous.effort &&
    input.bundledModel === upgrade.current.model &&
    input.bundledEffort === upgrade.current.effort
  ) {
    return upgrade.current.effort
  }
  return input.preserved.effort
}
