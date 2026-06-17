import { describe, expect, it } from "bun:test"
import { detectPythonFallbacks } from "./detectors/python"
import { normalizeDiffPatch, normalizeLine, type NormalizedLine } from "./normalize"

function normalized(raw: string, lineNumber = 1): NormalizedLine {
  const line = normalizeLine(raw, "python")
  return {
    raw,
    code: line.code,
    normalized: line.normalized,
    comment: line.comment,
    file: "src/example.py",
    lineNumber,
    hunkContext: [],
  }
}

describe("Python silent fallback detector default detection", () => {
  it("emits a high confidence env fallback candidate for os.getenv or default", () => {
    const candidates = detectPythonFallbacks([normalized('timeout = os.getenv("TIMEOUT") or 30')])

    expect(candidates.length).toBe(1)
    expect(candidates[0].riskType).toBe("ENV_FALLBACK")
    expect(candidates[0].confidence).toBe("high")
    expect(candidates[0].raw).toBe('timeout = os.getenv("TIMEOUT") or 30')
    expect(candidates[0].normalized).toBe("timeout = os.getenv(<string>) or 30")
    expect(candidates[0].groupingKey).toMatch(/^ENV_FALLBACK:/u)
  })

  it("emits a medium confidence default candidate for dict get defaults", () => {
    const candidates = detectPythonFallbacks([normalized('value = row.get("field", "unknown")')])

    expect(candidates.length).toBe(1)
    expect(candidates[0].riskType).toBe("DEFAULT_VALUE")
    expect(candidates[0].confidence).toBe("medium")
    expect(candidates[0].reason).toBe("Lookup call supplies a default value.")
  })

  it("detects getattr, os.getenv defaults, return-or defaults, and default parameters", () => {
    const candidates = detectPythonFallbacks([
      normalized('name = getattr(user, "name", "unknown")', 1),
      normalized('region = os.getenv("REGION", "us-east-1")', 2),
      normalized("return value or []", 3),
      normalized("def f(x=None):", 4),
    ])

    expect(candidates.map((candidate) => candidate.riskType)).toEqual([
      "DEFAULT_VALUE",
      "ENV_FALLBACK",
      "DEFAULT_VALUE",
      "DEFAULT_VALUE",
    ])
    expect(candidates.map((candidate) => candidate.confidence)).toEqual(["medium", "high", "medium", "medium"])
  })

  it("classifies boolean control flow as low confidence", () => {
    const candidates = detectPythonFallbacks([normalized("if is_admin or is_owner:")])

    expect(candidates.length).toBe(1)
    expect(candidates[0].riskType).toBe("DEFAULT_VALUE")
    expect(candidates[0].confidence).toBe("low")
  })
})

describe("Python silent fallback detector exception detection", () => {
  it("emits a high confidence catch return default candidate for single-line except returns", () => {
    const candidates = detectPythonFallbacks([normalized("except Exception: return []")])

    expect(candidates.length).toBe(1)
    expect(candidates[0].riskType).toBe("CATCH_RETURN_DEFAULT")
    expect(candidates[0].confidence).toBe("high")
    expect(candidates[0].line).toBe(1)
  })

  it("emits a high confidence error swallow candidate for bare except pass", () => {
    const candidates = detectPythonFallbacks([normalized("except: pass")])

    expect(candidates.length).toBe(1)
    expect(candidates[0].riskType).toBe("ERROR_SWALLOW")
    expect(candidates[0].confidence).toBe("high")
  })

  it("emits a high confidence error swallow candidate for broad Exception pass", () => {
    const candidates = detectPythonFallbacks([normalized("except Exception: pass")])

    expect(candidates.length).toBe(1)
    expect(candidates[0].riskType).toBe("ERROR_SWALLOW")
    expect(candidates[0].confidence).toBe("high")
  })

  it("uses bounded hunk context for adjacent except return defaults", () => {
    const patch = [
      "diff --git a/src/example.py b/src/example.py",
      "--- a/src/example.py",
      "+++ b/src/example.py",
      "@@ -20,0 +20,4 @@",
      "+try:",
      "+    risky()",
      "+except Exception:",
      "+    return None",
    ].join("\n")
    const candidates = detectPythonFallbacks(normalizeDiffPatch(patch, { language: "python" }))

    expect(candidates.length).toBe(1)
    expect(candidates[0].riskType).toBe("CATCH_RETURN_DEFAULT")
    expect(candidates[0].confidence).toBe("high")
    expect(candidates[0].line).toBe(22)
    expect(candidates[0].raw).toMatch(/except Exception:/u)
    expect(candidates[0].raw).toMatch(/return None/u)
  })

  it("does not flag except blocks that re-raise", () => {
    const candidates = detectPythonFallbacks([normalized("except Exception: raise")])

    expect(candidates.length).toBe(0)
  })
})
