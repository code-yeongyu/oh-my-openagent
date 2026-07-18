import { describe, expect, test } from "bun:test"

import { formatFileChanges } from "./format-file-changes"
import type { GitFileStat } from "./types"

describe("formatFileChanges", () => {
  test("#given no stats #when formatting file changes #then reports no detected changes", () => {
    expect(formatFileChanges([])).toBe("[FILE CHANGES SUMMARY]\nNo file changes detected.\n")
  })

  test("#given mixed statuses #when formatting file changes #then groups modified created and deleted files", () => {
    const stats: GitFileStat[] = [
      { path: "src/changed.ts", added: 5, removed: 2, status: "modified" },
      { path: "src/new.ts", added: 9, removed: 0, status: "added" },
      { path: "src/removed.ts", added: 0, removed: 4, status: "deleted" },
    ]

    const output = formatFileChanges(stats)

    expect(output).toContain("Modified files:\n  src/changed.ts  (+5, -2)")
    expect(output).toContain("Created files:\n  src/new.ts  (+9)")
    expect(output).toContain("Deleted files:\n  src/removed.ts  (-4)")
  })

  test("#given matching notepad path #when formatting file changes #then includes notepad update marker", () => {
    const stats: GitFileStat[] = [{ path: ".omo/notepads/task.md", added: 3, removed: 1, status: "modified" }]

    const output = formatFileChanges(stats, ".omo/notepads/task.md")

    expect(output).toContain("[NOTEPAD UPDATED]\n  .omo/notepads/task.md  (+3)")
  })

  test("#given Windows-style notepad path #when formatting file changes #then normalizes path separators for matching", () => {
    const stats: GitFileStat[] = [{ path: ".omo/notepads/task.md", added: 3, removed: 1, status: "modified" }]

    const output = formatFileChanges(stats, ".omo\\notepads\\task.md")

    expect(output).toContain("[NOTEPAD UPDATED]\n  .omo/notepads/task.md  (+3)")
  })

  test("#given nonmatching notepad path #when formatting file changes #then omits notepad update marker", () => {
    const stats: GitFileStat[] = [{ path: "src/changed.ts", added: 5, removed: 2, status: "modified" }]

    const output = formatFileChanges(stats, ".omo/notepads/task.md")

    expect(output).not.toContain("[NOTEPAD UPDATED]")
  })
})
