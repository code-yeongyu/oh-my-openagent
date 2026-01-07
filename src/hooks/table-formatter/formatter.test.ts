import { describe, expect, test } from "bun:test"
import { formatTable, formatTablesInText } from "./formatter"
import type { ParsedTable } from "./types"

describe("formatTable", () => {
  test("should align columns with equal width content", () => {
    // #given
    const table: ParsedTable = {
      startIndex: 0,
      endIndex: 0,
      original: "",
      headers: ["A", "B"],
      alignments: ["left", "left"],
      rows: [["1", "2"]],
    }

    // #when
    const result = formatTable(table)

    // #then
    expect(result).toBe(`| A | B |
| - | - |
| 1 | 2 |`)
  })

  test("should pad columns based on longest content", () => {
    // #given
    const table: ParsedTable = {
      startIndex: 0,
      endIndex: 0,
      original: "",
      headers: ["Name", "Age"],
      alignments: ["left", "left"],
      rows: [
        ["John", "25"],
        ["Elizabeth", "30"],
      ],
    }

    // #when
    const result = formatTable(table)

    // #then
    const lines = result.split("\n")
    expect(lines[0]).toBe("| Name      | Age |")
    expect(lines[2]).toBe("| John      | 25  |")
    expect(lines[3]).toBe("| Elizabeth | 30  |")
  })

  test("should handle right alignment", () => {
    // #given
    const table: ParsedTable = {
      startIndex: 0,
      endIndex: 0,
      original: "",
      headers: ["Score"],
      alignments: ["right"],
      rows: [["100"], ["5"]],
    }

    // #when
    const result = formatTable(table)

    // #then
    const lines = result.split("\n")
    expect(lines[0]).toBe("| Score |")
    expect(lines[1]).toBe("| ----: |")
    expect(lines[2]).toBe("|   100 |")
    expect(lines[3]).toBe("|     5 |")
  })

  test("should handle center alignment", () => {
    // #given
    const table: ParsedTable = {
      startIndex: 0,
      endIndex: 0,
      original: "",
      headers: ["Status"],
      alignments: ["center"],
      rows: [["OK"], ["ERROR"]],
    }

    // #when
    const result = formatTable(table)

    // #then
    const lines = result.split("\n")
    expect(lines[1]).toBe("| :----: |")
  })

  test("should handle CJK characters with correct width", () => {
    // #given
    const table: ParsedTable = {
      startIndex: 0,
      endIndex: 0,
      original: "",
      headers: ["Name", "Status"],
      alignments: ["left", "left"],
      rows: [
        ["张三", "Active"],
        ["John", "Inactive"],
      ],
    }

    // #when
    const result = formatTable(table)

    // #then
    const lines = result.split("\n")
    expect(lines[2]).toBe("| 张三 | Active   |")
    expect(lines[3]).toBe("| John | Inactive |")
  })
})

describe("formatTablesInText", () => {
  test("should replace table in text with formatted version", () => {
    // #given
    const text = `Before

| A | B |
|---|---|
| 1 | 2 |

After`
    const tables: ParsedTable[] = [
      {
        startIndex: 8,
        endIndex: 34,
        original: `| A | B |
|---|---|
| 1 | 2 |`,
        headers: ["A", "B"],
        alignments: ["left", "left"],
        rows: [["1", "2"]],
      },
    ]

    // #when
    const result = formatTablesInText(text, tables)

    // #then
    expect(result).toContain("Before")
    expect(result).toContain("After")
    expect(result).toContain("| A | B |")
  })

  test("should handle multiple tables", () => {
    // #given
    const text = `| A |
|---|
| 1 |

| B |
|---|
| 2 |`
    const tables: ParsedTable[] = [
      {
        startIndex: 0,
        endIndex: 17,
        original: `| A |
|---|
| 1 |`,
        headers: ["A"],
        alignments: ["left"],
        rows: [["1"]],
      },
      {
        startIndex: 19,
        endIndex: 36,
        original: `| B |
|---|
| 2 |`,
        headers: ["B"],
        alignments: ["left"],
        rows: [["2"]],
      },
    ]

    // #when
    const result = formatTablesInText(text, tables)

    // #then
    expect(result).toContain("| A |")
    expect(result).toContain("| B |")
  })

  test("should return original text when no tables", () => {
    // #given
    const text = "Just some text"
    const tables: ParsedTable[] = []

    // #when
    const result = formatTablesInText(text, tables)

    // #then
    expect(result).toBe(text)
  })
})
