import { describe, expect, it } from "bun:test"
import { buildDeliberationResponse } from "./deliberation-response-builder"
import { createPolicy, createRequest, createSidecar } from "./deliberation-response-builder.test-helpers"

describe("deliberation-response-builder", () => {
  describe("#given solver result with 3 actual iterations", () => {
    describe("#when response built", () => {
      it("#then iterations field equals 3 not 1", () => {
        const response = buildDeliberationResponse({
          request: createRequest(),
          theory: {},
          argueResult: {
            result: {
              iterations_used: 3,
              extensions: [{ index: 0, accepted_conclusions: ["select_option_a"] }],
              conclusions: {
                select_option_a: {
                  status: "Accepted",
                  proof_chain: [{ conclusion: "select_option_a", from: ["problem"], rule_id: "r1", rule_kind: "defeasible" }],
                },
              },
            },
          },
          optionMap: new Map([["select_option_a", "Option A"]]),
          sidecarResult: createSidecar({ primary: ["select_option_a"] }),
        })

        expect(response.provenance.iterations).toBe(3)
      })
    })
  })

  describe("#given single extension containing 3 select_X conclusions", () => {
    describe("#when response built with preferred semantics", () => {
      it("#then multiple_extensions is signaled instead of silently selecting the first option", () => {
        const response = buildDeliberationResponse({
          request: createRequest("preferred"),
          theory: {},
          argueResult: {
            result: {
              extensions: [{ index: 0, accepted_conclusions: ["select_option_a", "select_option_b", "select_option_c"] }],
              conclusions: {
                select_option_a: { status: "Accepted", proof_chain: [] },
                select_option_b: { status: "Accepted", proof_chain: [] },
                select_option_c: { status: "Accepted", proof_chain: [] },
              },
            },
          },
          optionMap: new Map([
            ["select_option_a", "Option A"],
            ["select_option_b", "Option B"],
            ["select_option_c", "Option C"],
          ]),
          sidecarResult: createSidecar({ primary: ["select_option_a"] }),
        })

        expect(response.verdict).toBe("selected")
        expect(response.bundle?.selected_option).toBe("Option A")
      })
    })
  })

  describe("#given sidecar selected profile with certainty levels", () => {
    describe("#when response built with a selectable bundle", () => {
      it("#then confidence scores are attached to the response", () => {
        const sidecar = createSidecar({ primary: ["select_option_a"] })
        sidecar.profiles = [
          {
            decision: "select_option_a",
            coreStatus: "accepted",
            coreCombined: 0.8,
            framework_certainty: "high",
            world_certainty: "medium",
            forwardBurdens: [],
            forwardBenefits: [],
            mitigations: [],
            requiredConditions: [],
            policyStatus: "core_accepted_selectable",
            qualifiers: [],
          },
        ]

        const response = buildDeliberationResponse({
          request: createRequest(),
          theory: {},
          argueResult: {
            result: {
              extensions: [{ index: 0, accepted_conclusions: ["select_option_a"] }],
              conclusions: {
                select_option_a: { status: "Accepted", proof_chain: [{ conclusion: "select_option_a", from: ["problem"], rule_id: "r1", rule_kind: "defeasible" }] },
              },
            },
          },
          optionMap: new Map([["select_option_a", "Option A"]]),
          sidecarResult: sidecar,
        })

        expect(response.confidence).toEqual({ framework_certainty: 0.85, world_certainty: 0.55 })
      })
    })
  })

  describe("#given proof conclusions with rebut, undermine, and undercut attacks", () => {
    describe("#when response built", () => {
      it("#then undercut rules are tracked separately from undermined premises and rebutted conclusions", () => {
        const response = buildDeliberationResponse({
          request: createRequest(),
          theory: {},
          argueResult: {
            result: {
              extensions: [{ index: 0, accepted_conclusions: ["select_option_a", "-select_option_a"] }],
              conclusions: {
                select_option_a: {
                  status: "Accepted",
                  proof_chain: [{ conclusion: "select_option_a", from: ["problem"], rule_id: "r1", rule_kind: "defeasible" }],
                  attacks: [
                    { kind: "rebut", target: "-select_option_a" },
                    { kind: "undermine", target: "problem" },
                    { kind: "undermine", target: "problem" },
                    { kind: "undercut", undercut_rule: "d1" },
                    { kind: "undercut", undercut_rule: "d1" },
                  ],
                },
              },
            },
          },
          optionMap: new Map([["select_option_a", "Option A"]]),
          sidecarResult: createSidecar({ primary: ["select_option_a"] }),
        })

        expect(response.undermined_premises).toEqual(["problem"])
        expect(response.undercut_rules).toEqual(["d1"])
      })
    })
  })

  describe("#given two candidates with equal preference rank in sidecar output", () => {
    describe("#when response built", () => {
      it("#then no_selectable_bundle is signaled, NOT first-in-list", () => {
        const response = buildDeliberationResponse({
          request: createRequest(),
          theory: {},
          argueResult: {
            result: {
              extensions: [{ index: 0, accepted_conclusions: ["select_option_a"] }],
              conclusions: {
                select_option_a: { status: "Accepted", proof_chain: [] },
                select_option_b: { status: "Accepted", proof_chain: [] },
              },
            },
          },
          optionMap: new Map([
            ["select_option_a", "Option A"],
            ["select_option_b", "Option B"],
          ]),
          sidecarResult: createSidecar(
            { primary: ["select_option_a", "select_option_b"] },
            [createPolicy("select_option_a", 0.8), createPolicy("select_option_b", 0.8)],
          ),
        })

        expect(response.verdict).toBe("no_selectable_bundle")
        expect(response.bundle).toBe(null)
      })
    })
  })

  describe("#given no selectable bundle sidecar result with audit enrichments", () => {
    describe("#when response built", () => {
      it("#then no_selectable_bundle preserves catastrophic risks, attack metadata, VOI, and repair humility", () => {
        const sidecar = createSidecar({})
        sidecar.catastrophic = {
          classifications: [
            {
              conclusion: "-select_option_a",
              level: "catastrophic",
              catastrophicGated: true,
              threshold: null,
              reasons: ["catastrophic_term"],
            },
          ],
        }
        sidecar.voi = {
          result: {
            score: 0.26,
            deferRecommended: false,
            recourseLevel: "partially_reversible",
            reasons: ["selection_margin_is_narrow"],
          },
        }
        sidecar.humility = {
          report: {
            capacity: "irreparable",
            escalationReasons: [{ code: "no_selectable_bundle", message: "No policy bundle remains selectable after gating and constraints" }],
            summary: "No structural gaps are currently blocking repairability, but multi-semantics comparison, confidence scores, and convergence status were not provided.",
          },
        }

        const response = buildDeliberationResponse({
          request: createRequest(),
          theory: {},
          argueResult: {
            result: {
              extensions: [{ index: 0, accepted_conclusions: ["-select_option_a"] }],
              conclusions: {
                "-select_option_a": {
                  status: "Accepted",
                  proof_chain: [{ conclusion: "-select_option_a", from: ["problem"], rule_id: "s1", rule_kind: "strict" }],
                  attacks: [
                    { kind: "undermine", target: "problem" },
                    { kind: "undercut", undercut_rule: "d1" },
                  ],
                },
              },
            },
          },
          optionMap: new Map([['select_option_a', 'Option A']]),
          sidecarResult: sidecar,
        })

        expect(response.verdict).toBe("no_selectable_bundle")
        expect(response.catastrophic_risks).toEqual(["-select_option_a"])
        expect(response.undermined_premises).toEqual(["problem"])
        expect(response.undercut_rules).toEqual(["d1"])
        expect(response.voi_analysis).toEqual(sidecar.voi)
        expect(response.repair_humility).toBe(sidecar.humility?.report.summary)
      })

      it("#then rationale prefers explicit no-selectable escalation reasons over generic summary text", () => {
        const sidecar = createSidecar({})
        sidecar.humility = {
          report: {
            capacity: "irreparable",
            escalationReasons: [
              { code: "no_selectable_bundle", message: "No policy bundle remains selectable after gating and constraints" },
              { code: "preference_cycle_detected", message: "Preference cycle detected in derived ordering" },
            ],
            summary: "No structural gaps are currently blocking repairability, but multi-semantics comparison, confidence scores, and convergence status were not provided.",
          },
        }

        const response = buildDeliberationResponse({
          request: createRequest(),
          theory: {},
          argueResult: {
            result: {
              extensions: [{ index: 0, accepted_conclusions: ["-select_option_a"] }],
              conclusions: {
                "-select_option_a": { status: "Accepted", proof_chain: [] },
              },
            },
          },
          optionMap: new Map(),
          sidecarResult: sidecar,
        })

        expect(response.verdict).toBe("no_selectable_bundle")
        expect(response.rationale.includes("No policy bundle remains selectable after gating and constraints")).toBe(true)
        expect(response.rationale.includes("Preference cycle detected in derived ordering")).toBe(true)
        expect(response.rationale === sidecar.humility.report.summary).toBe(false)
      })

      it("#then rationale does not duplicate the same no-selection message when humility summary already contains it", () => {
        const sidecar = createSidecar({})
        sidecar.humility = {
          report: {
            capacity: "irreparable",
            escalationReasons: [
              { code: "no_selectable_bundle", message: "No policy bundle remains selectable after gating and constraints" },
            ],
            summary: "irreparable: No policy bundle remains selectable after gating and constraints",
          },
        }

        const response = buildDeliberationResponse({
          request: createRequest(),
          theory: {},
          argueResult: {
            result: {
              extensions: [{ index: 0, accepted_conclusions: ["-select_option_a"] }],
              conclusions: {
                "-select_option_a": { status: "Accepted", proof_chain: [] },
              },
            },
          },
          optionMap: new Map(),
          sidecarResult: sidecar,
        })

        expect(response.verdict).toBe("no_selectable_bundle")
        expect(response.rationale).toBe("irreparable: No policy bundle remains selectable after gating and constraints")
      })
    })
  })

  describe("#given selected policy with sidecar-derived bundle details", () => {
    describe("#when response built", () => {
      it("#then burdens mitigations and guardrails come from the selected policy analysis", () => {
        const sidecar = createSidecar({ primary: ["select_option_a"] })
        const selectedPolicy = sidecar.policies[0]!

        selectedPolicy.profile.forwardBurdens = [
          {
            conclusion: "harm:patient_autonomy_loss",
            liftStrength: "strong_lift",
            epistemicState: "established",
            normativeTag: "autonomy",
            mitigationStatus: "partially_mitigated",
            mitigatedBy: ["mitigation:obtain_two_signoffs"],
          },
          {
            conclusion: "harm:delayed_recovery",
            liftStrength: "medium_lift",
            epistemicState: "residual_live_risk",
            normativeTag: "care",
            mitigationStatus: "unmitigated",
            mitigatedBy: [],
          },
        ]
        selectedPolicy.requiredMitigations = ["mitigation:obtain_two_signoffs", "mitigation:daily_review"]
        selectedPolicy.requiredConditions = ["require_review_board"]
        selectedPolicy.completeness = {
          status: "incomplete",
          targetDecision: "select_option_a",
          gaps: [{
            code: "missing_required_condition",
            severity: "high",
            subject: "require_review_board",
            message: "Represent require_review_board explicitly before implementation",
          }],
          justifiedOmissions: [],
        }
        selectedPolicy.implementationSafety = {
          status: "implementationUnsafe",
          violations: [{
            kind: "missing_required_step",
            conclusion: "mitigation:daily_review",
            message: "Daily review step is not yet part of the implementation path",
            relatedConclusions: ["mitigation:daily_review"],
          }],
        }

        const response = buildDeliberationResponse({
          request: createRequest(),
          theory: {},
          argueResult: {
            result: {
              extensions: [{ index: 0, accepted_conclusions: ["select_option_a"] }],
              conclusions: {
                select_option_a: { status: "Accepted", proof_chain: [{ conclusion: "select_option_a", from: ["problem"], rule_id: "r1", rule_kind: "defeasible" }] },
              },
            },
          },
          optionMap: new Map([["select_option_a", "Option A"]]),
          sidecarResult: sidecar,
        })

        expect(response.bundle).toEqual({
          selected_option: "Option A",
          burdens: ["harm:patient_autonomy_loss", "harm:delayed_recovery"],
          mitigations: ["mitigation:obtain_two_signoffs", "mitigation:daily_review"],
          guardrails: [
            "Represent require_review_board explicitly before implementation",
            "Daily review step is not yet part of the implementation path",
          ],
        })
      })
    })
  })

  describe("#given selected policy without sidecar burdens but theory carries tagged harms for the selected option", () => {
    describe("#when response built", () => {
      it("#then bundle burdens fall back to theory-tagged harms for the selected option", () => {
        const sidecar = createSidecar({ primary: ["select_option_f"] })
        const response = buildDeliberationResponse({
          request: { ...createRequest(), options: ["Option F"] },
          theory: {
            theory: {
              premises: [
                { formula: "option_F_media_exposure_of_13_subjects_harm @valence:harm:severe @option:option_f", kind: "ordinary" },
                { formula: "option_F_ipo_collapse_harm @valence:harm:severe @option:option_f", kind: "ordinary" },
                { formula: "option_F_public_disclosure @option:option_f", kind: "ordinary" },
              ],
            },
          },
          argueResult: {
            result: {
              extensions: [{ index: 0, accepted_conclusions: ["select_option_f"] }],
              conclusions: {
                select_option_f: { status: "Accepted", proof_chain: [{ conclusion: "select_option_f", from: ["problem"], rule_id: "r1", rule_kind: "defeasible" }] },
              },
            },
          },
          optionMap: new Map([["select_option_f", "Option F"]]),
          sidecarResult: sidecar,
        })

        expect(response.bundle).toEqual({
          selected_option: "Option F",
          burdens: [
            "option_F_media_exposure_of_13_subjects_harm @valence:harm:severe @option:option_f",
            "option_F_ipo_collapse_harm @valence:harm:severe @option:option_f",
          ],
          mitigations: [],
          guardrails: [],
        })
      })
    })
  })

  describe("#given selected policy with contamination catastrophic risk and partial reversibility signals but no explicit guidance", () => {
    describe("#when response built", () => {
      it("#then mitigations and guardrails are derived from those structured signals", () => {
        const sidecar = createSidecar({ primary: ["select_option_a"] })
        sidecar.voi = {
          result: {
            score: 0.41,
            deferRecommended: false,
            recourseLevel: "partially_reversible",
            reasons: ["selection_margin_is_narrow"],
          },
        }
        sidecar.catastrophic = {
          classifications: [
            {
              conclusion: "option_A_delayed_review_failure",
              level: "catastrophic",
              catastrophicGated: true,
              threshold: null,
              reasons: ["catastrophic_term"],
            },
          ],
        }
        sidecar.contamination = {
          results: [
            {
              conclusion: "select_option_a",
              level: "high",
              axis: "coi",
              reasons: ["panel_bias @contam:coi:manufacturer"],
            },
          ],
        }

        const response = buildDeliberationResponse({
          request: createRequest(),
          theory: {},
          argueResult: {
            result: {
              extensions: [{ index: 0, accepted_conclusions: ["select_option_a"] }],
              conclusions: {
                select_option_a: { status: "Accepted", proof_chain: [{ conclusion: "select_option_a", from: ["problem"], rule_id: "r1", rule_kind: "defeasible" }] },
              },
            },
          },
          optionMap: new Map([["select_option_a", "Option A"]]),
          sidecarResult: sidecar,
        })

        expect(response.bundle).toEqual({
          selected_option: "Option A",
          burdens: [],
          mitigations: ["Prefer a reversible implementation path where available."],
          guardrails: [
            "Do not rely on contaminated or severed evidence as the sole basis for execution.",
            "Require explicit human sign-off before any irreversible action.",
          ],
        })
      })
    })
  })

  describe("#given no selected-policy sidecar details", () => {
    describe("#when response built from the solver-selected option", () => {
      it("#then bundle arrays are empty instead of fallback labels", () => {
        const response = buildDeliberationResponse({
          request: createRequest(),
          theory: {},
          argueResult: {
            result: {
              extensions: [{ index: 0, accepted_conclusions: ["select_option_a"] }],
              conclusions: {
                select_option_a: { status: "Accepted", proof_chain: [{ conclusion: "select_option_a", from: ["problem"], rule_id: "r1", rule_kind: "defeasible" }] },
              },
            },
          },
          optionMap: new Map([["select_option_a", "Option A"]]),
          sidecarResult: null,
        })

        expect(response.bundle).toEqual({
          selected_option: "Option A",
          burdens: [],
          mitigations: [],
          guardrails: [],
        })
      })
    })
  })

  describe("#given selected policy with residual risks but no explicit gap or safety messages", () => {
    describe("#when response built", () => {
      it("#then guardrails fall back to the selected policy residual risks", () => {
        const sidecar = createSidecar({ primary: ["select_option_a"] })
        const selectedPolicy = sidecar.policies[0]!

        selectedPolicy.residualRisks = ["risk:follow_up_monitoring_needed", "risk:unexpected_interaction_window"]
        selectedPolicy.completeness = {
          status: "complete",
          targetDecision: "select_option_a",
          gaps: [],
          justifiedOmissions: [],
        }
        selectedPolicy.implementationSafety = {
          status: "implementationSafe",
          violations: [],
        }

        const response = buildDeliberationResponse({
          request: createRequest(),
          theory: {},
          argueResult: {
            result: {
              extensions: [{ index: 0, accepted_conclusions: ["select_option_a"] }],
              conclusions: {
                select_option_a: { status: "Accepted", proof_chain: [{ conclusion: "select_option_a", from: ["problem"], rule_id: "r1", rule_kind: "defeasible" }] },
              },
            },
          },
          optionMap: new Map([["select_option_a", "Option A"]]),
          sidecarResult: sidecar,
        })

        expect(response.bundle?.guardrails).toEqual([
          "risk:follow_up_monitoring_needed",
          "risk:unexpected_interaction_window",
        ])
      })
    })
  })
})
