import { describe, expect, it } from "bun:test"
import { VP_PROMOTION_PROOF_ARTIFACT } from "./proof-artifact-parser.fixtures"
import { parseProofArtifact, parseProofChainKind } from "./proof-artifact-parser.ts"

describe("parseProofArtifact", () => {
  describe("#given a valid vp_promotion proof artifact", () => {
    it("#when parsing the full artifact #then returns extensionCount and conclusions", () => {
      const result = parseProofArtifact(VP_PROMOTION_PROOF_ARTIFACT)

      expect(result?.extensionCount).toBe(2)
      expect(result?.conclusions.size).toBe(4)
    })

    it("#when parsing -promote(marco) #then returns strict kind and two extensions", () => {
      const result = parseProofArtifact(VP_PROMOTION_PROOF_ARTIFACT)
      const conclusion = result?.conclusions.get("-promote(marco)")

      expect(conclusion).toEqual({
        status: "Accepted",
        proofChainKind: "strict",
        hasResidualDefeasibleSupport: false,
        extensionsIn: 2,
        rebuttedConclusions: [],
        underminedPremises: [],
        undercutRules: [],
      })
    })

    it("#when parsing promote(luca) #then returns defeasible kind and two extensions", () => {
      const result = parseProofArtifact(VP_PROMOTION_PROOF_ARTIFACT)
      const conclusion = result?.conclusions.get("promote(luca)")

      expect(conclusion).toEqual({
        status: "Accepted",
        proofChainKind: "defeasible",
        hasResidualDefeasibleSupport: false,
        extensionsIn: 2,
        rebuttedConclusions: [],
        underminedPremises: [],
        undercutRules: [],
      })
    })

    it("#when parsing promote(sara) #then returns one extension", () => {
      const result = parseProofArtifact(VP_PROMOTION_PROOF_ARTIFACT)
      const conclusion = result?.conclusions.get("promote(sara)")

      expect(conclusion).toEqual({
        status: "Undecided",
        proofChainKind: "defeasible",
        hasResidualDefeasibleSupport: false,
        extensionsIn: 1,
        rebuttedConclusions: [],
        underminedPremises: [],
        undercutRules: [],
      })
    })

    it("#when parsing promote(marco) #then returns rejected with residual defeasible support", () => {
      const result = parseProofArtifact(VP_PROMOTION_PROOF_ARTIFACT)
      const conclusion = result?.conclusions.get("promote(marco)")

      expect(conclusion).toEqual({
        status: "Rejected",
        proofChainKind: "defeasible",
        hasResidualDefeasibleSupport: true,
        extensionsIn: 0,
        rebuttedConclusions: [],
        underminedPremises: [],
        undercutRules: [],
      })
    })

    it("#when parsing attacks metadata #then separates rebuttals, undermines, and undercuts", () => {
      const result = parseProofArtifact({
        conclusions: {
          "promote(marco)": {
            status: "Rejected",
            proof_chain: [
              { conclusion: "high_sales(marco)", from: [], rule_id: null, rule_kind: "ordinary" },
              { conclusion: "promote(marco)", from: ["high_sales(marco)"], rule_id: "d1", rule_kind: "defeasible" },
            ],
            attacks: [
              { kind: "rebut", target: "-promote(marco)" },
              { kind: "undermine", target: "high_sales(marco)" },
              { kind: "undermine", target: "high_sales(marco)" },
              { kind: "undercut", undercut_rule: "d1" },
              { kind: "undercut", undercut_rule: "d1" },
            ],
          },
        },
        extensions: [],
      })

      expect(result?.conclusions.get("promote(marco)")).toEqual({
        status: "Rejected",
        proofChainKind: "defeasible",
        hasResidualDefeasibleSupport: true,
        extensionsIn: 0,
        rebuttedConclusions: ["-promote(marco)"],
        underminedPremises: ["high_sales(marco)"],
        undercutRules: ["d1"],
      })
    })
  })

  describe("#given invalid or incomplete input", () => {
    it("#when input is null #then returns null", () => {
      expect(parseProofArtifact(null)).toEqual(null)
    })

    it("#when input is undefined #then returns null", () => {
      expect(parseProofArtifact(undefined)).toEqual(null)
    })

    it("#when input is an empty object #then returns null", () => {
      expect(parseProofArtifact({})).toEqual(null)
    })

    it("#when result is null #then returns null", () => {
      expect(parseProofArtifact({ result: null })).toEqual(null)
    })

    it("#when conclusions are empty #then returns an empty Map", () => {
      const result = parseProofArtifact({
        theory: {},
        result: { semantics: "preferred", extensions: [{ index: 0, accepted_conclusions: [] }], conclusions: {} },
      })

      expect(result?.extensionCount).toBe(1)
      expect(result?.conclusions).toEqual(new Map())
    })

    it("#when extensions are empty #then returns zero extension count and zero extension membership", () => {
      const result = parseProofArtifact({
        theory: {},
        result: {
          semantics: "preferred",
          extensions: [],
          conclusions: {
            sample: {
              status: "Accepted",
              proof_chain: [{ conclusion: "premise", from: [], rule_id: null, rule_kind: "ordinary" }],
            },
          },
        },
      })

      expect(result?.extensionCount).toBe(0)
      expect(result?.conclusions.get("sample")?.extensionsIn).toBe(0)
    })

    it("#when proof chain has only ordinary steps #then returns unknown kind", () => {
      const result = parseProofArtifact({
        theory: {},
        result: {
          semantics: "preferred",
          extensions: [{ index: 0, accepted_conclusions: ["sample"] }],
          conclusions: {
            sample: {
              status: "Accepted",
              proof_chain: [
                { conclusion: "premise", from: [], rule_id: null, rule_kind: "ordinary" },
                { conclusion: "sample", from: ["premise"], rule_id: null, rule_kind: "ordinary" },
              ],
            },
          },
        },
      })

      expect(result?.conclusions.get("sample")?.proofChainKind).toBe("unknown")
    })

    it("#when proof chain is undefined #then parseProofChainKind returns unknown", () => {
      expect(parseProofChainKind(undefined)).toBe("unknown")
    })

    it("#when proof_chain is missing #then parseProofArtifact still returns a parsed artifact", () => {
      const result = parseProofArtifact({
        theory: {},
        result: {
          semantics: "preferred",
          extensions: [{ index: 0, accepted_conclusions: ["sample"] }],
          conclusions: {
            sample: {
              status: "Accepted",
            },
          },
        },
      })

      expect(result).not.toBeNull()
      expect(result?.conclusions.get("sample")).toEqual({
        status: "Accepted",
        proofChainKind: "unknown",
        hasResidualDefeasibleSupport: false,
        extensionsIn: 1,
        rebuttedConclusions: [],
        underminedPremises: [],
        undercutRules: [],
      })
    })
  })
})
