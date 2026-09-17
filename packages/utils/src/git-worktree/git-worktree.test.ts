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

    expect(summary).toBe(`[FILE CHANGES SUMMARY]
Modified files:
  src/a.ts  (+1, -2)

Created files:
  src/b.ts  (+3)

Deleted files:
  src/c.ts  (-4)
`)
  })

  test("#given a large worktree #when formatting #then bounds each category and reports omitted counts", () => {
    const summary = formatFileChanges([
      ...Array.from({ length: 25 }, (_, index) => ({
        path: `src/modified-${index + 1}.ts`,
        added: index + 1,
        removed: index,
        status: "modified" as const,
      })),
      ...Array.from({ length: 23 }, (_, index) => ({
        path: `src/added-${index + 1}.ts`,
        added: index + 1,
        removed: 0,
        status: "added" as const,
      })),
      ...Array.from({ length: 21 }, (_, index) => ({
        path: `src/deleted-${index + 1}.ts`,
        added: 0,
        removed: index + 1,
        status: "deleted" as const,
      })),
    ])

    expect(summary).toContain("Modified files (25 total, showing 20):")
    expect(summary).toContain("Created files (23 total, showing 20):")
    expect(summary).toContain("Deleted files (21 total, showing 20):")
    expect(summary).toContain("... 5 more modified files omitted.")
    expect(summary).toContain("... 3 more created files omitted.")
    expect(summary).toContain("... 1 more deleted file omitted.")
    expect(summary).toContain("src/modified-20.ts")
    expect(summary).not.toContain("src/modified-21.ts")
    expect(summary).toContain("src/added-20.ts")
    expect(summary).not.toContain("src/added-21.ts")
    expect(summary).toContain("src/deleted-20.ts")
    expect(summary).not.toContain("src/deleted-21.ts")
  })

  test("#given an oversized path outside the displayed prefix #when formatting #then bounds paths and preserves the notepad marker", () => {
    const notepadPath = `.omo/notepads/${"nested/".repeat(80)}notes.md`
    const stats = [
      ...Array.from({ length: 20 }, (_, index) => ({
        path: `src/file-${index + 1}.ts`,
        added: 1,
        removed: 0,
        status: "modified" as const,
      })),
      { path: notepadPath, added: 4, removed: 0, status: "modified" as const },
    ]

    const summary = formatFileChanges(stats, notepadPath)

    expect(summary).toContain("... 1 more modified file omitted.")
    expect(summary).toContain("[NOTEPAD UPDATED]")
    expect(summary).toContain("[path truncated]")
    expect(summary.length).toBeLessThan(10_000)
  })

  test("#given notepad path #when formatting omo plan changes #then does not report notepad updated", () => {
    const summary = formatFileChanges([
      { path: ".omo/plans/work.md", added: 1, removed: 0, status: "modified" },
    ], ".omo/notepads/work/notes.md")

    expect(summary).not.toContain("[NOTEPAD UPDATED]")
  })

  test("#given notepad path #when formatting omo notepad changes #then reports notepad updated", () => {
    const summary = formatFileChanges([
      { path: ".omo/notepads/work/notes.md", added: 1, removed: 0, status: "modified" },
    ], ".omo/notepads/work/notes.md")

    expect(summary).toContain("[NOTEPAD UPDATED]")
    expect(summary).toContain(".omo/notepads/work/notes.md")
  })

  test("#given notepad path #when formatting another omo notepad change #then does not report active notepad updated", () => {
    const summary = formatFileChanges([
      { path: ".omo/notepads/other/notes.md", added: 1, removed: 0, status: "modified" },
    ], ".omo/notepads/work/notes.md")

    expect(summary).not.toContain("[NOTEPAD UPDATED]")
  })
})
