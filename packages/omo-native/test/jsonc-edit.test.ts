import { describe, expect, test } from "bun:test"

import { insertJsoncMember } from "../bin/lib/jsonc-edit.js"
import { parseJsonc } from "../bin/lib/jsonc.js"

const COMMENTED = `{
  // the user's own note
  "$schema": "https://example.test/omo.schema.json",
  "[opencode]": { "tmux": { "enabled": true } }, /* trailing block comment */
}
`

describe("insertJsoncMember", () => {
  describe("#given a commented document with a trailing comma", () => {
    test("#when a nested member is added under a missing block #then comments survive and the value parses back", () => {
      // when
      const next = insertJsoncMember(COMMENTED, ["[native]", "categories"], "quick", { model: "opencode-go/glm-5.2" })

      // then
      expect(next).toContain("// the user's own note")
      expect(next).toContain("/* trailing block comment */")
      expect(parseJsonc(next)).toEqual({
        "$schema": "https://example.test/omo.schema.json",
        "[opencode]": { tmux: { enabled: true } },
        "[native]": { categories: { quick: { model: "opencode-go/glm-5.2" } } },
      })
    })
  })

  describe("#given an existing object without a trailing comma", () => {
    test("#when a member is added #then a separating comma is inserted after the last value", () => {
      // given
      const text = `{\n  "[native]": {\n    "categories": { "quick": { "model": "a/b" } } // mine\n  }\n}\n`

      // when
      const next = insertJsoncMember(text, ["[native]", "categories"], "deep-low", { model: "c/d" })

      // then
      expect(next).toContain("// mine")
      expect(parseJsonc(next)).toEqual({ "[native]": { categories: { quick: { model: "a/b" }, "deep-low": { model: "c/d" } } } })
    })
  })

  describe("#given an empty document", () => {
    test("#when members are added one after another #then the result is pretty JSON holding both", () => {
      // when
      const next = insertJsoncMember(insertJsoncMember("{}\n", [], "defaultProvider", "kimi-coding"), [], "defaultModel", "k3")

      // then
      expect(JSON.parse(next)).toEqual({ defaultProvider: "kimi-coding", defaultModel: "k3" })
      expect(next).toBe(`{\n  "defaultProvider": "kimi-coding",\n  "defaultModel": "k3"\n}\n`)
    })
  })

  describe("#given a key or path the edit must not touch", () => {
    test("#when the key exists #then it throws instead of overwriting", () => {
      expect(() => insertJsoncMember(`{ "a": { "b": 1 } }`, ["a"], "b", 2)).toThrow("already exists")
    })

    test("#when a path segment is not an object #then it throws", () => {
      expect(() => insertJsoncMember(`{ "a": [1, 2] }`, ["a"], "b", 2)).toThrow(/^a is not an object$/)
    })

    test("#when the document is not an object #then it throws", () => {
      expect(() => insertJsoncMember(`[1]`, [], "b", 2)).toThrow("not an object")
    })
  })

  describe("#given strings holding comment and brace characters", () => {
    test("#when a member is added #then string data is left intact", () => {
      // given
      const text = `{ "url": "https://x.test/a//b}", "note": "/* not a comment */" }`

      // when
      const next = insertJsoncMember(text, [], "k", "v")

      // then
      expect(parseJsonc(next)).toEqual({ url: "https://x.test/a//b}", note: "/* not a comment */", k: "v" })
    })
  })
})
