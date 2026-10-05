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
        previous: { model: "gpt-5.6-luna-fast", effort: "low" },
        current: { model: "gpt-5.6-terra", effort: "medium" },
      },
      {
        previous: { model: "gpt-5.6-terra", effort: "medium" },
        current: { model: "gpt-5.6-luna", effort: "low" },
      },
      {
        previous: { model: "gpt-5.6-luna", effort: "low" },
        current: { model: "gpt-6-astra", effort: "low" },
      },
    ],
  ],
  [
    "librarian",
    [
      {
        previous: { model: "gpt-5.6-luna-fast", effort: "low" },
        current: { model: "gpt-5.6-terra", effort: "medium" },
      },
      {
        previous: { model: "gpt-5.6-terra", effort: "medium" },
        current: { model: "gpt-5.6-luna", effort: "low" },
      },
      {
        previous: { model: "gpt-5.6-luna", effort: "low" },
        current: { model: "gpt-6-astra", effort: "low" },
      },
    ],
  ],
  [
    "metis",
    [
      {
        previous: { model: "gpt-5.6-sol", effort: "high" },
        current: { model: "gpt-6-astra", effort: "high" },
      },
    ],
  ],
  [
    "lazycodex-worker-low",
    [
      {
        previous: { model: "gpt-5.6-luna", effort: "high" },
        current: { model: "gpt-6-astra", effort: "high" },
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
      {
        previous: { model: "gpt-5.6-terra", effort: "high" },
        current: { model: "gpt-6-astra", effort: "high" },
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
      {
        previous: { model: "gpt-5.6-sol", effort: "high" },
        current: { model: "gpt-6-astra", effort: "high" },
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
      {
        previous: { model: "gpt-5.6-terra", effort: "high" },
        current: { model: "gpt-6-astra", effort: "high" },
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
      {
        previous: { model: "gpt-5.6-sol", effort: "medium" },
        current: { model: "gpt-6-astra", effort: "medium" },
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
      {
        previous: { model: "gpt-5.6-terra", effort: "medium" },
        current: { model: "gpt-6-astra", effort: "medium" },
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
      {
        previous: { model: "gpt-5.6-terra", effort: "high" },
        current: { model: "gpt-6-astra", effort: "high" },
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
      {
        previous: { model: "gpt-5.6-luna", effort: "high" },
        current: { model: "gpt-6-astra", effort: "high" },
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
      {
        previous: { model: "gpt-5.6-sol", effort: "low" },
        current: { model: "gpt-6-astra", effort: "low" },
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
  // A model-only upgrade must not invalidate cached bundles with the same current effort.
  const bundledMatchesCurrentEffort = input.bundledEffort === latest.current.effort && steps.some(
    (step) => input.bundledModel === step.current.model && input.bundledEffort === step.current.effort,
  )
  if (!bundledMatchesCurrentEffort) return input.preserved.effort
  const preservedMatchesAnyStep = steps.some(
    (step) =>
      input.preserved.model === step.previous.model && input.preserved.effort === step.previous.effort,
  )
  return preservedMatchesAnyStep ? latest.current.effort : input.preserved.effort
}
