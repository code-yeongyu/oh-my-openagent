import { splitReasoningSuffix } from "@oh-my-opencode/omo-config-core"

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
  const primaryCandidate = primary === undefined ? [] : [withDefaults(withModelSuffix({ model: primary }), defaults)]
  const chain = (entries ?? []).map((entry) => withDefaults(normalizeEntry(entry), defaults))
  return [...primaryCandidate, ...chain]
}

function normalizeEntry(entry: AgentModelEntry): AgentModelCandidate {
  return withModelSuffix(typeof entry === "string" ? { model: entry } : entry)
}

// "provider/model:level" is the documented string spelling of { model, reasoning } (#10380), and the
// config schema keeps the suffix on the model string, so it is split here before any registry lookup.
// A level written on the entry itself still wins over the suffix.
function withModelSuffix(candidate: AgentModelCandidate): AgentModelCandidate {
  const { base, level } = splitReasoningSuffix(candidate.model)
  if (level === undefined) return candidate
  const explicit = candidate.reasoning ?? candidate.reasoningEffort
  return { ...candidate, model: base, ...(explicit === undefined ? { reasoning: level } : {}) }
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
