import type { AudienceAnalysis, AudienceResult } from "../reasoning-core-policy-gate/extended-response-types"

export interface AudiencePreference {
  audience_id: string
  audience_label: string
  preferred: string | null
  preferred_in_pareto_optimal: boolean
  verdict: AudienceResult["verdict"]
}

export interface AudiencePreferencesResult {
  per_audience: Record<string, AudiencePreference>
  audiences_used: string[]
}

export function extractAudiencePreferences(input: {
  audienceAnalysis?: AudienceAnalysis
  paretoOptimal: string[]
  knownConclusions: string[]
}): AudiencePreferencesResult {
  if (!input.audienceAnalysis || input.audienceAnalysis.audiences.length === 0) {
    return { per_audience: {}, audiences_used: [] }
  }

  const knownSet = new Set(input.knownConclusions)
  const paretoSet = new Set(input.paretoOptimal)
  const perAudience: Record<string, AudiencePreference> = {}
  const audiencesUsed: string[] = []

  for (const audience of input.audienceAnalysis.audiences) {
    const selected = audience.selected_option
    const preferred = selected && knownSet.has(selected) ? selected : null
    perAudience[audience.audience_id] = {
      audience_id: audience.audience_id,
      audience_label: audience.audience_label,
      preferred,
      preferred_in_pareto_optimal: preferred !== null && paretoSet.has(preferred),
      verdict: audience.verdict,
    }
    audiencesUsed.push(audience.audience_id)
  }

  return { per_audience: perAudience, audiences_used: audiencesUsed }
}
