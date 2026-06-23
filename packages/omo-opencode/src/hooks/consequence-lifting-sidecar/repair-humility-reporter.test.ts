import { describe, expect, it } from "bun:test"

import { assessRepairHumility } from "./repair-humility-reporter"

describe("assessRepairHumility", () => {
  it("builds a positive computed diagnosis when the selected option is grounded and confidence is high", () => {
    const result = (assessRepairHumility as (...args: unknown[]) => ReturnType<typeof assessRepairHumility>)(
      undefined,
      { status: "implementationSafe", violations: [] },
      { score: 0.2, deferRecommended: false, recourseLevel: "reversible", reasons: [] },
      {
        selectedDecision: "deploy_backup_generators",
        semanticsComparison: {
          grounded_set: ["deploy_backup_generators"],
          preferred_extensions: [["deploy_backup_generators"]],
          stable_extensions: [["deploy_backup_generators"]],
          complete_extensions: [["deploy_backup_generators"]],
          certainty_gradient: {
            certain: ["deploy_backup_generators"],
            defensible: [],
            contested: [],
          },
        },
        confidence: {
          framework_certainty: 0.85,
          world_certainty: 0.55,
        },
        preferenceCycleDetected: false,
        preferenceCyclePath: [],
        convergence: "converged",
        revisedPremises: [],
      },
    )

    expect(result.capacity).toBe("repairable")
    expect(result.escalationReasons).toEqual([])
    expect(result.summary).toBe(
      "Selected option deploy_backup_generators is in the grounded set with no preference cycles, high framework confidence, medium world confidence, and converged reasoning. No revision needed.",
    )
  })

  it("becomes partially repairable when the policy is incomplete", () => {
    const result = assessRepairHumility({ status: "incomplete", targetDecision: "deploy", gaps: [{ code: "missing_viable_alternative", severity: "high", subject: "alt", message: "missing alt" }], justifiedOmissions: [] }, undefined, undefined)
    expect(result.capacity).toBe("partially_repairable")
  })

  it("becomes irreparable when implementation is unsafe and VOI recommends deferral", () => {
    const result = assessRepairHumility(
      { status: "incomplete", targetDecision: "deploy", gaps: [{ code: "missing_required_mitigation", severity: "critical", subject: "guardrail", message: "missing" }], justifiedOmissions: [] },
      { status: "implementationUnsafe", violations: [] },
      { score: 0.8, deferRecommended: true, recourseLevel: "irreversible", reasons: ["high_information_value_before_commitment"] },
    )
    expect(result.capacity).toBe("irreparable")
    expect(result.escalationReasons.map((reason) => reason.code)).toContain("implementation_unsafe")
  })

  it("describes structural uncertainty when the selected option is preferred but not grounded", () => {
    const result = (assessRepairHumility as (...args: unknown[]) => ReturnType<typeof assessRepairHumility>)(
      undefined,
      { status: "implementationSafe", violations: [] },
      { score: 0.74, deferRecommended: true, recourseLevel: "irreversible", reasons: ["high_information_value_before_commitment"] },
      {
        selectedDecision: "option_a",
        semanticsComparison: {
          grounded_set: ["option_b"],
          preferred_extensions: [["option_a"], ["option_c"]],
          stable_extensions: [],
          complete_extensions: [["option_a"], ["option_b"], ["option_c"]],
          certainty_gradient: {
            certain: ["option_b"],
            defensible: ["option_a", "option_c"],
            contested: [],
          },
        },
        confidence: {
          framework_certainty: 0.55,
          world_certainty: 0.25,
        },
        preferenceCycleDetected: true,
        preferenceCyclePath: ["option_a", "option_b", "option_c", "option_a"],
        convergence: "looping",
        revisedPremises: [],
      },
    )

    expect(result.capacity).toBe("irreparable")
    expect(result.summary).toBe(
      "Selected option option_a is defensible in preferred semantics but not in the grounded set, so it remains contestable rather than certain. Preference cycle detected (option_a -> option_b -> option_c -> option_a). VOI suggests deferral. Reasoning is looping.",
    )
  })

  it("acknowledges missing epistemic inputs instead of fabricating certainty", () => {
    const result = (assessRepairHumility as (...args: unknown[]) => ReturnType<typeof assessRepairHumility>)(
      undefined,
      { status: "implementationSafe", violations: [] },
      { score: 0.15, deferRecommended: false, recourseLevel: "reversible", reasons: [] },
      {
        selectedDecision: "option_a",
        semanticsComparison: undefined,
        confidence: undefined,
        preferenceCycleDetected: undefined,
        preferenceCyclePath: undefined,
        convergence: undefined,
        revisedPremises: ["missing(sensor_feed)", "risk(high_load)"],
      },
    )

    expect(result.capacity).toBe("repairable")
    expect(result.summary).toBe(
      "No structural gaps are currently blocking repairability, but multi-semantics comparison, confidence scores, and convergence status were not provided. Premises were revised (2), so verify the revised basis before acting.",
    )
  })
})
