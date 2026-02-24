import { describe, expect, it, mock, beforeEach } from "bun:test"
import type { AnalyzeResult, CliMatch, SgResult } from "./types"
import { formatAnalyzeResult, formatReplaceResult, formatSearchResult } from "./result-formatter"

const encodeMock = mock((value: unknown) => `toon:${JSON.stringify(value)}`)

mock.module("@toon-format/toon", () => ({
  encode: encodeMock,
}))

const enabledConfig = { enabled: true, threshold: 100 }
const disabledConfig = { enabled: false, threshold: 100 }

function createCliMatch(overrides: Partial<CliMatch> = {}): CliMatch {
  return {
    text: "function test() {}",
    range: {
      byteOffset: { start: 0, end: 20 },
      start: { line: 0, column: 0 },
      end: { line: 0, column: 20 },
    },
    file: "test.ts",
    lines: "function test() {}",
    charCount: { leading: 0, trailing: 0 },
    language: "typescript",
    ...overrides,
  }
}

function createUniformCliMatches(count: number): CliMatch[] {
  return Array.from({ length: count }, (_, index) =>
    createCliMatch({
      file: `file-${index}.ts`,
      text: `function test${index}() {}`,
      lines: `function test${index}() {}`,
      range: {
        byteOffset: { start: index * 100, end: index * 100 + 20 },
        start: { line: index, column: 0 },
        end: { line: index, column: 20 },
      },
    }),
  )
}

function createSgResult(matches: CliMatch[], overrides: Partial<SgResult> = {}): SgResult {
  return {
    matches,
    totalMatches: matches.length,
    truncated: false,
    ...overrides,
  }
}

function createAnalyzeResult(overrides: Partial<AnalyzeResult> = {}): AnalyzeResult {
  return {
    text: "function test() {}",
    range: { start: { line: 0, column: 0 }, end: { line: 0, column: 20 } },
    kind: "function_declaration",
    metaVariables: [],
    ...overrides,
  }
}

function createUniformAnalyzeResults(count: number): AnalyzeResult[] {
  return Array.from({ length: count }, (_, index) =>
    createAnalyzeResult({
      text: `function test${index}() {}`,
      range: {
        start: { line: index, column: 0 },
        end: { line: index, column: 20 },
      },
    }),
  )
}

