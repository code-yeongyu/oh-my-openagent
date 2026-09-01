import { describe, expect, it } from "bun:test"

import { MemoryPatchParseError, parseMemoryPatch } from "./patch-parser"

describe("memory patch parser", () => {
  const invalidRows = [
    ["leading content", "\n*** Begin Patch\n*** End Patch", "patch must start"],
    ["indented begin", " *** Begin Patch\n*** End Patch", "patch must start"],
    ["missing end", "*** Begin Patch\n*** Delete File: a.md", "patch must end"],
    ["trailing garbage", "*** Begin Patch\n*** Delete File: a.md\n*** End Patch\nnope", "unexpected content"],
    ["empty operations", "*** Begin Patch\n*** End Patch", "no file operations"],
  ] as const

  for (const [condition, input, message] of invalidRows) {
    it(`#given ${condition} #when parsed #then a prefixed typed envelope error is thrown`, () => {
      // #given / #when
      const parse = () => parseMemoryPatch(input)

      // #then
      expect(parse).toThrow(MemoryPatchParseError)
      expect(parse).toThrow(`memory_apply_patch: ${message}`)
    })
  }

  it("#given CRLF and a terminal newline #when parsed #then the envelope is normalized", () => {
    // #given / #when
    const operations = parseMemoryPatch(
      "*** Begin Patch\r\n*** Add File: system/a.md\r\n+body\r\n*** End Patch\r\n",
    )

    // #then
    expect(operations).toEqual([
      { kind: "add", targetPath: "system/a.md", contentLines: ["body"] },
    ])
  })

  it("#given add update move and delete directives #when parsed #then paths and hunks preserve patch text", () => {
    // #given
    const input = [
      "*** Begin Patch",
      "*** Add File: system/a.md",
      "+one",
      "*** Update File: system/a.md",
      "*** Move to: system/b.md",
      "@@ optional heading",
      " one",
      "-two",
      "+three",
      "*** End of File",
      "*** Delete File: system/c.md",
      "*** End Patch",
    ].join("\n")

    // #when
    const operations = parseMemoryPatch(input)

    // #then
    expect(operations).toEqual([
      { kind: "add", targetPath: "system/a.md", contentLines: ["one"] },
      {
        kind: "update",
        sourcePath: "system/a.md",
        targetPath: "system/b.md",
        hunks: [{ lines: [" one", "-two", "+three"] }],
      },
      { kind: "delete", targetPath: "system/c.md" },
    ])
  })

  it("#given an update without an @@ marker #when parsed #then it forms one implicit hunk", () => {
    // #given / #when
    const operations = parseMemoryPatch([
      "*** Begin Patch",
      "*** Update File: a.md",
      "-old",
      "+new",
      "*** End Patch",
    ].join("\n"))

    // #then
    expect(operations[0]).toEqual({
      kind: "update",
      sourcePath: "a.md",
      targetPath: "a.md",
      hunks: [{ lines: ["-old", "+new"] }],
    })
  })

  it("#given malformed directive bodies #when parsed #then line-oriented failures stay actionable", () => {
    // #given
    const rows = [
      ["*** Add File: a.md\nbody", "expected '+' prefix"],
      ["*** Add File: a.md", "at least one + line"],
      ["*** Update File: a.md", "has no hunks"],
      ["*** Update File: a.md\ninvalid", "invalid hunk line"],
      ["*** Wat: a.md", "unknown patch directive"],
    ] as const

    for (const [body, expected] of rows) {
      // #when
      const parse = () => parseMemoryPatch(`*** Begin Patch\n${body}\n*** End Patch`)

      // #then
      expect(parse).toThrow(expected)
    }
  })
})
