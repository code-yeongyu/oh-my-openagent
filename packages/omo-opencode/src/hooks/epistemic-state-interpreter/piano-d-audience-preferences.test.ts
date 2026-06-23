import { describe, expect, it } from "bun:test"

import { extractAudiencePreferences } from "./piano-d-audience-preferences"
import type { AudienceAnalysis } from "../reasoning-core-policy-gate/extended-response-types"

function buildAudienceAnalysis(audiences: AudienceAnalysis["audiences"]): AudienceAnalysis {
  return {
    audiences,
    consensus: "unanimous",
    per_audience: Object.fromEntries(audiences.map((a) => [a.audience_id, a])),
  }
}

describe("extractAudiencePreferences", () => {
  it("#when audienceAnalysis is undefined #then returns empty result", () => {
    const result = extractAudiencePreferences({
      paretoOptimal: ["alpha"],
      knownConclusions: ["alpha", "beta"],
    })
    expect(result.audiences_used).toEqual([])
    expect(result.per_audience).toEqual({})
  })

  it("#when audienceAnalysis has zero audiences #then returns empty result", () => {
    const result = extractAudiencePreferences({
      audienceAnalysis: buildAudienceAnalysis([]),
      paretoOptimal: ["alpha"],
      knownConclusions: ["alpha"],
    })
    expect(result.audiences_used).toEqual([])
  })

  it("#when audience selected an option that exists in known conclusions #then maps it as preferred", () => {
    const result = extractAudiencePreferences({
      audienceAnalysis: buildAudienceAnalysis([
        {
          audience_id: "healthcare_clinician",
          audience_label: "Healthcare Clinician",
          value_ordering: ["@value:safety", "@value:autonomy"],
          selected_option: "select_option_b",
          verdict: "selected",
        },
      ]),
      paretoOptimal: ["select_option_b"],
      knownConclusions: ["select_option_a", "select_option_b"],
    })
    expect(result.audiences_used).toEqual(["healthcare_clinician"])
    expect(result.per_audience.healthcare_clinician.preferred).toBe("select_option_b")
    expect(result.per_audience.healthcare_clinician.preferred_in_pareto_optimal).toBe(true)
    expect(result.per_audience.healthcare_clinician.verdict).toBe("selected")
  })

  it("#when audience selected an option not in pareto-optimal #then flags preferred_in_pareto_optimal false", () => {
    const result = extractAudiencePreferences({
      audienceAnalysis: buildAudienceAnalysis([
        {
          audience_id: "autonomy_maximizer",
          audience_label: "Autonomy Maximizer",
          value_ordering: ["@value:autonomy"],
          selected_option: "select_option_a",
          verdict: "selected",
        },
      ]),
      paretoOptimal: ["select_option_b"],
      knownConclusions: ["select_option_a", "select_option_b"],
    })
    expect(result.per_audience.autonomy_maximizer.preferred).toBe("select_option_a")
    expect(result.per_audience.autonomy_maximizer.preferred_in_pareto_optimal).toBe(false)
  })

  it("#when audience selected an unknown option #then preferred is null", () => {
    const result = extractAudiencePreferences({
      audienceAnalysis: buildAudienceAnalysis([
        {
          audience_id: "risk_averse",
          audience_label: "Risk Averse",
          value_ordering: ["@value:safety"],
          selected_option: "select_option_zeta_unknown",
          verdict: "selected",
        },
      ]),
      paretoOptimal: ["select_option_a", "select_option_b"],
      knownConclusions: ["select_option_a", "select_option_b"],
    })
    expect(result.per_audience.risk_averse.preferred).toBeNull()
    expect(result.per_audience.risk_averse.preferred_in_pareto_optimal).toBe(false)
  })

  it("#when audience verdict is no_selection #then preferred is null", () => {
    const result = extractAudiencePreferences({
      audienceAnalysis: buildAudienceAnalysis([
        {
          audience_id: "general",
          audience_label: "General",
          value_ordering: [],
          verdict: "no_selection",
        },
      ]),
      paretoOptimal: ["select_option_a"],
      knownConclusions: ["select_option_a"],
    })
    expect(result.per_audience.general.preferred).toBeNull()
    expect(result.per_audience.general.verdict).toBe("no_selection")
  })

  it("#when multiple audiences with mixed selections #then preserves all", () => {
    const result = extractAudiencePreferences({
      audienceAnalysis: buildAudienceAnalysis([
        {
          audience_id: "a1",
          audience_label: "A1",
          value_ordering: ["@value:safety"],
          selected_option: "select_option_b",
          verdict: "selected",
        },
        {
          audience_id: "a2",
          audience_label: "A2",
          value_ordering: ["@value:autonomy"],
          selected_option: "select_option_a",
          verdict: "selected",
        },
        {
          audience_id: "a3",
          audience_label: "A3",
          value_ordering: [],
          verdict: "analysis_failed",
        },
      ]),
      paretoOptimal: ["select_option_a", "select_option_b"],
      knownConclusions: ["select_option_a", "select_option_b"],
    })
    expect(result.audiences_used).toEqual(["a1", "a2", "a3"])
    expect(result.per_audience.a1.preferred).toBe("select_option_b")
    expect(result.per_audience.a2.preferred).toBe("select_option_a")
    expect(result.per_audience.a3.preferred).toBeNull()
    expect(result.per_audience.a3.verdict).toBe("analysis_failed")
  })
})