describe("ast-grep/result-formatter", () => {
  beforeEach(() => {
    encodeMock.mockReset()
    encodeMock.mockImplementation((value: unknown) => `toon:${JSON.stringify(value)}`)
  })

  describe("#given formatSearchResult", () => {
    describe("#when compression is disabled", () => {
      it("#then formats small match arrays normally", () => {
        const matches = createUniformCliMatches(3)
        const result = createSgResult(matches)
        const output = formatSearchResult(result, disabledConfig)

        expect(output).toContain("Found 3 match(es)")
        expect(output).toContain("file-0.ts:1:1")
        expect(output).not.toContain("toon:")
      })

      it("#then formats large match arrays normally", () => {
        const matches = createUniformCliMatches(10)
        const result = createSgResult(matches)
        const output = formatSearchResult(result, disabledConfig)

        expect(output).toContain("Found 10 match(es)")
        expect(output).toContain("file-0.ts:1:1")
        expect(encodeMock).not.toHaveBeenCalled()
      })
    })

    describe("#when compression is enabled", () => {
      it("#then formats small match arrays normally", () => {
        const matches = createUniformCliMatches(2)
        const result = createSgResult(matches)
        const output = formatSearchResult(result, { enabled: true, threshold: 10_000 })

        expect(output).toContain("Found 2 match(es)")
        expect(output).toContain("file-0.ts:1:1")
        expect(encodeMock).not.toHaveBeenCalled()
      })

      it("#then compresses large uniform match arrays above threshold", () => {
        const matches = createUniformCliMatches(10)
        const result = createSgResult(matches)
        const output = formatSearchResult(result, { enabled: true, threshold: 100 })

        expect(output).toContain("toon:")
        expect(encodeMock).toHaveBeenCalledTimes(1)
      })

      it("#then handles error results without compression", () => {
        const result: SgResult = {
          matches: [],
          totalMatches: 0,
          truncated: false,
          error: "Search failed",
        }
        const output = formatSearchResult(result, enabledConfig)

        expect(output).toBe("Error: Search failed")
        expect(encodeMock).not.toHaveBeenCalled()
      })

      it("#then handles no matches without compression", () => {
        const result = createSgResult([])
        const output = formatSearchResult(result, enabledConfig)

        expect(output).toBe("No matches found")
        expect(encodeMock).not.toHaveBeenCalled()
      })

      it("#then includes truncated info in compressed output", () => {
        const matches = createUniformCliMatches(10)
        const result = createSgResult(matches, {
          truncated: true,
          totalMatches: 100,
          truncatedReason: "max_matches",
        })
        const output = formatSearchResult(result, { enabled: true, threshold: 100 })

        expect(output).toContain("[TRUNCATED]")
        expect(output).toContain("showing first 10 of 100")
      })
    })
  })

  describe("#given formatReplaceResult", () => {
    describe("#when compression is disabled", () => {
      it("#then formats replacement results normally", () => {
        const matches = createUniformCliMatches(5)
        const result = createSgResult(matches)
        const output = formatReplaceResult(result, false, disabledConfig)

        expect(output).toContain("5 replacement(s)")
        expect(output).toContain("file-0.ts:1:1")
        expect(output).not.toContain("toon:")
      })
    })

    describe("#when compression is enabled", () => {
      it("#then compresses large uniform match arrays above threshold", () => {
        const matches = createUniformCliMatches(10)
        const result = createSgResult(matches)
        const output = formatReplaceResult(result, false, { enabled: true, threshold: 100 })

        expect(output).toContain("toon:")
        expect(encodeMock).toHaveBeenCalledTimes(1)
      })

      it("#then includes dry run prefix in compressed output", () => {
        const matches = createUniformCliMatches(10)
        const result = createSgResult(matches)
        const output = formatReplaceResult(result, true, { enabled: true, threshold: 100 })

        expect(output).toContain("[DRY RUN]")
        expect(output).toContain("toon:")
      })

      it("#then handles no matches without compression", () => {
        const result = createSgResult([])
        const output = formatReplaceResult(result, false, enabledConfig)

        expect(output).toBe("No matches found to replace")
        expect(encodeMock).not.toHaveBeenCalled()
      })

      it("#then handles error results without compression", () => {
        const result: SgResult = {
          matches: [],
          totalMatches: 0,
          truncated: false,
          error: "Replace failed",
        }
        const output = formatReplaceResult(result, false, enabledConfig)

        expect(output).toBe("Error: Replace failed")
        expect(encodeMock).not.toHaveBeenCalled()
      })
    })
  })

  describe("#given formatAnalyzeResult", () => {
    describe("#when compression is disabled", () => {
      it("#then formats analyze results normally", () => {
        const results = createUniformAnalyzeResults(5)
        const output = formatAnalyzeResult(results, false, disabledConfig)

        expect(output).toContain("Found 5 match(es)")
        expect(output).toContain("L1:1")
        expect(output).not.toContain("toon:")
      })
    })

    describe("#when compression is enabled", () => {
      it("#then compresses large uniform analyze results above threshold", () => {
        const results = createUniformAnalyzeResults(10)
        const output = formatAnalyzeResult(results, false, { enabled: true, threshold: 100 })

        expect(output).toContain("toon:")
        expect(encodeMock).toHaveBeenCalledTimes(1)
      })

      it("#then handles no results without compression", () => {
        const output = formatAnalyzeResult([], false, enabledConfig)

        expect(output).toBe("No matches found")
        expect(encodeMock).not.toHaveBeenCalled()
      })

      it("#then includes meta-variables in non-compressed output", () => {
        const results: AnalyzeResult[] = [
          {
            text: "function test() {}",
            range: { start: { line: 0, column: 0 }, end: { line: 0, column: 20 } },
            kind: "function_declaration",
            metaVariables: [{ name: "NAME", text: "test", kind: "identifier" }],
          },
        ]
        const output = formatAnalyzeResult(results, true, { enabled: true, threshold: 10_000 })

        expect(output).toContain("Meta-variables:")
        expect(output).toContain("$NAME")
      })
    })
  })
})
