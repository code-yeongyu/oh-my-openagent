import { describe, expect, test } from "bun:test"

import { factsNotesOverBudget, isFactsNotePath, measureFactsNote } from "./note-budget"

describe("facts note budget (#10884)", () => {
  test("#given repo paths #when classified #then only top-level monthly markdown under notes/facts counts", () => {
    expect(isFactsNotePath("notes/facts/2026-10.md")).toBe(true)
    expect(isFactsNotePath("notes/facts/archive/2026-01.md")).toBe(false)
    expect(isFactsNotePath("notes/facts/2026-10.txt")).toBe(false)
    expect(isFactsNotePath("reference/notes/facts/2026-10.md")).toBe(false)
    expect(isFactsNotePath("system/facts.md")).toBe(false)
  })

  test("#given note content #when measured #then bytes are UTF-8 and lines count every line including an unterminated last one", () => {
    expect(measureFactsNote("notes/facts/2026-10.md", "- a\n- 한\n- c")).toEqual({ path: "notes/facts/2026-10.md", bytes: 13, lines: 3 })
    expect(measureFactsNote("notes/facts/2026-10.md", "")).toEqual({ path: "notes/facts/2026-10.md", bytes: 0, lines: 0 })
  })

  test("#given notes around the budget #when filtered #then only notes strictly over it are returned, largest first", () => {
    const notes = [
      measureFactsNote("notes/facts/2026-09.md", "x".repeat(100)),
      measureFactsNote("notes/facts/2026-10.md", "x".repeat(101)),
      measureFactsNote("notes/facts/2026-11.md", "x".repeat(300)),
    ]

    expect(factsNotesOverBudget(notes, 100).map((note) => note.path)).toEqual(["notes/facts/2026-11.md", "notes/facts/2026-10.md"])
  })

  test("#given a zero budget #when filtered #then the check is disabled", () => {
    expect(factsNotesOverBudget([measureFactsNote("notes/facts/2026-11.md", "x".repeat(10_000))], 0)).toEqual([])
  })
})
