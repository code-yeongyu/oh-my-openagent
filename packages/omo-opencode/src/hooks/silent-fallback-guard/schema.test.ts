import { describe, expect, it } from "bun:test"
import {
  defaultSilentFallbackGuardConfig,
  resolveSilentFallbackGuardConfig,
} from "./config"
import type {
  FallbackCandidate,
  FallbackConfidence,
  FallbackDecision,
  FallbackReviewRecord,
  FallbackRiskType,
  GuardFailOpenStatus,
} from "./types"

const riskTypes: FallbackRiskType[] = [
  "DEFAULT_VALUE",
  "NULLISH_FALLBACK",
  "ERROR_SWALLOW",
  "CATCH_RETURN_DEFAULT",
  "OPTIONAL_DEGRADATION",
  "COMPAT_SHIM",
  "ENV_FALLBACK",
  "BEST_EFFORT",
  "SILENT_RETRY_OR_IGNORE",
]

describe("silent fallback guard schema", () => {
  it("supports all required risk types", () => {
    expect(riskTypes).toEqual([
      "DEFAULT_VALUE",
      "NULLISH_FALLBACK",
      "ERROR_SWALLOW",
      "CATCH_RETURN_DEFAULT",
      "OPTIONAL_DEGRADATION",
      "COMPAT_SHIM",
      "ENV_FALLBACK",
      "BEST_EFFORT",
      "SILENT_RETRY_OR_IGNORE",
    ])
  })

  it("instantiates a candidate with raw and normalized snippets", () => {
    const confidence: FallbackConfidence = "high"
    const candidate: FallbackCandidate = {
      file: "src/example.ts",
      line: 12,
      language: "typescript",
      riskType: "NULLISH_FALLBACK",
      confidence,
      raw: 'const value = input ?? "unknown";',
      normalized: 'const value = input ?? "unknown";',
      reason: "Nullish fallback introduced in changed code.",
      groupingKey: "src/example.ts:12:NULLISH_FALLBACK",
      commentContext: "No nearby comment explains the fallback.",
    }

    expect(candidate.file).toBe("src/example.ts")
    expect(candidate.line).toBe(12)
    expect(candidate.language).toBe("typescript")
    expect(candidate.riskType).toBe("NULLISH_FALLBACK")
    expect(candidate.confidence).toBe("high")
    expect(candidate.raw).toBe('const value = input ?? "unknown";')
    expect(candidate.normalized).toBe('const value = input ?? "unknown";')
    expect(candidate.reason).toBe("Nullish fallback introduced in changed code.")
    expect(candidate.groupingKey).toBe("src/example.ts:12:NULLISH_FALLBACK")
    expect(candidate.commentContext).toBe("No nearby comment explains the fallback.")
  })

  it("supports confidence, decision, and fail-open status values", () => {
    const confidences: FallbackConfidence[] = ["high", "medium", "low"]
    const decisions: FallbackDecision[] = ["KEEP", "REMOVE", "USER_DECISION", "SKIPPED_BUDGET"]
    const statuses: GuardFailOpenStatus[] = [
      "DIFF_UNAVAILABLE",
      "HOOK_ERROR",
      "UNSUPPORTED_LANGUAGE",
      "SATURATED",
    ]

    expect(confidences).toEqual(["high", "medium", "low"])
    expect(decisions).toEqual(["KEEP", "REMOVE", "USER_DECISION", "SKIPPED_BUDGET"])
    expect(statuses).toEqual(["DIFF_UNAVAILABLE", "HOOK_ERROR", "UNSUPPORTED_LANGUAGE", "SATURATED"])
  })

  it("instantiates a review record without treating detection as a verdict", () => {
    const candidate: FallbackCandidate = {
      file: "src/example.py",
      line: 4,
      language: "python",
      riskType: "CATCH_RETURN_DEFAULT",
      confidence: "medium",
      raw: "except Exception:\n    return []",
      normalized: "except exception: return []",
      reason: "Catch block returns a default value.",
      groupingKey: "src/example.py:4:CATCH_RETURN_DEFAULT",
    }
    const record: FallbackReviewRecord = {
      candidate,
      decision: "USER_DECISION",
      justification: "Context is insufficient to classify the fallback as necessary or removable.",
      contextSources: ["git diff", "nearby code"],
    }

    expect(record.candidate.raw).toBe("except Exception:\n    return []")
    expect(record.decision).toBe("USER_DECISION")
    expect(record.contextSources).toEqual(["git diff", "nearby code"])
  })
})

describe("silent fallback guard config", () => {
  it("uses safe disabled-by-default values", () => {
    const config = defaultSilentFallbackGuardConfig()

    expect(config.enabled).toBe(false)
    expect(config.mode).toBe("report")
    expect(config.maxReviewCandidates).toBe(20)
    expect(config.maxPerFile).toBe(5)
    expect(config.maxPerRiskType).toBe(8)
    expect(config.includeLowConfidence).toBe(false)
    expect(config.supportedLanguages).toEqual(["javascript", "typescript", "python"])
  })

  it("merges guard-specific opt-in values over defaults", () => {
    const config = resolveSilentFallbackGuardConfig({
      enabled: true,
      mode: "pushback",
      maxReviewCandidates: 3,
      supportedLanguages: ["typescript"],
    })

    expect(config.enabled).toBe(true)
    expect(config.mode).toBe("pushback")
    expect(config.maxReviewCandidates).toBe(3)
    expect(config.maxPerFile).toBe(5)
    expect(config.maxPerRiskType).toBe(8)
    expect(config.includeLowConfidence).toBe(false)
    expect(config.supportedLanguages).toEqual(["typescript"])
  })
})
