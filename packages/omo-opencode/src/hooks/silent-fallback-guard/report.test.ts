import { describe, expect, it } from "bun:test"
import {
  applyReviewBudget,
  buildReviewerPrompt,
  buildSaturationSummary,
} from "./report"
import type { FallbackCandidate, SilentFallbackGuardConfig } from "./types"

function candidate(overrides: Partial<FallbackCandidate> = {}): FallbackCandidate {
  return {
    file: "src/example.ts",
    line: 1,
    language: "typescript",
    riskType: "DEFAULT_VALUE",
    confidence: "medium",
    raw: 'const x = y || "z";',
    normalized: "const x = y || <string>",
    reason: "Logical-or fallback introduces a default value.",
    groupingKey: "DEFAULT_VALUE:const x = y || <string>",
    ...overrides,
  }
}

function config(overrides: Partial<SilentFallbackGuardConfig> = {}): SilentFallbackGuardConfig {
  return {
    enabled: true,
    mode: "pushback",
    maxReviewCandidates: 20,
    maxPerFile: 5,
    maxPerRiskType: 8,
    includeLowConfidence: false,
    supportedLanguages: ["javascript", "typescript", "python"],
    ...overrides,
  }
}

describe("Silent Fallback Guard report", () => {
  describe("applyReviewBudget", () => {
    it("selects high and medium confidence candidates", () => {
      const candidates = [
        candidate({ confidence: "high", riskType: "ENV_FALLBACK" }),
        candidate({ confidence: "medium" }),
        candidate({ confidence: "low" }),
      ]
      const result = applyReviewBudget(candidates, config())
      expect(result.selected.length).toBe(2)
      expect(result.skipped.length).toBe(1)
      expect(result.skipped[0].confidence).toBe("low")
      expect(result.saturation).toBe(false)
    })

    it("respects maxReviewCandidates and reports saturation", () => {
      const candidates = Array.from({ length: 25 }, (_, index) =>
        candidate({
          file: `src/${index}.ts`,
          line: index + 1,
          riskType: index % 2 === 0 ? "DEFAULT_VALUE" : "ERROR_SWALLOW",
          confidence: "high",
        }),
      )
      const result = applyReviewBudget(
        candidates,
        config({ maxReviewCandidates: 20, maxPerFile: 1, maxPerRiskType: 20 }),
      )
      expect(result.selected.length).toBe(20)
      expect(result.skipped.length).toBe(5)
      expect(result.saturation).toBe(true)
    })

    it("respects maxPerFile and maxPerRiskType", () => {
      const candidates = [
        candidate({ file: "src/a.ts", line: 1, riskType: "DEFAULT_VALUE", confidence: "high" }),
        candidate({ file: "src/a.ts", line: 2, riskType: "DEFAULT_VALUE", confidence: "high" }),
        candidate({ file: "src/a.ts", line: 3, riskType: "DEFAULT_VALUE", confidence: "high" }),
        candidate({ file: "src/a.ts", line: 4, riskType: "DEFAULT_VALUE", confidence: "high" }),
        candidate({ file: "src/a.ts", line: 5, riskType: "DEFAULT_VALUE", confidence: "high" }),
        candidate({ file: "src/a.ts", line: 6, riskType: "DEFAULT_VALUE", confidence: "high" }),
        candidate({ file: "src/b.ts", line: 1, riskType: "ERROR_SWALLOW", confidence: "high" }),
        candidate({ file: "src/b.ts", line: 2, riskType: "ERROR_SWALLOW", confidence: "high" }),
        candidate({ file: "src/b.ts", line: 3, riskType: "ERROR_SWALLOW", confidence: "high" }),
        candidate({ file: "src/b.ts", line: 4, riskType: "ERROR_SWALLOW", confidence: "high" }),
      ]
      const result = applyReviewBudget(
        candidates,
        config({ maxPerFile: 4, maxPerRiskType: 4 }),
      )
      expect(result.selected.filter((c) => c.file === "src/a.ts").length).toBe(4)
      expect(result.selected.filter((c) => c.riskType === "ERROR_SWALLOW").length).toBe(4)
      expect(result.saturation).toBe(true)
    })

    it("includes low confidence candidates when configured", () => {
      const candidates = [candidate({ confidence: "low" })]
      const result = applyReviewBudget(candidates, config({ includeLowConfidence: true }))
      expect(result.selected.length).toBe(1)
      expect(result.skipped.length).toBe(0)
    })
  })

  describe("buildReviewerPrompt", () => {
    it("includes checklist, candidate details, and numbered options", () => {
      const selected = [candidate({ confidence: "high", riskType: "ENV_FALLBACK" })]
      const report = {
        timestamp: new Date().toISOString(),
        diffHash: "abc123",
        mode: "pushback" as const,
        candidates: selected,
        selected,
        skipped: [],
        saturation: false,
      }
      const prompt = buildReviewerPrompt(report)
      expect(prompt).toInclude("Silent Fallback Guard Review")
      expect(prompt).toInclude("Review checklist")
      expect(prompt).toInclude("KEEP / REMOVE / USER_DECISION")
      expect(prompt).toInclude("1. Remove fallback")
      expect(prompt).toInclude("2. Keep fallback")
      expect(prompt).toInclude("3. Replace with explicit quarantine")
      expect(prompt).toInclude("const x = y ||")
    })

    it("reports saturation when budget exceeded", () => {
      const report = {
        timestamp: new Date().toISOString(),
        diffHash: "abc123",
        mode: "report" as const,
        candidates: [],
        selected: [],
        skipped: [],
        saturation: true,
      }
      const prompt = buildReviewerPrompt(report)
      expect(prompt).toInclude("SATURATION")
    })
  })

  describe("buildSaturationSummary", () => {
    it("summarizes selected and skipped counts", () => {
      const report = {
        timestamp: new Date().toISOString(),
        diffHash: "abc123",
        mode: "report" as const,
        candidates: Array.from({ length: 30 }, (_, i) => candidate({ line: i + 1 })),
        selected: Array.from({ length: 20 }, (_, i) => candidate({ line: i + 1 })),
        skipped: Array.from({ length: 10 }, (_, i) => candidate({ line: i + 21 })),
        saturation: true,
      }
      const summary = buildSaturationSummary(report)
      expect(summary).toInclude("Reviewed 20 of 30 candidates")
      expect(summary).toInclude("Skipped 10 candidates")
    })
  })
})
