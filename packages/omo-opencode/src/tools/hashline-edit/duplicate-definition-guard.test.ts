import { describe, expect, test } from "bun:test"
import {
  detectDuplicateDefinitions,
  formatDuplicateDefinitionWarnings,
} from "./duplicate-definition-guard"

describe("detectDuplicateDefinitions", () => {
  test("flags a class duplicated by a pos-only whole-file insert", () => {
    const oldContent = [
      "# frozen_string_literal: true",
      "",
      "class TrustedProxy",
      "  def valid?",
      "    true",
      "  end",
      "end",
    ].join("\n")
    const newContent = [
      "# frozen_string_literal: true",
      "",
      "class TrustedProxy",
      "  def valid?",
      "    false",
      "  end",
      "end",
      "",
      "class TrustedProxy",
      "  def valid?",
      "    true",
      "  end",
      "end",
    ].join("\n")

    const warnings = detectDuplicateDefinitions(oldContent, newContent)

    expect(warnings).toEqual([{ name: "TrustedProxy", occurrences: 2 }])
  })

  test("flags an increase over pre-existing duplicates", () => {
    const oldContent = "class A\nend\n\nclass A\nend"
    const newContent = "class A\nend\n\nclass A\nend\n\nclass A\nend"

    const warnings = detectDuplicateDefinitions(oldContent, newContent)

    expect(warnings).toEqual([{ name: "A", occurrences: 3 }])
  })

  test("does not flag single definitions added by the edit", () => {
    const oldContent = "def one\nend"
    const newContent = "def one\nend\n\nclass Two\nend"

    expect(detectDuplicateDefinitions(oldContent, newContent)).toEqual([])
  })

  test("ignores indented (nested) definitions", () => {
    const oldContent = "class Outer\n  class Inner\n  end\nend"
    const newContent =
      "class Outer\n  class Inner\n  end\nend\n\nclass Outer\n  class Inner\n  end\nend"

    const warnings = detectDuplicateDefinitions(oldContent, newContent)

    expect(warnings).toEqual([{ name: "Outer", occurrences: 2 }])
  })

  test("returns empty when nothing is duplicated", () => {
    const oldContent = "class A\nend"
    const newContent = "class A\nend\n\ndef helper\nend"

    expect(detectDuplicateDefinitions(oldContent, newContent)).toEqual([])
  })
})

describe("formatDuplicateDefinitionWarnings", () => {
  test("returns empty string for no warnings", () => {
    expect(formatDuplicateDefinitionWarnings([])).toBe("")
  })

  test("renders names and counts", () => {
    const message = formatDuplicateDefinitionWarnings([
      { name: "TrustedProxy", occurrences: 2 },
    ])

    expect(message).toContain('"TrustedProxy" defined 2 times')
    expect(message).toContain("re-read the file")
  })
})
