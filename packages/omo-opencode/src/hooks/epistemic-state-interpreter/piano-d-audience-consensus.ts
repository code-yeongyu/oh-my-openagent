import type { AudiencePreference } from "./piano-d-audience-preferences"

export type AudienceConsensusKind = "unanimous" | "majority" | "split" | "no_data"

export interface AudienceConsensusResult {
  consensus: AudienceConsensusKind
  consensus_choice: string | null
  agreeing_audiences: string[]
  dissenting_audiences: string[]
  no_selection_audiences: string[]
}

export function aggregateAudienceConsensus(input: {
  per_audience: Record<string, AudiencePreference>
  paretoOptimal: string[]
}): AudienceConsensusResult {
  const audiences = Object.values(input.per_audience)
  const empty: AudienceConsensusResult = {
    consensus: "no_data",
    consensus_choice: null,
    agreeing_audiences: [],
    dissenting_audiences: [],
    no_selection_audiences: [],
  }

  if (audiences.length === 0) {
    return empty
  }

  const noSelection = audiences.filter((a) => a.preferred === null).map((a) => a.audience_id)
  const withPreference = audiences.filter((a) => a.preferred !== null) as Array<
    AudiencePreference & { preferred: string }
  >

  if (withPreference.length === 0) {
    return { ...empty, no_selection_audiences: noSelection }
  }

  const paretoSet = new Set(input.paretoOptimal)
  const eligibleAudiences = paretoSet.size === 0
    ? withPreference
    : withPreference.filter((a) => paretoSet.has(a.preferred))
  const ineligibleByPareto = withPreference
    .filter((a) => !eligibleAudiences.includes(a))
    .map((a) => a.audience_id)

  if (eligibleAudiences.length === 0) {
    return {
      consensus: "split",
      consensus_choice: null,
      agreeing_audiences: [],
      dissenting_audiences: ineligibleByPareto,
      no_selection_audiences: noSelection,
    }
  }

  const counts = new Map<string, string[]>()
  for (const audience of eligibleAudiences) {
    const list = counts.get(audience.preferred) ?? []
    list.push(audience.audience_id)
    counts.set(audience.preferred, list)
  }

  const ranked = [...counts.entries()].sort((left, right) => right[1].length - left[1].length)
  const [topChoice, topAudiences] = ranked[0]
  const distinctChoices = ranked.length

  const isUnanimous = distinctChoices === 1
  const isMajority = !isUnanimous && topAudiences.length > eligibleAudiences.length / 2

  const dissentingFromTop = eligibleAudiences
    .filter((a) => a.preferred !== topChoice)
    .map((a) => a.audience_id)

  if (isUnanimous) {
    return {
      consensus: "unanimous",
      consensus_choice: topChoice,
      agreeing_audiences: topAudiences,
      dissenting_audiences: ineligibleByPareto,
      no_selection_audiences: noSelection,
    }
  }

  if (isMajority) {
    return {
      consensus: "majority",
      consensus_choice: topChoice,
      agreeing_audiences: topAudiences,
      dissenting_audiences: [...dissentingFromTop, ...ineligibleByPareto],
      no_selection_audiences: noSelection,
    }
  }

  return {
    consensus: "split",
    consensus_choice: null,
    agreeing_audiences: [],
    dissenting_audiences: [...eligibleAudiences.map((a) => a.audience_id), ...ineligibleByPareto],
    no_selection_audiences: noSelection,
  }
}
