import type { Evidence } from "./types"

export type PreferencePair = { superior: string; inferior: string }

const SUPPORT_RULE_PREFIX = "support-evidence-"
const REFUTE_RULE_PREFIX = "refute-evidence-"

/**
 * Piano D: derive ASPIC+ preferences from past evidence verdicts.
 *
 * Rule: a support-tagged evidence dominates an older refute-tagged evidence
 * for the same hypothesis WHEN the support evidence is more recent OR has
 * higher confidence. Conversely, a recent refute dominates an older support.
 *
 * Output rule ids align with the evidence row id so callers can also embed
 * matching defeasible_rules into their theory if they want explicit chains;
 * by default the preferences alone are sufficient for Piano D dominance.
 */
export function derivePianoDPreferences(history: ReadonlyArray<Evidence>): PreferencePair[] {
  const pairs: PreferencePair[] = []
  const supports = history.filter((e) => e.verdict === "supports")
  const refutes = history.filter((e) => e.verdict === "refutes")
  for (const support of supports) {
    for (const refute of refutes) {
      const dominance = compareEvidence(support, refute)
      if (dominance === "support_dominates") {
        pairs.push({
          superior: ruleId(SUPPORT_RULE_PREFIX, support.id),
          inferior: ruleId(REFUTE_RULE_PREFIX, refute.id),
        })
      } else if (dominance === "refute_dominates") {
        pairs.push({
          superior: ruleId(REFUTE_RULE_PREFIX, refute.id),
          inferior: ruleId(SUPPORT_RULE_PREFIX, support.id),
        })
      }
    }
  }
  return pairs
}

type Dominance = "support_dominates" | "refute_dominates" | "neither"

function compareEvidence(support: Evidence, refute: Evidence): Dominance {
  const supportNewer = support.created_at > refute.created_at
  const refuteNewer = refute.created_at > support.created_at
  const supportConfidence = support.confidence ?? 0.5
  const refuteConfidence = refute.confidence ?? 0.5
  const supportHigher = supportConfidence > refuteConfidence
  const refuteHigher = refuteConfidence > supportConfidence
  if (supportNewer || supportHigher) return "support_dominates"
  if (refuteNewer || refuteHigher) return "refute_dominates"
  return "neither"
}

function ruleId(prefix: string, evidenceId: number): string {
  return `${prefix}${evidenceId}`
}
