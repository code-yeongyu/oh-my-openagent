import { describe, expect, test } from "bun:test"

import { normalizeItemKey } from "./index"

describe("normalizeItemKey", () => {
  test("case-only spellings of one path fold to one key", () => {
    expect(normalizeItemKey("Notes.md")).toBe("notes.md")
    expect(normalizeItemKey("notes.md")).toBe("notes.md")
    expect(normalizeItemKey("NOTES.MD")).toBe("notes.md")
  })

  test("keeps directory structure", () => {
    expect(normalizeItemKey("people/Hojin/Card.MD")).toBe("people/hojin/card.md")
    expect(normalizeItemKey("a/b/c")).toBe("a/b/c")
  })

  test("NFC-composes before folding: precomposed and decomposed agree", () => {
    expect(normalizeItemKey("café.md")).toBe("café.md")
    expect(normalizeItemKey("café.md")).toBe("café.md")
  })

  test("applies the vendored Unicode 16.0 fold, not the runtime ICU", () => {
    expect(normalizeItemKey("Straße.md")).toBe("strasse.md")
    expect(normalizeItemKey("İ.md")).toBe("i̇.md")
    expect(normalizeItemKey("ı.md")).toBe("ı.md")
    expect(normalizeItemKey("ς.md")).toBe("σ.md")
    expect(normalizeItemKey("Σ.md")).toBe("σ.md")
  })

  test("two spellings that differ only by fold produce one key", () => {
    expect(normalizeItemKey("Σίσυφος.md")).toBe(normalizeItemKey("σίσυφοσ.md"))
  })

  test("rejects parent traversal, absolute paths, NUL and the empty path", () => {
    expect(normalizeItemKey("..")).toBeNull()
    expect(normalizeItemKey("../secret.md")).toBeNull()
    expect(normalizeItemKey("a/../b.md")).toBeNull()
    expect(normalizeItemKey("a/b/..")).toBeNull()
    expect(normalizeItemKey("/absolute.md")).toBeNull()
    expect(normalizeItemKey("\0.md")).toBeNull()
    expect(normalizeItemKey("a/\0.md")).toBeNull()
    expect(normalizeItemKey("")).toBeNull()
  })

  test("keeps lookalike segments that are not exactly '..'", () => {
    expect(normalizeItemKey("..x/..y.md")).toBe("..x/..y.md")
    expect(normalizeItemKey(".hidden/file.md")).toBe(".hidden/file.md")
    expect(normalizeItemKey("a.../b....md")).toBe("a.../b....md")
  })

  test("rejects spellings that would split one file into several keys", () => {
    expect(normalizeItemKey("a//b.md")).toBeNull()
    expect(normalizeItemKey("./a.md")).toBeNull()
    expect(normalizeItemKey("a/./b.md")).toBeNull()
    expect(normalizeItemKey("a/")).toBeNull()
    expect(normalizeItemKey(".")).toBeNull()
    expect(normalizeItemKey("a/b/.")).toBeNull()
  })

  test("rejects backslash and Windows drive paths", () => {
    expect(normalizeItemKey("a\\b.md")).toBeNull()
    expect(normalizeItemKey("C:\\x.md")).toBeNull()
    expect(normalizeItemKey("C:/x.md")).toBeNull()
    // Drive-relative spellings (no separator after the colon) are still Windows paths.
    expect(normalizeItemKey("c:x.md")).toBeNull()
    expect(normalizeItemKey("D:notes")).toBeNull()
  })

  test("the folded key is itself NFC-stable", () => {
    // ǰ (U+01F0) folds to j + U+030C; the stored key must equal its own re-normalization.
    const folded = normalizeItemKey("ǰ.md")
    expect(folded).not.toBeNull()
    if (folded === null) return
    expect(folded).toBe(folded.normalize("NFC"))
    expect(normalizeItemKey("J̌.md")).toBe(folded)
  })
})
