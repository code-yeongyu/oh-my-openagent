/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { formatFileChanges, parseGitDiffNumstat, parseGitStatusPorcelain } from "./index"

describe("git-worktree", () => {
  test("#given status porcelain output #when parsing #then maps paths to statuses", () => {
    const porcelain = [
      " M src/a.ts",
      "A  src/b.ts",
      "?? src/c.ts",
      "D  src/d.ts",
    ].join("\n")

    const map = parseGitStatusPorcelain(porcelain)
    expect(map.get("src/a.ts")).toBe("modified")
    expect(map.get("src/b.ts")).toBe("added")
    expect(map.get("src/c.ts")).toBe("added")
    expect(map.get("src/d.ts")).toBe("deleted")
  })

  test("#given diff numstat and status map #when parsing #then returns typed stats", () => {
    const porcelain = [" M src/a.ts", "A  src/b.ts"].join("\n")
    const statusMap = parseGitStatusPorcelain(porcelain)

    const numstat = ["1\t2\tsrc/a.ts", "3\t0\tsrc/b.ts", "-\t-\tbin.dat"].join("\n")
    const stats = parseGitDiffNumstat(numstat, statusMap)

    expect(stats).toEqual([
      { path: "src/a.ts", added: 1, removed: 2, status: "modified" },
      { path: "src/b.ts", added: 3, removed: 0, status: "added" },
      { path: "bin.dat", added: 0, removed: 0, status: "modified" },
    ])
  })

  test("#given git file stats #when formatting #then produces grouped summary", () => {
    const summary = formatFileChanges([
      { path: "src/a.ts", added: 1, removed: 2, status: "modified" },
      { path: "src/b.ts", added: 3, removed: 0, status: "added" },
      { path: "src/c.ts", added: 0, removed: 4, status: "deleted" },
    ])

    expect(summary).toContain("[FILE CHANGES SUMMARY]")
    expect(summary).toContain("Modified files:")
    expect(summary).toContain("Created files:")
    expect(summary).toContain("Deleted files:")
    expect(summary).toContain("src/a.ts")
    expect(summary).toContain("src/b.ts")
    expect(summary).toContain("src/c.ts")
  })
})
