import { describe, expect, it } from "bun:test"
import type { DeliberationResponse } from "../../agents/themis/types"
import type { AudienceAnalysis, ConvergenceStatus, EpistemicAnalysis, SemanticsComparison } from "../../hooks/reasoning-core-policy-gate/extended-response-types"
import { buildSuccessResponseJson } from "./success-response-json"

function createResponse(overrides: Partial<DeliberationResponse> = {}): DeliberationResponse {
  return {
    verdict: "selected",
    rationale: "No structural gaps are currently blocking repairability, but multi-semantics comparison and convergence status were not provided.",
    proof_chain: [],
    sidecar_trace: {},
    provenance: {
      semantics: "preferred",
      iterations: 1,
      timestamp: "2026-04-14T00:00:00.000Z",
      input_request: {
        id: "forced-chemo",
        timestamp: "2026-04-14T00:00:00.000Z",
        problem_statement: "Choose one option",
        options: ["Option A", "Option B", "Option C", "Option D"],
        constraints: [],
        preferences: [],
        requested_semantics: "preferred",
      },
    },
    bundle: {
      selected_option: "Option D",
      burdens: [],
      mitigations: [],
      guardrails: [],
    },
    error: null,
    ...overrides,
  }
}

function createSemanticsComparison(overrides: Partial<SemanticsComparison> = {}): SemanticsComparison {
  return {
    grounded_set: ["-select_option_A", "-select_option_B", "-select_option_C", "select_option_D"],
    preferred_extensions: [["-select_option_A", "-select_option_B", "-select_option_C", "select_option_D"]],
    stable_extensions: [],
    complete_extensions: [["-select_option_A", "-select_option_B", "-select_option_C", "select_option_D"]],
    certainty_gradient: { certain: ["select_option_D"], defensible: [], contested: [] },
    ...overrides,
  }
}

function buildJson(input: {
  response?: DeliberationResponse
  preferenceCycle?: { detected: boolean; path: string[] }
  semanticsComparison?: SemanticsComparison
  audienceAnalysis?: AudienceAnalysis
  convergence?: ConvergenceStatus
  epistemicAnalysis?: EpistemicAnalysis
} = {}) {
  return JSON.parse(buildSuccessResponseJson({
    response: input.response ?? createResponse(),
    preferenceCycle: input.preferenceCycle ?? { detected: false, path: [] },
    semanticsComparison: input.semanticsComparison ?? createSemanticsComparison(),
    audienceAnalysis: input.audienceAnalysis,
    convergence: input.convergence,
    epistemicAnalysis: input.epistemicAnalysis,
    formalization: { model_id: "test", prompt_version: "test", schema_version: 1, mode: "permissive", cache_hit: false, iterations_attempted: 1 },
  }))
}

