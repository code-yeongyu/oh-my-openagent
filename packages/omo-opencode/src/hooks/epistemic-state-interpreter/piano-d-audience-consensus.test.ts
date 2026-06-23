import { describe, expect, it } from "bun:test"

import { aggregateAudienceConsensus } from "./piano-d-audience-consensus"
import type { AudiencePreference } from "./piano-d-audience-preferences"

function buildPreference(
  id: string,
  preferred: string | null,
  inPareto = true,
): AudiencePreference {
  return {
    audience_id: id,
    audience_label: id,
    preferred,
    preferred_in_pareto_optimal: inPareto,
    verdict: preferred ? "selected" : "no_selection",
  }
}

function buildPerAudience(prefs: AudiencePreference[]): Record<string, AudiencePreference> {
  return Object.fromEntries(prefs.map((p) => [p.audience_id, p]))
}

describe("aggregateAudienceConsensus", () => {
  it("#when no audiences provided #then consensus is no_data", () => {
    const result = aggregateAudienceConsensus({ per_audience: {}, paretoOptimal: [] })
    expect(result.consensus).toBe("no_data")
    expect(result.consensus_choice).toBeNull()
  })

  it("#when all audiences have no_selection #then consensus is no_data with no_selection list populated", () => {
    const result = aggregateAudienceConsensus({
      per_audience: buildPerAudience([
        buildPreference("a1", null),
        buildPreference("a2", null),
      ]),
      paretoOptimal: ["alpha"],
    })
    expect(result.consensus).toBe("no_data")
    expect(result.no_selection_audiences.sort()).toEqual(["a1", "a2"])
  })

  it("#when all audiences agree on the same choice #then consensus is unanimous", () => {
    const result = aggregateAudienceConsensus({
      per_audience: buildPerAudience([
        buildPreference("a1", "alpha"),
        buildPreference("a2", "alpha"),
        buildPreference("a3", "alpha"),
      ]),
      paretoOptimal: ["alpha"],
    })
    expect(result.consensus).toBe("unanimous")
    expect(result.consensus_choice).toBe("alpha")
    expect(result.agreeing_audiences.sort()).toEqual(["a1", "a2", "a3"])
    expect(result.dissenting_audiences).toEqual([])
  })

  it("#when 2 of 3 audiences agree #then consensus is majority and identifies dissenters", () => {
    const result = aggregateAudienceConsensus({
      per_audience: buildPerAudience([
        buildPreference("a1", "alpha"),
        buildPreference("a2", "alpha"),
        buildPreference("a3", "beta"),
      ]),
      paretoOptimal: ["alpha", "beta"],
    })
    expect(result.consensus).toBe("majority")
    expect(result.consensus_choice).toBe("alpha")
    expect(result.agreeing_audiences.sort()).toEqual(["a1", "a2"])
    expect(result.dissenting_audiences).toEqual(["a3"])
  })

  it("#when audiences split evenly across two choices #then consensus is split", () => {
    const result = aggregateAudienceConsensus({
      per_audience: buildPerAudience([
        buildPreference("a1", "alpha"),
        buildPreference("a2", "beta"),
      ]),
      paretoOptimal: ["alpha", "beta"],
    })
    expect(result.consensus).toBe("split")
    expect(result.consensus_choice).toBeNull()
    expect(result.dissenting_audiences.sort()).toEqual(["a1", "a2"])
  })

  it("#when one audience prefers and others have no_selection #then unanimous on the single preference", () => {
    const result = aggregateAudienceConsensus({
      per_audience: buildPerAudience([
        buildPreference("a1", "alpha"),
        buildPreference("a2", null),
      ]),
      paretoOptimal: ["alpha"],
    })
    expect(result.consensus).toBe("unanimous")
    expect(result.consensus_choice).toBe("alpha")
    expect(result.no_selection_audiences).toEqual(["a2"])
  })

  it("#when majority chooses a non-pareto-optimal option #then consensus restricts to pareto-optimal eligible options", () => {
    const result = aggregateAudienceConsensus({
      per_audience: buildPerAudience([
        buildPreference("a1", "blocked_choice", false),
        buildPreference("a2", "blocked_choice", false),
        buildPreference("a3", "alpha", true),
      ]),
      paretoOptimal: ["alpha"],
    })
    expect(result.consensus_choice).toBe("alpha")
    expect(result.consensus).toBe("unanimous")
  })

  it("#when paretoOptimal is empty #then ignores filter and ranks by raw count", () => {
    const result = aggregateAudienceConsensus({
      per_audience: buildPerAudience([
        buildPreference("a1", "alpha"),
        buildPreference("a2", "alpha"),
        buildPreference("a3", "beta"),
      ]),
      paretoOptimal: [],
    })
    expect(result.consensus).toBe("majority")
    expect(result.consensus_choice).toBe("alpha")
  })
})
