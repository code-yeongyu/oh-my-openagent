import { describe, expect, test } from "bun:test"
import { deepMerge, isPlainObject } from "./deep-merge"

type AnyObject = Record<string, unknown>

describe("isPlainObject", () => {
  test.each([
    ["null", null],
    ["undefined", undefined],
    ["string", "hello"],
    ["number", 42],
    ["boolean", true],
    ["array", [1, 2, 3]],
    ["Date", new Date()],
    ["RegExp", /test/],
  ] as const)("returns false for %s", (_label, value) => {
    // when
    const result = isPlainObject(value)

    // then
    expect(result).toBe(false)
  })

  test.each([
    ["plain object", { a: 1 }],
    ["empty object", {}],
    ["nested object", { a: { b: 1 } }],
  ] as const)("returns true for %s", (_label, value) => {
    // when
    const result = isPlainObject(value)

    // then
    expect(result).toBe(true)
  })
})

describe("deepMerge", () => {
  describe("basic merging", () => {
    test.each([
      ["merges two simple objects", { a: 1 }, { b: 2 }, { a: 1, b: 2 }],
      ["override value takes precedence", { a: 1 }, { a: 2 }, { a: 2 }],
      [
        "deeply merges nested objects",
        { a: { b: 1, c: 2 } },
        { a: { b: 10 } },
        { a: { b: 10, c: 2 } },
      ],
      [
        "handles multiple levels of nesting",
        { a: { b: { c: { d: 1 } } } },
        { a: { b: { c: { e: 2 } } } },
        { a: { b: { c: { d: 1, e: 2 } } } },
      ],
    ] satisfies Array<[string, AnyObject, AnyObject, AnyObject]>)("%s", (_label, base, override, expected) => {
      // when
      const result = deepMerge<AnyObject>(base, override)

      // then
      expect(result).toEqual(expected)
    })
  })

  describe("edge cases", () => {
    test.each([
      ["returns undefined when both are undefined", undefined, undefined, undefined],
      ["returns override when base is undefined", undefined, { a: 1 }, { a: 1 }],
      ["returns base when override is undefined", { a: 1 }, undefined, { a: 1 }],
    ] satisfies Array<[string, AnyObject | undefined, AnyObject | undefined, AnyObject | undefined]>)("%s", (_label, base, override, expected) => {
      // when
      const result = deepMerge<AnyObject>(base, override)

      // then
      expect(result).toEqual(expected)
    })

    test("preserves base value when override value is undefined", () => {
      // given
      const base = { a: 1, b: 2 }
      const override = { a: undefined, b: 3 }

      // when
      const result = deepMerge<AnyObject>(base, override)

      // then
      expect(result).toEqual({ a: 1, b: 3 })
    })

    test("does not mutate base object", () => {
      // given
      const base = { a: 1, b: { c: 2 } }
      const override = { b: { c: 10 } }
      const originalBase = JSON.parse(JSON.stringify(base))

      // when
      deepMerge(base, override)

      // then
      expect(base).toEqual(originalBase)
    })
  })

  describe("array handling", () => {
    test.each([
      ["replaces arrays instead of merging them", { arr: [1, 2] }, { arr: [3, 4, 5] }, { arr: [3, 4, 5] }],
      ["replaces nested arrays", { a: { arr: [1, 2, 3] } }, { a: { arr: [4] } }, { a: { arr: [4] } }],
    ] satisfies Array<[string, AnyObject, AnyObject, AnyObject]>)("%s", (_label, base, override, expected) => {
      // when
      const result = deepMerge<AnyObject>(base, override)

      // then
      expect(result).toEqual(expected)
    })
  })

  describe("prototype pollution protection", () => {
    test("ignores __proto__ key", () => {
      // given
      const base: AnyObject = { a: 1 }
      const override: AnyObject = JSON.parse('{"__proto__": {"polluted": true}, "b": 2}')

      // when
      const result = deepMerge(base, override)

      // then
      expect(result).toEqual({ a: 1, b: 2 })
      expect(({} as AnyObject).polluted).toBeUndefined()
    })

    test.each([
      ["constructor", { constructor: { polluted: true }, b: 2 }],
      ["prototype", { prototype: { polluted: true }, b: 2 }],
    ] satisfies Array<[string, AnyObject]>)("ignores %s key", (key, override) => {
      // given
      const base: AnyObject = { a: 1 }

      // when
      const result = deepMerge(base, override)

      // then
      const merged = expectMergedObject(result)
      expect(merged.b).toBe(2)
      if (key === "prototype") {
        expect(merged.prototype).toBeUndefined()
        return
      }
      expect(merged[key]).not.toEqual({ polluted: true })
    })
  })

  describe("depth limit", () => {
    test("returns override when depth exceeds MAX_DEPTH", () => {
      // given
      const createDeepObject = (depth: number, leaf: AnyObject): AnyObject => {
        if (depth === 0) return leaf
        return { nested: createDeepObject(depth - 1, leaf) }
      }
      const base = createDeepObject(55, { baseKey: "base" })
      const override = createDeepObject(55, { overrideKey: "override" })

      // when
      const result = deepMerge(base, override)

      // then
      let current = expectMergedObject(result)
      for (let i = 0; i < 55; i++) {
        current = expectMergedObject(current.nested)
      }
      expect(current.overrideKey).toBe("override")
      expect(current.baseKey).toBeUndefined()
    })
  })
})

function expectMergedObject(value: unknown): AnyObject {
  if (!isPlainObject(value)) {
    throw new Error("expected deepMerge to return a plain object")
  }

  return value
}
