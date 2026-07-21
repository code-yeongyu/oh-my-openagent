export interface PreservedAgentReasoning {
  readonly model: string | null
  readonly effort: string
}

interface ManagedReasoningUpgradeStep {
  readonly previous: PreservedAgentReasoning
  readonly current: PreservedAgentReasoning
}

const MANAGED_REASONING_DEFAULT_UPGRADES = new Map<string, readonly ManagedReasoningUpgradeStep[]>([
  [
    "explorer",
    [
      {
        previous: { model: "gpt-5.4-mini", effort: "low" },
        current: { model: "gpt-5.6-terra", effort: "medium" },
      },
      {
        previous: { model: "gpt-5.6-terra", effort: "medium" },
        current: { model: "gpt-5.6-luna", effort: "low" },
      },
    ],
  ],
  [
    "librarian",
    [
      {
        previous: { model: "gpt-5.4-mini", effort: "low" },
        current: { model: "gpt-5.6-terra", effort: "medium" },
      },
      {
        previous: { model: "gpt-5.6-terra", effort: "medium" },
        current: { model: "gpt-5.6-luna", effort: "low" },
      },
    ],
  ],
  [
    "momus",
    [
      {
        previous: { model: "gpt-5.5", effort: "xhigh" },
        current: { model: "gpt-5.6-sol", effort: "ultra" },
      },
      {
        previous: { model: "gpt-5.6-sol", effort: "ultra" },
        current: { model: "gpt-5.6-terra", effort: "high" },
      },
    ],
  ],
  [
    "plan",
    [
      {
        previous: { model: "gpt-5.6-sol", effort: "xhigh" },
        current: { model: "gpt-5.6-sol", effort: "max" },
      },
      {
        previous: { model: "gpt-5.6-sol", effort: "max" },
        current: { model: "gpt-5.6-sol", effort: "high" },
      },
    ],
  ],
  [
    "lazycodex-worker-medium",
    [
      {
        previous: { model: "gpt-5.6-sol", effort: "high" },
        current: { model: "gpt-5.6-luna", effort: "max" },
      },
      {
        previous: { model: "gpt-5.6-luna", effort: "max" },
        current: { model: "gpt-5.6-terra", effort: "high" },
      },
    ],
  ],
  [
    "lazycodex-worker-high",
    [
      {
        previous: { model: "gpt-5.6-sol", effort: "max" },
        current: { model: "gpt-5.6-sol", effort: "medium" },
      },
    ],
  ],
  [
    "lazycodex-code-reviewer",
    [
      {
        previous: { model: "gpt-5.6-sol", effort: "xhigh" },
        current: { model: "gpt-5.6-terra", effort: "medium" },
      },
    ],
  ],
  [
    "lazycodex-clone-fidelity-reviewer",
    [
      {
        previous: { model: "gpt-5.6-sol", effort: "xhigh" },
        current: { model: "gpt-5.6-terra", effort: "high" },
      },
    ],
  ],
  [
    "lazycodex-qa-executor",
    [
      {
        previous: { model: "gpt-5.6-terra", effort: "medium" },
        current: { model: "gpt-5.6-luna", effort: "high" },
      },
    ],
  ],
  [
    "lazycodex-gate-reviewer",
    [
      {
        previous: { model: "gpt-5.6-sol", effort: "xhigh" },
        current: { model: "gpt-5.6-sol", effort: "high" },
      },
      {
        previous: { model: "gpt-5.6-sol", effort: "high" },
        current: { model: "gpt-5.6-sol", effort: "low" },
      },
    ],
  ],
])

export function resolveManagedAgentReasoning(input: {
  readonly agentName: string
  readonly bundledModel: string | null
  readonly bundledEffort: string | null
  readonly preserved: PreservedAgentReasoning
}): string {
  const steps = MANAGED_REASONING_DEFAULT_UPGRADES.get(input.agentName)
  if (steps === undefined) return input.preserved.effort
  const latest = steps[steps.length - 1]
  if (latest === undefined) return input.preserved.effort
  if (input.bundledModel !== latest.current.model || input.bundledEffort !== latest.current.effort) {
    return input.preserved.effort
  }
  const preservedMatchesAnyStep = steps.some(
    (step) =>
      input.preserved.model === step.previous.model && input.preserved.effort === step.previous.effort,
  )
  return preservedMatchesAnyStep ? latest.current.effort : input.preserved.effort
}
