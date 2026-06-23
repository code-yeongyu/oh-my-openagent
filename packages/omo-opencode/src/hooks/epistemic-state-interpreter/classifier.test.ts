import { describe, expect, it } from "bun:test"
import { classifyEpistemicState } from "./classifier.ts"
import type { ClassifierInput } from "./types.ts"

describe("classifyEpistemicState", () => {
  describe("#given Accepted status with strict proof chain in all extensions", () => {
    it("#when extensionsIn equals extensionsTotal #then returns accepted", () => {
      const input: ClassifierInput = {
        status: "Accepted",
        extensionsIn: 2,
        extensionsTotal: 2,
        proofChainKind: "strict",
        hasResidualDefeasibleSupport: false,
      }

      expect(classifyEpistemicState(input)).toBe("accepted")
    })

    it("#when a strict proof chain spans all extensions with more than one extension #then returns accepted", () => {
      const input: ClassifierInput = {
        status: "Accepted",
        extensionsIn: 5,
        extensionsTotal: 5,
        proofChainKind: "strict",
        hasResidualDefeasibleSupport: false,
      }

      expect(classifyEpistemicState(input)).toBe("accepted")
    })
  })

  describe("#given Accepted status with defeasible support in most extensions", () => {
    it("#when ratio is above the threshold #then returns plausible", () => {
      const input: ClassifierInput = {
        status: "Accepted",
        extensionsIn: 4,
        extensionsTotal: 5,
        proofChainKind: "defeasible",
        hasResidualDefeasibleSupport: false,
      }

      expect(classifyEpistemicState(input)).toBe("plausible")
    })

    it("#when ratio equals the threshold #then returns plausible", () => {
      const input: ClassifierInput = {
        status: "Accepted",
        extensionsIn: 8,
        extensionsTotal: 10,
        proofChainKind: "mixed",
        hasResidualDefeasibleSupport: false,
      }

      expect(classifyEpistemicState(input)).toBe("plausible")
    })
  })

  describe("#given Accepted status with weak support or split extensions", () => {
    it("#when ratio is below the threshold #then returns open", () => {
      const input: ClassifierInput = {
        status: "Accepted",
        extensionsIn: 7,
        extensionsTotal: 10,
        proofChainKind: "defeasible",
        hasResidualDefeasibleSupport: false,
      }

      expect(classifyEpistemicState(input)).toBe("open")
    })

    it("#when total extensions are zero #then returns open", () => {
      const input: ClassifierInput = {
        status: "Accepted",
        extensionsIn: 0,
        extensionsTotal: 0,
        proofChainKind: "unknown",
        hasResidualDefeasibleSupport: false,
      }

      expect(classifyEpistemicState(input)).toBe("open")
    })
  })

  describe("#given Undecided status", () => {
    it("#when the conclusion is undecided #then returns open", () => {
      const input: ClassifierInput = {
        status: "Undecided",
        extensionsIn: 1,
        extensionsTotal: 2,
        proofChainKind: "unknown",
        hasResidualDefeasibleSupport: false,
      }

      expect(classifyEpistemicState(input)).toBe("open")
    })

    it("#when the conclusion is undecided with no extensions #then returns open", () => {
      const input: ClassifierInput = {
        status: "Undecided",
        extensionsIn: 0,
        extensionsTotal: 0,
        proofChainKind: "unknown",
        hasResidualDefeasibleSupport: false,
      }

      expect(classifyEpistemicState(input)).toBe("open")
    })
  })

  describe("#given Rejected status with residual defeasible support", () => {
    it("#when rejected conclusion still has defeasible support #then returns operationally_excluded", () => {
      const input: ClassifierInput = {
        status: "Rejected",
        extensionsIn: 0,
        extensionsTotal: 3,
        proofChainKind: "defeasible",
        hasResidualDefeasibleSupport: true,
      }

      expect(classifyEpistemicState(input)).toBe("operationally_excluded")
    })

    it("#when rejected conclusion has mixed residual support #then returns operationally_excluded", () => {
      const input: ClassifierInput = {
        status: "Rejected",
        extensionsIn: 1,
        extensionsTotal: 4,
        proofChainKind: "mixed",
        hasResidualDefeasibleSupport: true,
      }

      expect(classifyEpistemicState(input)).toBe("operationally_excluded")
    })
  })

  describe("#given Rejected status without residual defeasible support", () => {
    it("#when rejection is supported only by premises #then returns excluded", () => {
      const input: ClassifierInput = {
        status: "Rejected",
        extensionsIn: 0,
        extensionsTotal: 3,
        proofChainKind: "unknown",
        hasResidualDefeasibleSupport: false,
      }

      expect(classifyEpistemicState(input)).toBe("excluded")
    })

    it("#when rejection is strict and no defeasible support remains #then returns excluded", () => {
      const input: ClassifierInput = {
        status: "Rejected",
        extensionsIn: 0,
        extensionsTotal: 2,
        proofChainKind: "strict",
        hasResidualDefeasibleSupport: false,
      }

      expect(classifyEpistemicState(input)).toBe("excluded")
    })
  })

  describe("#given undefined or unrecognized status", () => {
    it("#when status is undefined #then returns open", () => {
      const input: ClassifierInput = {
        status: undefined,
        extensionsIn: 0,
        extensionsTotal: 1,
        proofChainKind: "unknown",
        hasResidualDefeasibleSupport: false,
      }

      expect(classifyEpistemicState(input)).toBe("open")
    })

    it("#when status is unrecognized #then returns open", () => {
      const input: ClassifierInput = {
        status: "Pending",
        extensionsIn: 2,
        extensionsTotal: 3,
        proofChainKind: "unknown",
        hasResidualDefeasibleSupport: false,
      }

      expect(classifyEpistemicState(input)).toBe("open")
    })
  })
})
