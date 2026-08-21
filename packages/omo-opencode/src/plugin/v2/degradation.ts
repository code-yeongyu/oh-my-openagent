export type V2FeatureStatus = "ported" | "degraded" | "unavailable"

export interface V2DegradationEntry {
  feature: string
  v1Surface: string
  status: V2FeatureStatus
  reason: string
  userImpact: string
}

/**
 * Machine-readable ledger of every omo surface whose OpenCode v1 hook has no
 * equivalent in the v2 beta plugin API. Ground truth: SP1/SP2 spikes plus the
 * installed @opencode-ai/plugin@0.0.0-beta-17728 contract.
 */
export const V2_DEGRADATION_LEDGER: readonly V2DegradationEntry[] = [
  {
    feature: "chat.message first-message variant gate",
    v1Surface: "chat.message hook",
    status: "degraded",
    reason: "OpenCode v2 beta exposes no chat.message hook",
    userImpact: "first-message variant selection stays inactive on v2",
  },
  {
    feature: "IntentGate keyword detection",
    v1Surface: "chat.message + experimental.chat.messages.transform hooks",
    status: "degraded",
    reason: "v2 has no dispatch-time message interception hook",
    userImpact: "ultrawork/search/analyze/team keyword prompts are not auto-injected on v2",
  },
  {
    feature: "command.execute.before slash interception",
    v1Surface: "command.execute.before hook",
    status: "unavailable",
    reason: "v2 offers static command transform only, no pre-execute hook",
    userImpact: "slash-command interception is skipped on v2",
  },
  {
    feature: "compaction context injection",
    v1Surface: "experimental.session.compacting hook",
    status: "unavailable",
    reason: "hook removed in the v2 beta plugin API",
    userImpact: "context and todo preservation across compaction is skipped on v2",
  },
  {
    feature: "compaction autocontinue",
    v1Surface: "experimental.compaction.autocontinue hook",
    status: "unavailable",
    reason: "hook removed in the v2 beta plugin API",
    userImpact: "auto-resume after compaction is skipped on v2",
  },
  {
    feature: "tool.definition dynamic override",
    v1Surface: "tool.definition hook",
    status: "ported",
    reason: "overrides fold into static tool registration at setup time",
    userImpact: "no user-visible change on v2",
  },
  {
    feature: "chat.params model tuning",
    v1Surface: "chat.params hook",
    status: "degraded",
    reason: "partial coverage via ctx.aisdk.hook options mutation",
    userImpact: "some provider option overrides may not apply on v2",
  },
] as const

export function listDegradations(): readonly V2DegradationEntry[] {
  return V2_DEGRADATION_LEDGER
}

export function isDegradedOnV2(feature: string): boolean {
  const entry = V2_DEGRADATION_LEDGER.find((candidate) => candidate.feature === feature)
  if (!entry) return false
  return entry.status === "degraded" || entry.status === "unavailable"
}

export function doctorSummary(): string[] {
  return V2_DEGRADATION_LEDGER.map((entry) => `[${entry.status}] ${entry.feature}: ${entry.userImpact}`)
}
