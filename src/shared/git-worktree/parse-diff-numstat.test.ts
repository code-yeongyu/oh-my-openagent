import { describe, test, expect } from "bun:test"

import { parseGitDiffNumstat } from "./parse-diff-numstat"
import type { GitFileStatus } from "./types"

describe("parse-diff-numstat", () => {
  describe("#given parseGitDiffNumstat", () => {
    describe("#when output is empty", () => {
      test("#then returns an empty array", () => {
        const statusMap = new Map<string, GitFileStatus>()
        expect(parseGitDiffNumstat("", statusMap)).toEqual([])
      })
    })

    describe("#when output has a single file with numeric stats", () => {
      test("#then parses added and removed counts", () => {
        const statusMap = new Map<string, GitFileStatus>([["src/index.ts", "modified"]])
        const output = "10\t5\tsrc/index.ts"
        const result = parseGitDiffNumstat(output, statusMap)
        expect(result).toEqual([
          { path: "src/index.ts", added: 10, removed: 5, status: "modified" },
        ])
      })
    })

    describe("#when output has binary file markers", () => {
      test("#then treats dash as 0", () => {
        const statusMap = new Map<string, GitFileStatus>([["image.png", "added"]])
        const output = "-\t-\timage.png"
        const result = parseGitDiffNumstat(output, statusMap)
        expect(result).toEqual([
          { path: "image.png", added: 0, removed: 0, status: "added" },
        ])
      })
    })

    describe("#when output has multiple files", () => {
      test("#then parses all entries", () => {
        const statusMap = new Map<string, GitFileStatus>([
          ["src/a.ts", "modified"],
          ["src/b.ts", "added"],
          ["src/c.ts", "deleted"],
        ])
        const output = "3\t1\tsrc/a.ts\n20\t0\tsrc/b.ts\n0\t15\tsrc/c.ts"
        const result = parseGitDiffNumstat(output, statusMap)
        expect(result).toEqual([
          { path: "src/a.ts", added: 3, removed: 1, status: "modified" },
          { path: "src/b.ts", added: 20, removed: 0, status: "added" },
          { path: "src/c.ts", added: 0, removed: 15, status: "deleted" },
        ])
      })
    })

    describe("#when file is not in statusMap", () => {
      test("#then defaults to modified status", () => {
        const statusMap = new Map<string, GitFileStatus>()
        const output = "5\t2\tsrc/unknown.ts"
        const result = parseGitDiffNumstat(output, statusMap)
        expect(result).toEqual([
          { path: "src/unknown.ts", added: 5, removed: 2, status: "modified" },
        ])
      })
    })

    describe("#when line has fewer than 3 tab-separated parts", () => {
      test("#then skips malformed lines", () => {
        const statusMap = new Map<string, GitFileStatus>()
        const output = "invalid line\n5\t2\tsrc/valid.ts\n\n"
        const result = parseGitDiffNumstat(output, statusMap)
        expect(result).toEqual([
          { path: "src/valid.ts", added: 5, removed: 2, status: "modified" },
        ])
      })
    })

    describe("#when path contains tabs", () => {
      test("#then only first two parts are stats, rest is path", () => {
        const statusMap = new Map<string, GitFileStatus>()
        const output = "1\t2\tpath\twith\ttabs"
        const result = parseGitDiffNumstat(output, statusMap)
        expect(result[0]!.path).toBe("path")
        expect(result[0]!.added).toBe(1)
        expect(result[0]!.removed).toBe(2)
      })
    })

    describe("#when output has only empty lines", () => {
      test("#then returns empty array", () => {
        const statusMap = new Map<string, GitFileStatus>()
        const output = "\n\n\n"
        const result = parseGitDiffNumstat(output, statusMap)
        expect(result).toEqual([])
      })
    })
  })
})
