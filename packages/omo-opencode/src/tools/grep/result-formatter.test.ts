/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { formatGrepResult } from "./result-formatter"
import type { GrepResult } from "./types"

describe("formatGrepResult", () => {
  describe("#given grep result has error", () => {
    describe("#when formatting result", () => {
      test("#then returns error message", () => {
        const result: GrepResult = {
          matches: [],
          totalMatches: 0,
          filesSearched: 0,
          truncated: false,
          error: "ripgrep failed",
        }

        const formatted = formatGrepResult(result)

        expect(formatted).toBe("Error: ripgrep failed")
      })
    })
  })

  describe("#given grep result has no matches", () => {
    describe("#when formatting result", () => {
      test("#then returns no matches message", () => {
        const result: GrepResult = {
          matches: [],
          totalMatches: 0,
          filesSearched: 0,
          truncated: false,
        }

        const formatted = formatGrepResult(result)

        expect(formatted).toBe("No matches found")
      })
    })
  })

  describe("#given grep result is files-with-matches mode", () => {
    describe("#when formatting result", () => {
      test("#then prints only file paths", () => {
        const result: GrepResult = {
          matches: [
            { file: "src/foo.ts", line: 0, text: "" },
            { file: "src/bar.ts", line: 0, text: "" },
            { file: "src/baz.ts", line: 0, text: "" },
          ],
          totalMatches: 3,
          filesSearched: 3,
          truncated: false,
        }

        const formatted = formatGrepResult(result)

        expect(formatted).toBe(
          "Found 3 match(es) in 3 file(s)\n\n" +
            "src/foo.ts\n\n" +
            "src/bar.ts\n\n" +
            "src/baz.ts\n",
        )
      })
    })
  })

  describe("#given grep result is content mode", () => {
    describe("#when formatting result", () => {
      test("#then prints line numbers and content", () => {
        const result: GrepResult = {
          matches: [
            { file: "src/foo.ts", line: 10, text: " function hello() {" },
            { file: "src/foo.ts", line: 25, text: " function world() {" },
            { file: "src/bar.ts", line: 5, text: ' import { hello } from "./foo"' },
          ],
          totalMatches: 3,
          filesSearched: 2,
          truncated: false,
        }

        const formatted = formatGrepResult(result)

        expect(formatted).toBe(
          "Found 3 match(es) in 2 file(s)\n\n" +
            "src/foo.ts\n" +
            "  10: function hello() {\n" +
            "  25: function world() {\n\n" +
            "src/bar.ts\n" +
            '  5: import { hello } from "./foo"\n',
        )
      })
    })
  })

  describe("#given grep result has mixed file-only and content matches", () => {
    describe("#when formatting result", () => {
      test("#then skips file-only placeholders and prints valid content matches", () => {
        const result: GrepResult = {
          matches: [
            { file: "src/foo.ts", line: 0, text: "" },
            { file: "src/foo.ts", line: 10, text: " function hello() {" },
            { file: "src/bar.ts", line: 0, text: "" },
          ],
          totalMatches: 3,
          filesSearched: 2,
          truncated: false,
        }

        const formatted = formatGrepResult(result)

        expect(formatted).toBe(
          "Found 3 match(es) in 2 file(s)\n\n" +
            "src/foo.ts\n" +
            "  10: function hello() {\n\n" +
            "src/bar.ts\n",
        )
      })
    })
  })
})
