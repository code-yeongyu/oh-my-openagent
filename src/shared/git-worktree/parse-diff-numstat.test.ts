import { describe, test, expect } from "bun:test"
import { parseGitDiffNumstat } from "./parse-diff-numstat"
import type { GitFileStatus } from "./types"

describe("parseGitDiffNumstat", () => {
  describe("#given empty or falsy input", () => {
    describe("#when output is empty string", () => {
      test("#then returns empty array", () => {
        const statusMap = new Map<string, GitFileStatus>()
        const result = parseGitDiffNumstat("", statusMap)
        expect(result).toEqual([])
      })
    })
  })

  describe("#given single file with numeric stats", () => {
    describe("#when output has added and removed lines", () => {
      test("#then parses counts correctly", () => {
        const statusMap = new Map<string, GitFileStatus>([["src/index.ts", "modified"]])
        const result = parseGitDiffNumstat("10\t5\tsrc/index.ts", statusMap)
        expect(result).toEqual([
          { path: "src/index.ts", added: 10, removed: 5, status: "modified" },
        ])
      })
    })
  })

  describe("#given binary file with dash stats", () => {
    describe("#when added and removed are dashes", () => {
      test("#then treats dashes as 0", () => {
        const statusMap = new Map<string, GitFileStatus>([["image.png", "added"]])
        const result = parseGitDiffNumstat("-\t-\timage.png", statusMap)
        expect(result).toEqual([
          { path: "image.png", added: 0, removed: 0, status: "added" },
        ])
      })
    })
  })

  describe("#given file not in statusMap", () => {
    describe("#when path has no entry in the map", () => {
      test("#then defaults to modified status", () => {
        const statusMap = new Map<string, GitFileStatus>()
        const result = parseGitDiffNumstat("3\t1\tsrc/unknown.ts", statusMap)
        expect(result).toEqual([
          { path: "src/unknown.ts", added: 3, removed: 1, status: "modified" },
        ])
      })
    })
  })

  describe("#given multiple files", () => {
    describe("#when output contains multiple lines", () => {
      test("#then parses all entries", () => {
        const statusMap = new Map<string, GitFileStatus>([
          ["src/a.ts", "modified"],
          ["src/b.ts", "added"],
          ["src/c.ts", "deleted"],
        ])
        const output = "10\t2\tsrc/a.ts\n50\t0\tsrc/b.ts\n0\t30\tsrc/c.ts"
        const result = parseGitDiffNumstat(output, statusMap)
        expect(result).toEqual([
          { path: "src/a.ts", added: 10, removed: 2, status: "modified" },
          { path: "src/b.ts", added: 50, removed: 0, status: "added" },
          { path: "src/c.ts", added: 0, removed: 30, status: "deleted" },
        ])
      })
    })
  })

  describe("#given malformed lines", () => {
    describe("#when line has fewer than 3 tab-separated parts", () => {
      test("#then skips that line", () => {
        const statusMap = new Map<string, GitFileStatus>()
        const output = "10\t5\tsrc/valid.ts\ninvalid-line\n3\tsrc/incomplete.ts"
        const result = parseGitDiffNumstat(output, statusMap)
        expect(result).toEqual([
          { path: "src/valid.ts", added: 10, removed: 5, status: "modified" },
        ])
      })
    })
  })

  describe("#given output with trailing newline", () => {
    describe("#when last line is empty", () => {
      test("#then ignores empty trailing line", () => {
        const statusMap = new Map<string, GitFileStatus>([["src/file.ts", "modified"]])
        const output = "5\t3\tsrc/file.ts\n"
        const result = parseGitDiffNumstat(output, statusMap)
        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({ path: "src/file.ts", added: 5, removed: 3, status: "modified" })
      })
    })
  })

  describe("#given file with only additions", () => {
    describe("#when removed count is 0", () => {
      test("#then correctly parses zero removals", () => {
        const statusMap = new Map<string, GitFileStatus>([["new-file.ts", "added"]])
        const result = parseGitDiffNumstat("25\t0\tnew-file.ts", statusMap)
        expect(result).toEqual([
          { path: "new-file.ts", added: 25, removed: 0, status: "added" },
        ])
      })
    })
  })

  describe("#given file with only deletions", () => {
    describe("#when added count is 0", () => {
      test("#then correctly parses zero additions", () => {
        const statusMap = new Map<string, GitFileStatus>([["old-file.ts", "deleted"]])
        const result = parseGitDiffNumstat("0\t40\told-file.ts", statusMap)
        expect(result).toEqual([
          { path: "old-file.ts", added: 0, removed: 40, status: "deleted" },
        ])
      })
    })
  })
})
