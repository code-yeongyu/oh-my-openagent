import { describe, expect, test } from "bun:test"

import { parseJsoncSafe } from "../internal/jsonc-parse"
import { applyOmoConfigEdit } from "./surgical-edit"

function parsed(content: string): unknown {
  const result = parseJsoncSafe<unknown>(content)
  expect(result.errors).toEqual([])
  return result.data
}

describe("applyOmoConfigEdit", () => {
  test("#given a tab-indented object without trailing commas #when a member is added #then it follows the last member in the same style", () => {
    // given
    const content = '{\n\t"a": 1,\n\t"b": 2 // keep\n}\n'

    // when
    const next = applyOmoConfigEdit(content, { path: ["c"], value: [3] })

    // then
    expect(next).toBe('{\n\t"a": 1,\n\t"b": 2, // keep\n\t"c": [\n\t\t3\n\t]\n}\n')
    expect(parsed(next)).toEqual({ a: 1, b: 2, c: [3] })
  })

  test("#given an object whose members end with trailing commas #when a member is added #then the new member gets one too", () => {
    // given
    const content = '{\n    "a": 1,\n}\n'

    // when
    const next = applyOmoConfigEdit(content, { path: ["b"], value: true })

    // then
    expect(next).toBe('{\n    "a": 1,\n    "b": true,\n}\n')
  })

  test("#given a missing nested parent #when a deep value is added #then the nearest existing object gains one nested member", () => {
    // given
    const content = '{\n  // agents\n  "agents": {\n    "oracle": {}\n  }\n}\n'

    // when
    const next = applyOmoConfigEdit(content, { path: ["agents", "explore", "model"], value: "zai/glm-5.3" })

    // then
    expect(next).toContain("// agents")
    expect(parsed(next)).toEqual({ agents: { oracle: {}, explore: { model: "zai/glm-5.3" } } })
  })

  test("#given an empty object #when a member is added #then the object is opened onto its own lines", () => {
    // given
    const content = '// top\n{}\n'

    // when
    const next = applyOmoConfigEdit(content, { path: ["a"], value: 1 })

    // then
    expect(next).toBe('// top\n{\n  "a": 1\n}\n')
  })

  test("#given the last member has no trailing comma #when it is removed #then the previous member's comma goes with it", () => {
    // given
    const content = '{\n  "a": 1, // first\n  "b": 2\n}\n'

    // when
    const next = applyOmoConfigEdit(content, { path: ["b"], value: undefined })

    // then
    expect(next).toBe('{\n  "a": 1 // first\n}\n')
    expect(parsed(next)).toEqual({ a: 1 })
  })

  test("#given a middle member with a comment #when it is removed #then only its own line goes", () => {
    // given
    const content = '{\n  "a": 1,\n  "b": 2, // drop me\n  "c": 3,\n}\n'

    // when
    const next = applyOmoConfigEdit(content, { path: ["b"], value: undefined })

    // then
    expect(next).toBe('{\n  "a": 1,\n  "c": 3,\n}\n')
  })

  test("#given two members on one line #when one is added after them #then the edit falls back to jsonc-parser and stays valid", () => {
    // given
    const content = '{ "a": 1, "b": 2 }\n'

    // when
    const next = applyOmoConfigEdit(content, { path: ["c"], value: 3 })

    // then
    expect(parsed(next)).toEqual({ a: 1, b: 2, c: 3 })
  })

  test("#given an existing value #when it is replaced #then sibling lines and comments are untouched", () => {
    // given
    const content = '{\n  /* keep */\n  "a": [1, 2,], // keep too\n  "b": 2,\n}\n'

    // when
    const next = applyOmoConfigEdit(content, { path: ["b"], value: 5 })

    // then
    expect(next).toBe('{\n  /* keep */\n  "a": [1, 2,], // keep too\n  "b": 5,\n}\n')
  })

  test("#given two members sharing a line between block comments #when the first is removed #then the second survives", () => {
    // given
    const content = '{\n  "a": 1, /* x */ "b": 2 /* y */\n}\n'

    // when
    const next = applyOmoConfigEdit(content, { path: ["a"], value: undefined })

    // then
    expect(parsed(next)).toEqual({ b: 2 })
  })

  test("#given a CRLF file with trailing comments #when a member is added #then line endings, comments and indentation are kept", () => {
    // given
    const content = '{\r\n    "a": 1, // keep me\r\n    "b": {\r\n        "c": true\r\n    }\r\n}\r\n'

    // when
    const next = applyOmoConfigEdit(content, { path: ["d"], value: { e: 1 } })

    // then
    expect(next).toBe('{\r\n    "a": 1, // keep me\r\n    "b": {\r\n        "c": true\r\n    },\r\n    "d": {\r\n        "e": 1\r\n    }\r\n}\r\n')
  })

  test("#given a CRLF file #when a member is removed #then the other lines are byte-identical", () => {
    // given
    const content = '{\r\n  "a": 1, // first\r\n  "b": 2\r\n}\r\n'

    // when
    const next = applyOmoConfigEdit(content, { path: ["b"], value: undefined })

    // then
    expect(next).toBe('{\r\n  "a": 1 // first\r\n}\r\n')
  })

  test("#given a tab-indented file with an empty nested object #when a member is added to it #then it is indented with tabs", () => {
    // given
    const content = '{\n\t"agents": {},\n\t"x": 1\n}\n'

    // when
    const next = applyOmoConfigEdit(content, { path: ["agents", "oracle"], value: "m" })

    // then
    expect(next).toBe('{\n\t"agents": {\n\t\t"oracle": "m"\n\t},\n\t"x": 1\n}\n')
  })

  test.each([
    ['{\n  "a": 1,\n}\n', '{\n}\n'],
    ['{\r\n  "a": 1,\r\n}\r\n', '{\r\n}\r\n'],
  ])("#given %p whose sole member has a trailing comma #when it is removed #then the object stays valid", (content, expected) => {
    // when
    const next = applyOmoConfigEdit(content, { path: ["a"], value: undefined })

    // then
    expect(next).toBe(expected)
  })
})
