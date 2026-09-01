export type AgentModelCandidate = {
  readonly model: string
  readonly variant?: string
  readonly reasoning?: string
  readonly reasoningEffort?: string
}

export type AgentModelEntry = string | AgentModelCandidate

type AgentTuningDefaults = {
  readonly variant?: string
  readonly reasoningEffort?: string
}

// Per-entry tuning wins over the agent-level default, so a fallback entry can run at a different
// effort than the primary model - the reason the object spelling exists at all.
export function agentModelCandidates(
  primary: string | undefined,
  entries: readonly AgentModelEntry[] | undefined,
  defaults: AgentTuningDefaults,
): readonly AgentModelCandidate[] {
  const primaryCandidate = primary === undefined ? [] : [withDefaults({ model: primary }, defaults)]
  const chain = (entries ?? []).map((entry) => withDefaults(normalizeEntry(entry), defaults))
  return [...primaryCandidate, ...chain]
}

function normalizeEntry(entry: AgentModelEntry): AgentModelCandidate {
  return typeof entry === "string" ? { model: entry } : entry
}

function withDefaults(candidate: AgentModelCandidate, defaults: AgentTuningDefaults): AgentModelCandidate {
  const variant = candidate.variant ?? defaults.variant
  // Canonical reasoning wins over the legacy reasoningEffort spelling on the same entry.
  const reasoningEffort = candidate.reasoning ?? candidate.reasoningEffort ?? defaults.reasoningEffort
  return {
    model: candidate.model,
    ...(variant === undefined ? {} : { variant }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  }
}
