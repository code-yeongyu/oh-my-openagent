/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { parseOutput, parseCountOutput } from "./cli"

describe("parseOutput", () => {
  describe("#given Unix-style paths", () => {
    test("#then parses file, line, and text correctly", () => {
      const output = "/home/user/project/src/index.ts:42:const foo = 'bar'"
      const matches = parseOutput(output)
      expect(matches).toEqual([
        { file: "/home/user/project/src/index.ts", line: 42, text: "const foo = 'bar'" },
      ])
    })

    test("#then handles multiple matches", () => {
      const output = [
        "src/a.ts:1:line one",
        "src/b.ts:20:line two",
      ].join("\n")
      const matches = parseOutput(output)
      expect(matches).toHaveLength(2)
      expect(matches[0]).toEqual({ file: "src/a.ts", line: 1, text: "line one" })
      expect(matches[1]).toEqual({ file: "src/b.ts", line: 20, text: "line two" })
    })
  })

  describe("#given Windows drive-letter paths with forward slashes (--path-separator=/)", () => {
    test("#then parses the full drive-letter path correctly", () => {
      const output = "C:/Users/dev/project/src/index.ts:42:const foo = 'bar'"
      const matches = parseOutput(output)
      expect(matches).toEqual([
        { file: "C:/Users/dev/project/src/index.ts", line: 42, text: "const foo = 'bar'" },
      ])
    })

    test("#then handles multiple Windows paths", () => {
      const output = [
        "D:/work/repo/file.cpp:10:#include <stdio.h>",
        "D:/work/repo/main.cpp:25:int main() {",
      ].join("\n")
      const matches = parseOutput(output)
      expect(matches).toHaveLength(2)
      expect(matches[0]).toEqual({ file: "D:/work/repo/file.cpp", line: 10, text: "#include <stdio.h>" })
      expect(matches[1]).toEqual({ file: "D:/work/repo/main.cpp", line: 25, text: "int main() {" })
    })
  })

  describe("#given text containing colons", () => {
    test("#then captures full text after line number", () => {
      const output = "src/config.ts:5:const url = 'http://localhost:3000'"
      const matches = parseOutput(output)
      expect(matches).toEqual([
        { file: "src/config.ts", line: 5, text: "const url = 'http://localhost:3000'" },
      ])
    })
  })

  describe("#given filesOnly mode", () => {
    test("#then returns file paths with line 0 and empty text", () => {
      const output = "src/a.ts\nsrc/b.ts\n"
      const matches = parseOutput(output, true)
      expect(matches).toEqual([
        { file: "src/a.ts", line: 0, text: "" },
        { file: "src/b.ts", line: 0, text: "" },
      ])
    })
  })

  describe("#given empty output", () => {
    test("#then returns empty array", () => {
      expect(parseOutput("")).toEqual([])
      expect(parseOutput("  \n  ")).toEqual([])
    })
  })
})

describe("parseCountOutput", () => {
  describe("#given Unix-style paths", () => {
    test("#then parses file and count correctly", () => {
      const output = "src/index.ts:5"
      const results = parseCountOutput(output)
      expect(results).toEqual([{ file: "src/index.ts", count: 5 }])
    })
  })

  describe("#given Windows drive-letter paths", () => {
    test("#then parses the full drive-letter path correctly", () => {
      const output = "C:/Users/dev/project/src/index.ts:12"
      const results = parseCountOutput(output)
      expect(results).toEqual([{ file: "C:/Users/dev/project/src/index.ts", count: 12 }])
    })
  })

  describe("#given empty output", () => {
    test("#then returns empty array", () => {
      expect(parseCountOutput("")).toEqual([])
    })
  })
})
