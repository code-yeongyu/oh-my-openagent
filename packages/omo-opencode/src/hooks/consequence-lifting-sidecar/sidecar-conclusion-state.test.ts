import { describe, expect, it } from "bun:test"
import { createProcessedConclusionFixture } from "../reasoning-core-policy-gate/epistemic-analysis-test-fixtures"
import { detectContamination } from "./contamination-detector"
import { buildConclusionStates } from "./sidecar-conclusion-state"

describe("buildConclusionStates contamination handling", () => {
  it("classifies tagged premise conclusions even when they have no antecedents", () => {
    const taggedPremise = "document_control_depends_on_identity_finding @contam:severance:evidentiary"
    const result = buildConclusionStates({
      processed: [createProcessedConclusionFixture(taggedPremise)],
      proofArtifact: {
        result: {
          conclusions: {
            [taggedPremise]: {
              status: "Accepted",
              proof_chain: [{ conclusion: taggedPremise, from: [], rule_id: null, rule_kind: "ordinary" }],
            },
          },
        },
      },
      detectContamination,
    })

    expect(result.contaminationResults).toEqual([
      {
        conclusion: taggedPremise,
        level: "medium",
        axis: "severance",
        reasons: ["document_control_depends_on_identity_finding @contam:severance:evidentiary"],
      },
    ])
  })

  it("propagates contamination from a contaminated parent even when the child proof step omits original tagged premises", () => {
    const contaminatedPremise = "panel_bias @contam:coi:manufacturer"
    const derivedParent = "identity_finding_severed"
    const derivedChild = "document_control_severed"

    const result = buildConclusionStates({
      processed: [
        createProcessedConclusionFixture(contaminatedPremise),
        createProcessedConclusionFixture(derivedParent),
        createProcessedConclusionFixture(derivedChild),
      ],
      proofArtifact: {
        result: {
          conclusions: {
            [contaminatedPremise]: {
              status: "Accepted",
              proof_chain: [{ conclusion: contaminatedPremise, from: [], rule_id: null, rule_kind: "ordinary" }],
            },
            [derivedParent]: {
              status: "Accepted",
              proof_chain: [{ conclusion: derivedParent, from: [contaminatedPremise], rule_id: "s1", rule_kind: "strict" }],
            },
            [derivedChild]: {
              status: "Accepted",
              proof_chain: [{ conclusion: derivedChild, from: [derivedParent], rule_id: "s2", rule_kind: "strict" }],
            },
          },
        },
      },
      detectContamination,
    })

    expect(result.contaminationResults[2]).toEqual({
      conclusion: derivedChild,
      level: "high",
      axis: "coi",
      reasons: ["panel_bias @contam:coi:manufacturer"],
    })
  })
})
