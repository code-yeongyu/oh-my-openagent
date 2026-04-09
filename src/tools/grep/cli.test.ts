/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { parseOutput, parseCountOutput } from "./cli"

describe("parseOutput", () => {
  describe("#given LF line endings", () => {
    test("#then parses content matches", () => {
      const output = "src/foo.ts:10:  hello()\nsrc/foo.ts:20:  world()\n"

      const matches = parseOutput(output)

      expect(matches).toEqual([
        { file: "src/foo.ts", line: 10, text: "  hello()" },
        { file: "src/foo.ts", line: 20, text: "  world()" },
      ])
    })

    test("#then parses files-only matches", () => {
      const output = "src/foo.ts\nsrc/bar.ts\n"

      const matches = parseOutput(output, true)

      expect(matches).toEqual([
        { file: "src/foo.ts", line: 0, text: "" },
        { file: "src/bar.ts", line: 0, text: "" },
      ])
    })
  })

  describe("#given CRLF line endings", () => {
    test("#then parses content matches", () => {
      const output = "src/foo.ts:10:  hello()\r\nsrc/foo.ts:20:  world()\r\n"

      const matches = parseOutput(output)

      expect(matches).toEqual([
        { file: "src/foo.ts", line: 10, text: "  hello()" },
        { file: "src/foo.ts", line: 20, text: "  world()" },
      ])
    })

    test("#then parses files-only matches", () => {
      const output = "src/foo.ts\r\nsrc/bar.ts\r\n"

      const matches = parseOutput(output, true)

      expect(matches).toEqual([
        { file: "src/foo.ts", line: 0, text: "" },
        { file: "src/bar.ts", line: 0, text: "" },
      ])
    })

    test("#then captured text has no trailing carriage return", () => {
      const output = "file.py:10:  self.proxy = None\r\nfile.py:20:  proxy.start()\r\n"

      const matches = parseOutput(output)

      for (const m of matches) {
        expect(m.text.endsWith("\r")).toBe(false)
        expect(m.file.endsWith("\r")).toBe(false)
      }
      expect(matches).toHaveLength(2)
    })
  })

  describe("#given empty output", () => {
    test("#then returns empty array", () => {
      expect(parseOutput("")).toEqual([])
      expect(parseOutput("  \n  ")).toEqual([])
      expect(parseOutput("  \r\n  ")).toEqual([])
    })
  })
})

describe("parseCountOutput", () => {
  describe("#given LF line endings", () => {
    test("#then parses count results", () => {
      const output = "src/foo.ts:3\nsrc/bar.ts:1\n"

      const results = parseCountOutput(output)

      expect(results).toEqual([
        { file: "src/foo.ts", count: 3 },
        { file: "src/bar.ts", count: 1 },
      ])
    })
  })

  describe("#given CRLF line endings", () => {
    test("#then parses count results", () => {
      const output = "src/foo.ts:3\r\nsrc/bar.ts:1\r\n"

      const results = parseCountOutput(output)

      expect(results).toEqual([
        { file: "src/foo.ts", count: 3 },
        { file: "src/bar.ts", count: 1 },
      ])
    })
  })

  describe("#given empty output", () => {
    test("#then returns empty array", () => {
      expect(parseCountOutput("")).toEqual([])
      expect(parseCountOutput("  \r\n  ")).toEqual([])
    })
  })
})