describe("buildSuccessResponseJson rationale surface", () => {
  it("#given any successful response #when success JSON built #then runtime provenance is serialized", () => {
    const parsed = buildJson()

    expect(typeof parsed.runtime_provenance?.build_id).toBe("string")
    expect(typeof parsed.runtime_provenance?.build_timestamp).toBe("string")
    expect(parsed.runtime_provenance.build_id.length > 0).toBe(true)
    expect(parsed.runtime_provenance.build_timestamp.length > 0).toBe(true)
  })

  it("#given latest build marker differs from embedded runtime build #when success JSON built #then runtime provenance flags stale runtime", () => {
    const parsed = JSON.parse(buildSuccessResponseJson({
      response: createResponse(),
      preferenceCycle: { detected: false, path: [] },
      semanticsComparison: createSemanticsComparison(),
      formalization: { model_id: "test", prompt_version: "test", schema_version: 1, mode: "permissive", cache_hit: false, iterations_attempted: 1 },
      runtimeBuildInfoOverride: {
        build_id: "embedded-build",
        build_timestamp: "2026-04-15T00:00:00.000Z",
        latest_build_id: "latest-build",
        latest_build_timestamp: "2026-04-15T00:05:00.000Z",
        stale_runtime_detected: true,
      },
    }))

    expect(parsed.runtime_provenance).toEqual({
      build_id: "embedded-build",
      build_timestamp: "2026-04-15T00:00:00.000Z",
      latest_build_id: "latest-build",
      latest_build_timestamp: "2026-04-15T00:05:00.000Z",
      stale_runtime_detected: true,
    })
  })

  it("#given stale runtime detection #when success JSON built #then actionable output is blocked", () => {
    const parsed = JSON.parse(buildSuccessResponseJson({
      response: createResponse({
        verdict: "selected",
        bundle: {
          selected_option: "Option D",
          burdens: [],
          mitigations: [],
          guardrails: [],
        },
      }),
      preferenceCycle: { detected: false, path: [] },
      semanticsComparison: createSemanticsComparison(),
      formalization: { model_id: "test", prompt_version: "test", schema_version: 1, mode: "permissive", cache_hit: false, iterations_attempted: 1 },
      runtimeBuildInfoOverride: {
        build_id: "embedded-build",
        build_timestamp: "2026-04-15T00:00:00.000Z",
        latest_build_id: "latest-build",
        latest_build_timestamp: "2026-04-15T00:05:00.000Z",
        stale_runtime_detected: true,
      },
    }))

    expect(parsed.verdict).toBe("sidecar_internal_error")
    expect(parsed.bundle).toBe(null)
    expect(parsed.error).toBe("Stale runtime detected: host build does not match latest local build. Run /reload-plugins or fully restart the host.")
    expect(parsed.rationale).toBe("Stale runtime detected: host build does not match latest local build. Run /reload-plugins or fully restart the host.")
  })

  it("#given selected verdict with split audience and not_converged semantics #when success JSON built #then rationale is concise and emits rationale_detail", () => {
    const parsed = buildJson({
      audienceAnalysis: {
        audiences: [
          { audience_id: "clinician", audience_label: "Clinician", value_ordering: ["@value:safety"], selected_option: "select_option_A", verdict: "selected" },
          { audience_id: "autonomy", audience_label: "Autonomy", value_ordering: ["@value:autonomy"], selected_option: "select_option_B", verdict: "selected" },
        ],
        consensus: "split",
        per_audience: {},
      },
      convergence: "not_converged",
    })

    expect(parsed.rationale).toBe("Option D selected because Options A, B, and C are excluded; split audience; not converged.")
    expect(parsed.rationale_detail).toEqual({
      verdict_mode: "selected",
      verdict_basis: "One option remains actionable after stronger exclusions.",
      decisive_factors: [
        "Option A excluded by stronger gates",
        "Option B excluded by stronger gates",
        "Option C excluded by stronger gates",
        "Option D remains actionable after exclusions",
      ],
      audience_signal: "audience consensus: split",
      semantics_signal: "convergence: not converged",
      risk_signal: null,
      actionability_signal: null,
    })
  })

  it("#given selected verdict with split audience and not_converged semantics plus reversible recourse #when success JSON built #then final verdict is degraded to defer_recommended", () => {
    const parsed = buildJson({
      response: createResponse({
        verdict: "selected",
        voi_analysis: {
          result: {
            score: 0.31,
            deferRecommended: false,
            recourseLevel: "partially_reversible",
            reasons: ["selection_margin_is_narrow"],
          },
        },
      }),
      audienceAnalysis: {
        audiences: [
          { audience_id: "clinician", audience_label: "Clinician", value_ordering: ["@value:safety"], selected_option: "select_option_A", verdict: "selected" },
          { audience_id: "autonomy", audience_label: "Autonomy", value_ordering: ["@value:autonomy"], selected_option: "select_option_B", verdict: "selected" },
        ],
        consensus: "split",
        per_audience: {},
      },
      convergence: "not_converged",
    })

    expect(parsed.verdict).toBe("defer_recommended")
    expect(parsed.rationale).toBe("Defer recommended because selection margin is narrow; partially reversible; not converged.")
    expect(parsed.rationale_detail).toEqual({
      verdict_mode: "defer_recommended",
      verdict_basis: "The current ranking is too unstable for immediate commitment.",
      decisive_factors: [
        "VOI indicates deferral is warranted",
        "Current ranking remains narrow",
      ],
      audience_signal: "audience consensus: split",
      semantics_signal: "convergence: not converged",
      risk_signal: null,
      actionability_signal: "actionability: partially reversible",
    })
  })

  it("#given no_selectable_bundle with all options blocked and a preference cycle #when success JSON built #then rationale explains no-selection and emits rationale_detail", () => {
    const parsed = buildJson({
      response: createResponse({ verdict: "no_selectable_bundle", bundle: null }),
      preferenceCycle: { detected: true, path: ["r1", "r2", "r1"] },
      semanticsComparison: createSemanticsComparison({
        grounded_set: ["-select_option_A", "-select_option_B", "-select_option_C", "-select_option_D"],
        preferred_extensions: [["-select_option_A", "-select_option_B", "-select_option_C", "-select_option_D"]],
      }),
      convergence: "not_converged",
    })

    expect(parsed.rationale).toBe("No selectable bundle remains because all options are excluded; preference cycle detected; not converged.")
    expect(parsed.rationale_detail).toEqual({
      verdict_mode: "no_selectable_bundle",
      verdict_basis: "All candidate options are blocked by stronger gates or structural conflicts.",
      decisive_factors: [
        "All candidate options are currently excluded",
        "Preference cycle detected in derived ordering",
      ],
      audience_signal: null,
      semantics_signal: "convergence: not converged",
      risk_signal: null,
      actionability_signal: "actionability: irreparable",
    })
  })

  it("#given defer_recommended with narrow margin and partially reversible actionability #when success JSON built #then rationale explains defer and emits rationale_detail", () => {
    const parsed = buildJson({
      response: createResponse({
        verdict: "defer_recommended",
        voi_analysis: {
          result: {
            score: 0.317,
            deferRecommended: true,
            recourseLevel: "partially_reversible",
            reasons: ["selection_margin_is_narrow"],
          },
        },
      }),
      convergence: "not_converged",
    })

    expect(parsed.rationale).toBe("Defer recommended because selection margin is narrow; partially reversible; not converged.")
    expect(parsed.rationale_detail).toEqual({
      verdict_mode: "defer_recommended",
      verdict_basis: "The current ranking is too unstable for immediate commitment.",
      decisive_factors: [
        "VOI indicates deferral is warranted",
        "Current ranking remains narrow",
      ],
      audience_signal: null,
      semantics_signal: "convergence: not converged",
      risk_signal: null,
      actionability_signal: "actionability: partially reversible",
    })
  })

  it("#given a non-target verdict #when success JSON built #then original rationale is preserved and rationale_detail is omitted", () => {
    const parsed = buildJson({
      response: createResponse({ verdict: "formalization_failed", rationale: "Formalization failed: invalid theory.", bundle: null }),
    })

    expect(parsed.rationale).toBe("Formalization failed: invalid theory.")
    expect(parsed.rationale_detail).toBeUndefined()
  })

  it("#given selected verdict with split audience and not_converged semantics #when success JSON built #then bundle gains deterministic guardrails from epistemic fragility", () => {
    const parsed = buildJson({
      response: createResponse({
        bundle: {
          selected_option: "Option D",
          burdens: [],
          mitigations: ["Prefer a reversible implementation path where available."],
          guardrails: [],
        },
      }),
      audienceAnalysis: {
        audiences: [
          { audience_id: "clinician", audience_label: "Clinician", value_ordering: ["@value:safety"], selected_option: "select_option_A", verdict: "selected" },
          { audience_id: "autonomy", audience_label: "Autonomy", value_ordering: ["@value:autonomy"], selected_option: "select_option_B", verdict: "selected" },
        ],
        consensus: "split",
        per_audience: {},
      },
      convergence: "not_converged",
    })

    expect(parsed.bundle).toEqual({
      selected_option: "Option D",
      burdens: [],
      mitigations: ["Prefer a reversible implementation path where available."],
      guardrails: [
        "Record dissenting value perspectives before executing the selected option.",
        "Treat this recommendation as contestable across semantics and record the decision rationale before execution.",
      ],
    })
  })
})
