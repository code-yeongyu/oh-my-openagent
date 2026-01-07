import { describe, expect, test } from "bun:test"
import { parseMarkdownTables } from "./parser"

describe("parseMarkdownTables", () => {
  test("should parse a simple markdown table", () => {
    // #given
    const text = `| Name | Age |
|------|-----|
| John | 25 |
| Jane | 30 |`

    // #when
    const tables = parseMarkdownTables(text)

    // #then
    expect(tables).toHaveLength(1)
    expect(tables[0].headers).toEqual(["Name", "Age"])
    expect(tables[0].rows).toEqual([
      ["John", "25"],
      ["Jane", "30"],
    ])
    expect(tables[0].alignments).toEqual(["left", "left"])
  })

  test("should parse table with different alignments", () => {
    // #given
    const text = `| Left | Center | Right |
|:-----|:------:|------:|
| A    | B      | C     |`

    // #when
    const tables = parseMarkdownTables(text)

    // #then
    expect(tables).toHaveLength(1)
    expect(tables[0].alignments).toEqual(["left", "center", "right"])
  })

  test("should parse multiple tables in text", () => {
    // #given
    const text = `Some text before

| A | B |
|---|---|
| 1 | 2 |

Some text in between

| X | Y | Z |
|---|---|---|
| a | b | c |

Some text after`

    // #when
    const tables = parseMarkdownTables(text)

    // #then
    expect(tables).toHaveLength(2)
    expect(tables[0].headers).toEqual(["A", "B"])
    expect(tables[1].headers).toEqual(["X", "Y", "Z"])
  })

  test("should return empty array for text without tables", () => {
    // #given
    const text = `Just some regular text
without any tables`

    // #when
    const tables = parseMarkdownTables(text)

    // #then
    expect(tables).toHaveLength(0)
  })

  test("should not parse incomplete table (missing separator row)", () => {
    // #given
    const text = `| Header |
| Data |`

    // #when
    const tables = parseMarkdownTables(text)

    // #then
    expect(tables).toHaveLength(0)
  })

  test("should capture correct start and end indices", () => {
    // #given
    const prefix = "Some text\n\n"
    const tableText = `| A | B |
|---|---|
| 1 | 2 |`
    const text = prefix + tableText

    // #when
    const tables = parseMarkdownTables(text)

    // #then
    expect(tables).toHaveLength(1)
    expect(tables[0].startIndex).toBe(prefix.length)
    expect(tables[0].endIndex).toBe(prefix.length + tableText.length)
    expect(tables[0].original).toBe(tableText)
  })

  test("should handle tables with CJK characters", () => {
    // #given
    const text = `| Name | Status |
|------|--------|
| 张三 | Active |
| 李四 | Inactive |`

    // #when
    const tables = parseMarkdownTables(text)

    // #then
    expect(tables).toHaveLength(1)
    expect(tables[0].rows[0]).toEqual(["张三", "Active"])
    expect(tables[0].rows[1]).toEqual(["李四", "Inactive"])
  })

  test("should handle tables with emoji", () => {
    // #given
    const text = `| Icon | Label |
|------|-------|
| 🎉 | Party |
| 👨‍👩‍👧 | Family |`

    // #when
    const tables = parseMarkdownTables(text)

    // #then
    expect(tables).toHaveLength(1)
    expect(tables[0].rows[0]).toEqual(["🎉", "Party"])
  })
})
