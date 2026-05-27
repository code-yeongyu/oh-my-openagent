import { describe, test, expect } from "bun:test"

import { formatFileChanges } from "./format-file-changes"
import type { GitFileStat } from "./types"

describe("format-file-changes", () => {
  describe("#given formatFileChanges", () => {
    describe("#when stats is empty", () => {
      test("#then returns no changes message", () => {
        const result = formatFileChanges([])
        expect(result).toBe("[FILE CHANGES SUMMARY]\nNo file changes detected.\n")
      })
    })

    describe("#when stats has only modified files", () => {
      test("#then formats modified section with added and removed counts", () => {
        const stats: GitFileStat[] = [
          { path: "src/index.ts", added: 10, removed: 5, status: "modified" },
        ]
        const result = formatFileChanges(stats)
        expect(result).toContain("[FILE CHANGES SUMMARY]")
        expect(result).toContain("Modified files:")
        expect(result).toContain("  src/index.ts  (+10, -5)")
      })
    })

    describe("#when stats has only added files", () => {
      test("#then formats created section with added count only", () => {
        const stats: GitFileStat[] = [
          { path: "src/new.ts", added: 20, removed: 0, status: "added" },
        ]
        const result = formatFileChanges(stats)
        expect(result).toContain("Created files:")
        expect(result).toContain("  src/new.ts  (+20)")
        expect(result).not.toContain("Modified files:")
        expect(result).not.toContain("Deleted files:")
      })
    })

    describe("#when stats has only deleted files", () => {
      test("#then formats deleted section with removed count only", () => {
        const stats: GitFileStat[] = [
          { path: "src/old.ts", added: 0, removed: 15, status: "deleted" },
        ]
        const result = formatFileChanges(stats)
        expect(result).toContain("Deleted files:")
        expect(result).toContain("  src/old.ts  (-15)")
        expect(result).not.toContain("Modified files:")
        expect(result).not.toContain("Created files:")
      })
    })

    describe("#when stats has mixed file types", () => {
      test("#then formats all sections in order: modified, created, deleted", () => {
        const stats: GitFileStat[] = [
          { path: "src/mod.ts", added: 3, removed: 1, status: "modified" },
          { path: "src/new.ts", added: 50, removed: 0, status: "added" },
          { path: "src/gone.ts", added: 0, removed: 30, status: "deleted" },
        ]
        const result = formatFileChanges(stats)
        const modIdx = result.indexOf("Modified files:")
        const addIdx = result.indexOf("Created files:")
        const delIdx = result.indexOf("Deleted files:")
        expect(modIdx).toBeLessThan(addIdx)
        expect(addIdx).toBeLessThan(delIdx)
      })
    })

    describe("#when notepadPath is provided and matches a stat", () => {
      test("#then appends notepad updated section", () => {
        const stats: GitFileStat[] = [
          { path: "src/notepad.md", added: 5, removed: 0, status: "added" },
        ]
        const result = formatFileChanges(stats, "src/notepad.md")
        expect(result).toContain("[NOTEPAD UPDATED]")
        expect(result).toContain("  src/notepad.md  (+5)")
      })
    })

    describe("#when notepadPath is provided but does not match any stat", () => {
      test("#then does not include notepad section", () => {
        const stats: GitFileStat[] = [
          { path: "src/other.ts", added: 10, removed: 2, status: "modified" },
        ]
        const result = formatFileChanges(stats, "src/notepad.md")
        expect(result).not.toContain("[NOTEPAD UPDATED]")
      })
    })

    describe("#when notepadPath uses backslashes (Windows)", () => {
      test("#then normalizes and matches forward-slash paths", () => {
        const stats: GitFileStat[] = [
          { path: "src/notes/pad.md", added: 8, removed: 0, status: "added" },
        ]
        const result = formatFileChanges(stats, "src\\notes\\pad.md")
        expect(result).toContain("[NOTEPAD UPDATED]")
      })
    })

    describe("#when multiple files in same category", () => {
      test("#then lists all files under the category", () => {
        const stats: GitFileStat[] = [
          { path: "src/a.ts", added: 1, removed: 2, status: "modified" },
          { path: "src/b.ts", added: 3, removed: 4, status: "modified" },
        ]
        const result = formatFileChanges(stats)
        expect(result).toContain("  src/a.ts  (+1, -2)")
        expect(result).toContain("  src/b.ts  (+3, -4)")
      })
    })
  })
})
