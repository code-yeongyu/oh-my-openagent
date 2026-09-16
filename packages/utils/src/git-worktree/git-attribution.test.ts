import { beforeEach, describe, expect, it } from "bun:test"

import {
  clearGitAttributionCache,
  parseGitBoolean,
  resolveGitAttribution,
  shouldSuppressGitAttribution,
} from "./git-attribution"

describe("git attribution resolution", () => {
  beforeEach(() => {
    clearGitAttributionCache()
  })

  describe("parseGitBoolean", () => {
    it("parses falsy boolean variations", () => {
      expect(parseGitBoolean("false")).toBe(false)
      expect(parseGitBoolean("0")).toBe(false)
      expect(parseGitBoolean("no")).toBe(false)
      expect(parseGitBoolean("off")).toBe(false)
      expect(parseGitBoolean("FALSE")).toBe(false)
    })

    it("parses truthy boolean variations", () => {
      expect(parseGitBoolean("true")).toBe(true)
      expect(parseGitBoolean("1")).toBe(true)
      expect(parseGitBoolean("yes")).toBe(true)
      expect(parseGitBoolean("on")).toBe(true)
      expect(parseGitBoolean("TRUE")).toBe(true)
    })

    it("returns undefined for unrecognized or empty values", () => {
      expect(parseGitBoolean(undefined)).toBeUndefined()
      expect(parseGitBoolean("")).toBeUndefined()
      expect(parseGitBoolean("invalid")).toBeUndefined()
    })
  })

  describe("shouldSuppressGitAttribution", () => {
    it("suppresses attribution when NO_AI_ATTRIBUTION is set to 1", () => {
      const decision = shouldSuppressGitAttribution({
        env: { NO_AI_ATTRIBUTION: "1" },
        gitConfigReader: () => undefined,
      })
      expect(decision.suppressed).toBe(true)
      expect(decision.reason).toBe("env_disabled")
    })

    it("suppresses attribution when NO_AI_ATTRIBUTION is set to true", () => {
      const decision = shouldSuppressGitAttribution({
        env: { NO_AI_ATTRIBUTION: "true" },
        gitConfigReader: () => undefined,
      })
      expect(decision.suppressed).toBe(true)
    })

    it("does not suppress when NO_AI_ATTRIBUTION is set to 0", () => {
      const decision = shouldSuppressGitAttribution({
        env: { NO_AI_ATTRIBUTION: "0" },
        gitConfigReader: () => undefined,
      })
      expect(decision.suppressed).toBe(false)
    })

    it("suppresses attribution when OMO_NO_COMMIT_ATTRIBUTION is set", () => {
      const decision = shouldSuppressGitAttribution({
        env: { OMO_NO_COMMIT_ATTRIBUTION: "1" },
        gitConfigReader: () => undefined,
      })
      expect(decision.suppressed).toBe(true)
      expect(decision.reason).toBe("env_disabled")
    })

    it("suppresses attribution when OMO_GIT_ATTRIBUTION is 0", () => {
      const decision = shouldSuppressGitAttribution({
        env: { OMO_GIT_ATTRIBUTION: "0" },
        gitConfigReader: () => undefined,
      })
      expect(decision.suppressed).toBe(true)
      expect(decision.reason).toBe("env_disabled")
    })

    it("explicitly allows attribution when OMO_GIT_ATTRIBUTION is 1", () => {
      const decision = shouldSuppressGitAttribution({
        env: { OMO_GIT_ATTRIBUTION: "1" },
        gitConfigReader: () => "false", // Even if git config had false
      })
      expect(decision.suppressed).toBe(false)
    })

    it("suppresses attribution when git config omo.attribution is false", () => {
      const decision = shouldSuppressGitAttribution({
        env: {},
        gitConfigReader: (key) => (key === "omo.attribution" ? "false" : undefined),
      })
      expect(decision.suppressed).toBe(true)
      expect(decision.reason).toBe("git_config_disabled")
    })

    it("suppresses attribution when git config sisyphus.attribution is false", () => {
      const decision = shouldSuppressGitAttribution({
        env: {},
        gitConfigReader: (key) => (key === "sisyphus.attribution" ? "false" : undefined),
      })
      expect(decision.suppressed).toBe(true)
      expect(decision.reason).toBe("git_config_disabled")
    })

    it("does not suppress attribution when no override is set", () => {
      const decision = shouldSuppressGitAttribution({
        env: {},
        gitConfigReader: () => undefined,
      })
      expect(decision.suppressed).toBe(false)
      expect(decision.reason).toBe("default")
    })
  })

  describe("resolveGitAttribution", () => {
    it("resolves default enabled attribution when no overrides are set", () => {
      const result = resolveGitAttribution(undefined, {
        env: {},
        gitConfigReader: () => undefined,
      })
      expect(result.commitFooter).toBe(true)
      expect(result.includeCoAuthoredBy).toBe(true)
      expect(result.suppressed).toBe(false)
    })

    it("suppresses footers and trailers when git config omo.attribution is false", () => {
      const result = resolveGitAttribution(undefined, {
        env: {},
        gitConfigReader: (key) => (key === "omo.attribution" ? "false" : undefined),
      })
      expect(result.commitFooter).toBe(false)
      expect(result.includeCoAuthoredBy).toBe(false)
      expect(result.suppressed).toBe(true)
      expect(result.reason).toBe("git_config_disabled")
    })

    it("preserves custom string footer even when attribution is suppressed", () => {
      const result = resolveGitAttribution(
        { commit_footer: "Refs PROJ-1234" },
        {
          env: { NO_AI_ATTRIBUTION: "1" },
          gitConfigReader: () => undefined,
        },
      )
      expect(result.commitFooter).toBe("Refs PROJ-1234")
      expect(result.includeCoAuthoredBy).toBe(false)
      expect(result.suppressed).toBe(true)
    })

    it("resolves auto commit_footer to true when unsuppressed", () => {
      const result = resolveGitAttribution(
        { commit_footer: "auto" },
        {
          env: {},
          gitConfigReader: () => undefined,
        },
      )
      expect(result.commitFooter).toBe(true)
      expect(result.includeCoAuthoredBy).toBe(true)
      expect(result.suppressed).toBe(false)
    })

    it("resolves auto commit_footer to false when suppressed", () => {
      const result = resolveGitAttribution(
        { commit_footer: "auto" },
        {
          env: { NO_AI_ATTRIBUTION: "1" },
          gitConfigReader: () => undefined,
        },
      )
      expect(result.commitFooter).toBe(false)
      expect(result.includeCoAuthoredBy).toBe(false)
      expect(result.suppressed).toBe(true)
    })

    it("respects explicit false values in config", () => {
      const result = resolveGitAttribution(
        { commit_footer: false, include_co_authored_by: false },
        {
          env: {},
          gitConfigReader: () => undefined,
        },
      )
      expect(result.commitFooter).toBe(false)
      expect(result.includeCoAuthoredBy).toBe(false)
      expect(result.suppressed).toBe(false)
    })
  })
})
