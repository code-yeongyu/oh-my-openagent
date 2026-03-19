import { describe, test, expect } from "bun:test"
import { detectKeywordsWithType } from "./detector"
import { KEYWORD_DETECTORS } from "./constants"

describe("detectKeywordsWithType", () => {
  test("'debug' triggers debug-mode only, not analyze-mode", () => {
    const result = detectKeywordsWithType("debug this issue")

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe("debug")
    expect(result[0].message).toContain("[debug-mode]")
    expect(KEYWORD_DETECTORS).toHaveLength(4)
  })

  test("'analyze' triggers analyze-mode only, not debug-mode", () => {
    const result = detectKeywordsWithType("analyze the performance")

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe("analyze")
    expect(result[0].message).toContain("[analyze-mode]")
  })

  test("multilingual debug keywords trigger debug-mode", () => {
    for (const word of ["디버그", "デバッグ", "调试", "gỡ lỗi"]) {
      const result = detectKeywordsWithType(word)
      expect(result.some(r => r.type === "debug")).toBe(true)
    }
  })
})
