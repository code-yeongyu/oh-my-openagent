import { describe, it, expect } from "bun:test"
import { parseGitDiffNumstat } from "./parse-diff-numstat"
import type { GitFileStatus } from "./types"

describe("parseGitDiffNumstat", () => {
  describe("#given empty output", () => {
    describe("#when parsing", () => {
      it("#then returns empty array", () => {
        const result = parseGitDiffNumstat("", new Map())
        expect(result).toEqual([])
      })
    })
  })

  describe("#given single file with numeric additions and removals", () => {
    describe("#when parsing", () => {
      it("#then returns array with one GitFileStat", () => {
        const output = "5\t3\tsrc/index.ts"
        const statusMap = new Map<string, GitFileStatus>()

        const result = parseGitDiffNumstat(output, statusMap)

        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          path: "src/index.ts",
          added: 5,
          removed: 3,
          status: "modified",
        })
      })
    })
  })

  describe("#given multiple files", () => {
    describe("#when parsing", () => {
      it("#then returns array with all files parsed correctly", () => {
        const output = "10\t2\tsrc/file1.ts\n5\t8\tsrc/file2.ts\n1\t1\tsrc/file3.ts"
        const statusMap = new Map<string, GitFileStatus>()

        const result = parseGitDiffNumstat(output, statusMap)

        expect(result).toHaveLength(3)
        expect(result[0]).toEqual({
          path: "src/file1.ts",
          added: 10,
          removed: 2,
          status: "modified",
        })
        expect(result[1]).toEqual({
          path: "src/file2.ts",
          added: 5,
          removed: 8,
          status: "modified",
        })
        expect(result[2]).toEqual({
          path: "src/file3.ts",
          added: 1,
          removed: 1,
          status: "modified",
        })
      })
    })
  })

  describe("#given binary files with dash values", () => {
    describe("#when parsing", () => {
      it("#then converts dash to 0 for added", () => {
        const output = "-\t5\tbinary.bin"
        const statusMap = new Map<string, GitFileStatus>()

        const result = parseGitDiffNumstat(output, statusMap)

        expect(result[0]).toEqual({
          path: "binary.bin",
          added: 0,
          removed: 5,
          status: "modified",
        })
      })

      it("#then converts dash to 0 for removed", () => {
        const output = "10\t-\tbinary.bin"
        const statusMap = new Map<string, GitFileStatus>()

        const result = parseGitDiffNumstat(output, statusMap)

        expect(result[0]).toEqual({
          path: "binary.bin",
          added: 10,
          removed: 0,
          status: "modified",
        })
      })

      it("#then converts both dashes to 0", () => {
        const output = "-\t-\tbinary.bin"
        const statusMap = new Map<string, GitFileStatus>()

        const result = parseGitDiffNumstat(output, statusMap)

        expect(result[0]).toEqual({
          path: "binary.bin",
          added: 0,
          removed: 0,
          status: "modified",
        })
      })
    })
  })

  describe("#given lines with fewer than 3 tab-separated parts", () => {
    describe("#when parsing", () => {
      it("#then skips malformed lines", () => {
        const output = "5\t3\tsrc/file1.ts\ninvalid line\n10\t2\tsrc/file2.ts\n"
        const statusMap = new Map<string, GitFileStatus>()

        const result = parseGitDiffNumstat(output, statusMap)

        expect(result).toHaveLength(2)
        expect(result[0].path).toBe("src/file1.ts")
        expect(result[1].path).toBe("src/file2.ts")
      })

      it("#then skips empty lines", () => {
        const output = "5\t3\tsrc/file1.ts\n\n10\t2\tsrc/file2.ts"
        const statusMap = new Map<string, GitFileStatus>()

        const result = parseGitDiffNumstat(output, statusMap)

        expect(result).toHaveLength(2)
      })
    })
  })

  describe("#given statusMap with file paths", () => {
    describe("#when parsing", () => {
      it("#then uses status from statusMap when available", () => {
        const output = "5\t3\tsrc/file1.ts\n10\t2\tsrc/file2.ts"
        const statusMap = new Map<string, GitFileStatus>([
          ["src/file1.ts", "added"],
          ["src/file2.ts", "deleted"],
        ])

        const result = parseGitDiffNumstat(output, statusMap)

        expect(result[0].status).toBe("added")
        expect(result[1].status).toBe("deleted")
      })

      it("#then defaults to modified when path not in statusMap", () => {
        const output = "5\t3\tsrc/file1.ts\n10\t2\tsrc/file2.ts"
        const statusMap = new Map<string, GitFileStatus>([
          ["src/file1.ts", "added"],
        ])

        const result = parseGitDiffNumstat(output, statusMap)

        expect(result[0].status).toBe("added")
        expect(result[1].status).toBe("modified")
      })
    })
  })

  describe("#given file paths with spaces", () => {
    describe("#when parsing", () => {
      it("#then correctly parses path with spaces", () => {
        const output = "5\t3\tsrc/my file.ts"
        const statusMap = new Map<string, GitFileStatus>()

        const result = parseGitDiffNumstat(output, statusMap)

        expect(result[0].path).toBe("src/my file.ts")
      })
    })
  })

  describe("#given numeric strings that need parsing", () => {
    describe("#when parsing", () => {
      it("#then correctly parses large numbers", () => {
        const output = "1000\t500\tsrc/large.ts"
        const statusMap = new Map<string, GitFileStatus>()

        const result = parseGitDiffNumstat(output, statusMap)

        expect(result[0].added).toBe(1000)
        expect(result[0].removed).toBe(500)
      })

      it("#then correctly parses zero values", () => {
        const output = "0\t0\tsrc/unchanged.ts"
        const statusMap = new Map<string, GitFileStatus>()

        const result = parseGitDiffNumstat(output, statusMap)

        expect(result[0].added).toBe(0)
        expect(result[0].removed).toBe(0)
      })
    })
  })

  describe("#given all status types", () => {
    describe("#when parsing with statusMap", () => {
      it("#then correctly assigns added status", () => {
        const output = "5\t0\tnew-file.ts"
        const statusMap = new Map<string, GitFileStatus>([
          ["new-file.ts", "added"],
        ])

        const result = parseGitDiffNumstat(output, statusMap)

        expect(result[0].status).toBe("added")
      })

      it("#then correctly assigns deleted status", () => {
        const output = "0\t5\told-file.ts"
        const statusMap = new Map<string, GitFileStatus>([
          ["old-file.ts", "deleted"],
        ])

        const result = parseGitDiffNumstat(output, statusMap)

        expect(result[0].status).toBe("deleted")
      })

      it("#then correctly assigns modified status", () => {
        const output = "5\t3\tchanged-file.ts"
        const statusMap = new Map<string, GitFileStatus>([
          ["changed-file.ts", "modified"],
        ])

        const result = parseGitDiffNumstat(output, statusMap)

        expect(result[0].status).toBe("modified")
      })
    })
  })
})
