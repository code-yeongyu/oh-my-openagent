import { describe, expect, test } from "bun:test"

import { parseGitDiffNumstat } from "./parse-diff-numstat"
import type { GitFileStatus } from "./types"

describe("parseGitDiffNumstat", () => {
  test("#given empty output #when parsing numstat #then returns no file stats", () => {
    const result = parseGitDiffNumstat("", new Map<string, GitFileStatus>())

    expect(result).toEqual([])
  })

  test("#given status map entries #when parsing numstat #then preserves matching statuses", () => {
    const statusMap = new Map<string, GitFileStatus>([
      ["src/changed.ts", "modified"],
      ["src/new.ts", "added"],
      ["src/removed.ts", "deleted"],
    ])
    const output = ["12\t3\tsrc/changed.ts", "7\t0\tsrc/new.ts", "0\t9\tsrc/removed.ts"].join("\n")

    const result = parseGitDiffNumstat(output, statusMap)

    expect(result).toEqual([
      { path: "src/changed.ts", added: 12, removed: 3, status: "modified" },
      { path: "src/new.ts", added: 7, removed: 0, status: "added" },
      { path: "src/removed.ts", added: 0, removed: 9, status: "deleted" },
    ])
  })

  test("#given missing status map entry #when parsing numstat #then defaults status to modified", () => {
    const output = "4\t2\tsrc/unmapped.ts"

    const result = parseGitDiffNumstat(output, new Map<string, GitFileStatus>())

    expect(result).toEqual([{ path: "src/unmapped.ts", added: 4, removed: 2, status: "modified" }])
  })

  test("#given binary numstat markers #when parsing numstat #then records zero added and removed counts", () => {
    const output = "-\t-\tassets/logo.png"

    const result = parseGitDiffNumstat(output, new Map<string, GitFileStatus>([["assets/logo.png", "modified"]]))

    expect(result).toEqual([{ path: "assets/logo.png", added: 0, removed: 0, status: "modified" }])
  })

  test("#given malformed lines #when parsing numstat #then skips incomplete rows", () => {
    const output = ["missing-tabs", "1\t2", "5\t6\tsrc/valid.ts"].join("\n")

    const result = parseGitDiffNumstat(output, new Map<string, GitFileStatus>())

    expect(result).toEqual([{ path: "src/valid.ts", added: 5, removed: 6, status: "modified" }])
  })
})
