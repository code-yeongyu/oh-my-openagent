export const VP_PROMOTION_PROOF_ARTIFACT = {
  theory: {},
  result: {
    semantics: "preferred",
    extensions: [
      {
        index: 0,
        accepted_conclusions: [
          "-promote(marco)",
          "promote(luca)",
          "promote(sara)",
          "consistent_performance(luca)",
          "ethics_complaint(marco)",
          "high_quality(sara)",
          "high_sales(marco)",
          "low_quality(sara)",
          "strong_leadership(luca)",
        ],
      },
      {
        index: 1,
        accepted_conclusions: [
          "-promote(marco)",
          "-promote(sara)",
          "promote(luca)",
          "consistent_performance(luca)",
          "ethics_complaint(marco)",
          "high_quality(sara)",
          "high_sales(marco)",
          "low_quality(sara)",
          "strong_leadership(luca)",
        ],
      },
    ],
    conclusions: {
      "-promote(marco)": {
        conclusion: "-promote(marco)",
        status: "Accepted",
        proof_chain: [
          { conclusion: "ethics_complaint(marco)", from: [], rule_id: null, rule_kind: "ordinary" },
          { conclusion: "-promote(marco)", from: ["ethics_complaint(marco)"], rule_id: "s1", rule_kind: "strict" },
        ],
      },
      "promote(luca)": {
        conclusion: "promote(luca)",
        status: "Accepted",
        proof_chain: [
          { conclusion: "consistent_performance(luca)", from: [], rule_id: null, rule_kind: "ordinary" },
          { conclusion: "strong_leadership(luca)", from: [], rule_id: null, rule_kind: "ordinary" },
          { conclusion: "promote(luca)", from: ["consistent_performance(luca)", "strong_leadership(luca)"], rule_id: "d4", rule_kind: "defeasible" },
        ],
      },
      "promote(sara)": {
        conclusion: "promote(sara)",
        status: "Undecided",
        proof_chain: [
          { conclusion: "high_quality(sara)", from: [], rule_id: null, rule_kind: "ordinary" },
          { conclusion: "promote(sara)", from: ["high_quality(sara)"], rule_id: "d2", rule_kind: "defeasible" },
        ],
      },
      "promote(marco)": {
        conclusion: "promote(marco)",
        status: "Rejected",
        proof_chain: [
          { conclusion: "high_sales(marco)", from: [], rule_id: null, rule_kind: "ordinary" },
          { conclusion: "promote(marco)", from: ["high_sales(marco)"], rule_id: "d1", rule_kind: "defeasible" },
        ],
      },
    },
  },
}
