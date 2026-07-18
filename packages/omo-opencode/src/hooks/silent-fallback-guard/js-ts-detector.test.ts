import { describe, expect, it } from "bun:test"
import { detectJsTsFallbacks } from "./detectors/js-ts"
import { normalizeDiffPatch, normalizeLine, type NormalizedLine } from "./normalize"

function normalized(raw: string, lineNumber = 1): NormalizedLine {
  const line = normalizeLine(raw, "typescript")
  return {
    raw,
    code: line.code,
    normalized: line.normalized,
    comment: line.comment,
    file: "src/example.ts",
    lineNumber,
    hunkContext: [],
  }
}

describe("JS/TS silent fallback detector operator classification", () => {
  it("emits a medium confidence default candidate for value fallback assignments", () => {
    const candidates = detectJsTsFallbacks([normalized('const name = user.name || "Anonymous"')])

    expect(candidates.length).toBe(1)
    expect(candidates[0].riskType).toBe("DEFAULT_VALUE")
    expect(candidates[0].confidence).toBe("medium")
    expect(candidates[0].raw).toBe('const name = user.name || "Anonymous"')
    expect(candidates[0].normalized).toBe("const name = user.name || <string>")
    expect(candidates[0].groupingKey).toMatch(/^DEFAULT_VALUE:/u)
  })

  it("emits a high confidence env fallback candidate", () => {
    const candidates = detectJsTsFallbacks([normalized('const url = process.env.API_URL || "http://localhost"')])

    expect(candidates.length).toBe(1)
    expect(candidates[0].riskType).toBe("ENV_FALLBACK")
    expect(candidates[0].confidence).toBe("high")
    expect(candidates[0].reason).toBe("Environment variable fallback introduces a default value.")
  })

  it("classifies boolean control flow as low confidence", () => {
    const candidates = detectJsTsFallbacks([normalized("if (isAdmin || isOwner) {")])

    expect(candidates.length).toBe(1)
    expect(candidates[0].riskType).toBe("DEFAULT_VALUE")
    expect(candidates[0].confidence).toBe("low")
  })

  it("classifies nullish operators and compound fallback assignments", () => {
    const candidates = detectJsTsFallbacks([
      normalized('const value = input ?? "unknown"', 1),
      normalized("options.timeout ??= 30", 2),
      normalized("cache.value ||= computeDefault()", 3),
    ])

    expect(candidates.map((candidate) => candidate.riskType)).toEqual([
      "NULLISH_FALLBACK",
      "NULLISH_FALLBACK",
      "DEFAULT_VALUE",
    ])
    expect(candidates.map((candidate) => candidate.confidence)).toEqual(["medium", "medium", "medium"])
  })

  it("detects default parameters and destructuring defaults", () => {
    const candidates = detectJsTsFallbacks([
      normalized('function f(name = "Anonymous") {', 1),
      normalized("const { count = 0 } = options", 2),
    ])

    expect(candidates.map((candidate) => candidate.riskType)).toEqual(["DEFAULT_VALUE", "DEFAULT_VALUE"])
    expect(candidates.map((candidate) => candidate.confidence)).toEqual(["medium", "medium"])
  })
})

describe("JS/TS silent fallback detector catch detection", () => {
  it("emits a high confidence catch return default candidate for single-line catches", () => {
    const candidates = detectJsTsFallbacks([normalized("catch { return [] }")])

    expect(candidates.length).toBe(1)
    expect(candidates[0].riskType).toBe("CATCH_RETURN_DEFAULT")
    expect(candidates[0].confidence).toBe("high")
    expect(candidates[0].line).toBe(1)
  })

  it("emits a high confidence error swallow candidate for empty catches", () => {
    const candidates = detectJsTsFallbacks([normalized("catch (e) {}")])

    expect(candidates.length).toBe(1)
    expect(candidates[0].riskType).toBe("ERROR_SWALLOW")
    expect(candidates[0].confidence).toBe("high")
  })

  it("uses bounded hunk context for adjacent catch return fallbacks", () => {
    const patch = [
      "diff --git a/src/example.ts b/src/example.ts",
      "--- a/src/example.ts",
      "+++ b/src/example.ts",
      "@@ -20,0 +20,4 @@",
      "+try {",
      "+  risky();",
      "+} catch (error) {",
      "+  return null;",
    ].join("\n")
    const candidates = detectJsTsFallbacks(normalizeDiffPatch(patch, { language: "typescript" }))

    expect(candidates.length).toBe(1)
    expect(candidates[0].riskType).toBe("CATCH_RETURN_DEFAULT")
    expect(candidates[0].confidence).toBe("high")
    expect(candidates[0].line).toBe(22)
    expect(candidates[0].raw).toMatch(/catch \(error\)/u)
    expect(candidates[0].raw).toMatch(/return null/u)
  })

  it("does not flag catch blocks that rethrow", () => {
    const candidates = detectJsTsFallbacks([normalized("catch (e) { throw e }")])

    expect(candidates.length).toBe(0)
  })
})
