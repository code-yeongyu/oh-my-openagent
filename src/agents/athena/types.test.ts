import { describe, expect, it } from "bun:test"

import {
  buildCouncilFailureMetadataContract,
  buildNonInteractiveModeValidationLines,
  buildQuorumRulesContract,
  buildRetryRulesContract,
  createQuorumRules,
  createRetryRules,
  describeCouncilFailure,
  resolveAthenaNonInteractiveMode,
  validateAthenaNonInteractiveMode,
  type CouncilFailure,
} from "./types"

describe("Athena failure metadata", () => {
  describe("#given a network failure", () => {
    describe("#when describing the failure", () => {
      it("#then includes retryability details", () => {
        const failure: CouncilFailure = {
          type: "network_error",
          failure_type: "network_error",
          message: "upstream launch failed",
          retryable: true,
        }

        expect(describeCouncilFailure(failure)).toContain("retryable")
      })
    })
  })

  describe("#given a timeout failure", () => {
    describe("#when describing the failure", () => {
      it("#then includes duration and threshold", () => {
        const failure: CouncilFailure = {
          type: "timeout_error",
          failure_type: "timeout_error",
          duration: 120,
          threshold: 90,
        }

        expect(describeCouncilFailure(failure)).toContain("120s")
        expect(describeCouncilFailure(failure)).toContain("90s")
      })
    })
  })

  describe("#given a validation failure", () => {
    describe("#when describing the failure", () => {
      it("#then includes field and value details", () => {
        const failure: CouncilFailure = {
          type: "validation_error",
          failure_type: "validation_error",
          field: "non_interactive_mode",
          value: "invalid",
        }

        expect(describeCouncilFailure(failure)).toContain("non_interactive_mode")
        expect(describeCouncilFailure(failure)).toContain("invalid")
      })
    })
  })

  describe("#given a quorum failure", () => {
    describe("#when describing the failure", () => {
      it("#then includes current and required responses", () => {
        const failure: CouncilFailure = {
          type: "quorum_error",
          failure_type: "quorum_error",
          responses: 1,
          required: 2,
        }

        expect(describeCouncilFailure(failure)).toContain("1/2")
      })
    })
  })

  describe("#given the prompt failure metadata contract", () => {
    describe("#when building the contract text", () => {
      it("#then includes every discriminated failure type", () => {
        const contract = buildCouncilFailureMetadataContract()

        expect(contract).toContain("network_error")
        expect(contract).toContain("timeout_error")
        expect(contract).toContain("validation_error")
        expect(contract).toContain("quorum_error")
        expect(contract).toContain("failure_type")
      })
    })
  })
})

describe("Athena non-interactive mode validation", () => {
  describe("#when validating a raw mode", () => {
    it("#then preserves delegation mode explicitly", () => {
      expect(validateAthenaNonInteractiveMode("delegation")).toBe("delegation")
    })

    it("#then preserves solo mode explicitly", () => {
      expect(validateAthenaNonInteractiveMode("solo")).toBe("solo")
    })

    it("#then throws for an invalid mode", () => {
      expect(() => validateAthenaNonInteractiveMode("invalid")).toThrow("Invalid mode: invalid")
    })
  })

  describe("#when resolving the configured mode", () => {
    it("#then defaults to delegation when undefined", () => {
      expect(resolveAthenaNonInteractiveMode(undefined)).toBe("delegation")
    })

    it("#then preserves delegation mode explicitly", () => {
      expect(resolveAthenaNonInteractiveMode("delegation")).toBe("delegation")
    })

    it("#then preserves solo mode explicitly", () => {
      expect(resolveAthenaNonInteractiveMode("solo")).toBe("solo")
    })
  })

  describe("#when building validation instructions", () => {
    it("#then includes exhaustive mappings for delegation and solo", () => {
      const validationLines = buildNonInteractiveModeValidationLines()

      expect(validationLines).toContain('"delegation" -> mode: "delegation"')
      expect(validationLines).toContain('"solo" -> mode: "solo"')
    })
  })
})

describe("Athena structured retry and quorum rules", () => {
  describe("#when creating retry rules", () => {
    it("#then returns the structured retry shape", () => {
      expect(createRetryRules(3)).toEqual({
        maxRetries: 3,
        backoffMultiplier: 2,
        retryableErrors: ["network_error", "timeout_error"],
      })
    })
  })

  describe("#when creating quorum rules", () => {
    it("#then returns the structured quorum shape", () => {
      expect(createQuorumRules({ minResponses: 2, timeoutSeconds: 900 })).toEqual({
        threshold: 0.6,
        minResponses: 2,
        timeoutSeconds: 900,
      })
    })
  })

  describe("#when building the prompt contracts", () => {
    it("#then includes retry rule keys", () => {
      const contract = buildRetryRulesContract()

      expect(contract).toContain("maxRetries")
      expect(contract).toContain("backoffMultiplier")
      expect(contract).toContain("retryableErrors")
    })

    it("#then includes quorum rule keys", () => {
      const contract = buildQuorumRulesContract()

      expect(contract).toContain("threshold")
      expect(contract).toContain("minResponses")
      expect(contract).toContain("timeoutSeconds")
    })
  })
})
