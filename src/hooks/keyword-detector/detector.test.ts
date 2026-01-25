import { describe, test, expect } from "bun:test"
import { detectKeywordsWithType } from "./detector"
import { KEYWORD_DETECTORS } from "./constants"

describe("detectKeywordsWithType", () => {
  test("types array length matches KEYWORD_DETECTORS length (sync check)", () => {
    // #given - various keyword inputs
    const ultraworkResult = detectKeywordsWithType("ultrawork")
    const searchResult = detectKeywordsWithType("search for")
    const analyzeResult = detectKeywordsWithType("analyze this")
    const debugResult = detectKeywordsWithType("debug this")

    // #then - each keyword type is detected correctly
    expect(ultraworkResult).toHaveLength(1)
    expect(ultraworkResult[0].type).toBe("ultrawork")

    expect(searchResult).toHaveLength(1)
    expect(searchResult[0].type).toBe("search")

    expect(analyzeResult).toHaveLength(1)
    expect(analyzeResult[0].type).toBe("analyze")

    expect(debugResult).toHaveLength(1)
    expect(debugResult[0].type).toBe("debug")

    expect(KEYWORD_DETECTORS.length).toBe(4)
  })

  test("'debug' triggers debug-mode only, not analyze-mode", () => {
    // #given - input with debug keyword
    const result = detectKeywordsWithType("debug this issue")

    // #then - only debug-mode is triggered
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe("debug")
    expect(result[0].message).toContain("[debug-mode]")
  })

  test("'analyze' triggers analyze-mode only, not debug-mode", () => {
    // #given - input with analyze keyword
    const result = detectKeywordsWithType("analyze the performance")

    // #then - only analyze-mode is triggered
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe("analyze")
    expect(result[0].message).toContain("[analyze-mode]")
  })

  test("multilingual debug keywords trigger debug-mode", () => {
    // #given - multilingual debug keywords
    for (const word of ["디버그", "デバッグ", "调试", "gỡ lỗi"]) {
      // #when - detecting keywords
      const result = detectKeywordsWithType(word)

      // #then - debug-mode is triggered
      expect(result.some(r => r.type === "debug")).toBe(true)
    }
  })
})
