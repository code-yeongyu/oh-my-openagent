import { describe, expect, test } from "bun:test"
import { deepMerge, isPlainObject } from "./deep-merge"

type AnyObject = Record<string, unknown>

describe("isPlainObject", () => {
  test("returns false for null", () => {
    //#given
    const value = null

    //#when
    const result = isPlainObject(value)

    //#then
    expect(result).toBe(false)
  })

  test("returns false for undefined", () => {
    //#given
    const value = undefined

    //#when
    const result = isPlainObject(value)

    //#then
    expect(result).toBe(false)
  })

  test("returns false for string", () => {
    //#given
    const value = "hello"

    //#when
    const result = isPlainObject(value)

    //#then
    expect(result).toBe(false)
  })

  test("returns false for number", () => {
    //#given
    const value = 42

    //#when
    const result = isPlainObject(value)

    //#then
    expect(result).toBe(false)
  })

  test("returns false for boolean", () => {
    //#given
    const value = true

    //#when
    const result = isPlainObject(value)

    //#then
    expect(result).toBe(false)
  })

  test("returns false for array", () => {
    //#given
    const value = [1, 2, 3]

    //#when
    const result = isPlainObject(value)

    //#then
    expect(result).toBe(false)
  })

  test("returns false for Date", () => {
    //#given
    const value = new Date()

    //#when
    const result = isPlainObject(value)

    //#then
    expect(result).toBe(false)
  })

  test("returns false for RegExp", () => {
    //#given
    const value = /test/

    //#when
    const result = isPlainObject(value)

    //#then
    expect(result).toBe(false)
  })

  test("returns true for plain object", () => {
    //#given
    const value = { a: 1 }

    //#when
    const result = isPlainObject(value)

    //#then
    expect(result).toBe(true)
  })

  test("returns true for empty object", () => {
    //#given
    const value = {}

    //#when
    const result = isPlainObject(value)

    //#then
    expect(result).toBe(true)
  })

  test("returns true for nested object", () => {
    //#given
    const value = { a: { b: 1 } }

    //#when
    const result = isPlainObject(value)

    //#then
    expect(result).toBe(true)
  })
})

describe("deepMerge", () => {
  describe("basic merging", () => {
    test("merges two simple objects", () => {
      //#given
      const base: AnyObject = { a: 1 }
      const override: AnyObject = { b: 2 }

      //#when
      const result = deepMerge(base, override)

      //#then
      expect(result).toEqual({ a: 1, b: 2 })
    })

    test("override value takes precedence", () => {
      //#given
      const base = { a: 1 }
      const override = { a: 2 }

      //#when
      const result = deepMerge(base, override)

      //#then
      expect(result).toEqual({ a: 2 })
    })

    test("deeply merges nested objects", () => {
      //#given
      const base: AnyObject = { a: { b: 1, c: 2 } }
      const override: AnyObject = { a: { b: 10 } }

      //#when
      const result = deepMerge(base, override)

      //#then
      expect(result).toEqual({ a: { b: 10, c: 2 } })
    })

    test("handles multiple levels of nesting", () => {
      //#given
      const base: AnyObject = { a: { b: { c: { d: 1 } } } }
      const override: AnyObject = { a: { b: { c: { e: 2 } } } }

      //#when
      const result = deepMerge(base, override)

      //#then
      expect(result).toEqual({ a: { b: { c: { d: 1, e: 2 } } } })
    })
  })

  describe("edge cases", () => {
    test("returns undefined when both are undefined", () => {
      //#given
      const base = undefined
      const override = undefined

      //#when
      const result = deepMerge<AnyObject>(base, override)

      //#then
      expect(result).toBeUndefined()
    })

    test("returns override when base is undefined", () => {
      //#given
      const base = undefined
      const override = { a: 1 }

      //#when
      const result = deepMerge<AnyObject>(base, override)

      //#then
      expect(result).toEqual({ a: 1 })
    })

    test("returns base when override is undefined", () => {
      //#given
      const base = { a: 1 }
      const override = undefined

      //#when
      const result = deepMerge<AnyObject>(base, override)

      //#then
      expect(result).toEqual({ a: 1 })
    })

    test("preserves base value when override value is undefined", () => {
      //#given
      const base = { a: 1, b: 2 }
      const override = { a: undefined, b: 3 }

      //#when
      const result = deepMerge(base, override)

      //#then
      expect(result).toEqual({ a: 1, b: 3 })
    })

    test("does not mutate base object", () => {
      //#given
      const base = { a: 1, b: { c: 2 } }
      const override = { b: { c: 10 } }
      const originalBase = JSON.parse(JSON.stringify(base))

      //#when
      deepMerge(base, override)

      //#then
      expect(base).toEqual(originalBase)
    })
  })

  describe("array handling", () => {
    test("replaces arrays instead of merging them", () => {
      //#given
      const base = { arr: [1, 2] }
      const override = { arr: [3, 4, 5] }

      //#when
      const result = deepMerge(base, override)

      //#then
      expect(result).toEqual({ arr: [3, 4, 5] })
    })

    test("replaces nested arrays", () => {
      //#given
      const base = { a: { arr: [1, 2, 3] } }
      const override = { a: { arr: [4] } }

      //#when
      const result = deepMerge(base, override)

      //#then
      expect(result).toEqual({ a: { arr: [4] } })
    })
  })

  describe("prototype pollution protection", () => {
    test("ignores __proto__ key", () => {
      //#given
      const base: AnyObject = { a: 1 }
      const override: AnyObject = JSON.parse('{"__proto__": {"polluted": true}, "b": 2}')

      //#when
      const result = deepMerge(base, override)

      //#then
      expect(result).toEqual({ a: 1, b: 2 })
      expect(({} as AnyObject).polluted).toBeUndefined()
    })

    test("ignores constructor key", () => {
      //#given
      const base: AnyObject = { a: 1 }
      const override: AnyObject = { constructor: { polluted: true }, b: 2 }

      //#when
      const result = deepMerge(base, override)

      //#then
      expect(result!.b).toBe(2)
      expect(result!["constructor"]).not.toEqual({ polluted: true })
    })

    test("ignores prototype key", () => {
      //#given
      const base: AnyObject = { a: 1 }
      const override: AnyObject = { prototype: { polluted: true }, b: 2 }

      //#when
      const result = deepMerge(base, override)

      //#then
      expect(result!.b).toBe(2)
      expect(result!.prototype).toBeUndefined()
    })
  })

  describe("depth limit", () => {
    test("returns override when depth exceeds MAX_DEPTH", () => {
      //#given
      const createDeepObject = (depth: number, leaf: AnyObject): AnyObject => {
        if (depth === 0) return leaf
        return { nested: createDeepObject(depth - 1, leaf) }
      }
      // Use different keys to distinguish base vs override
      const base = createDeepObject(55, { baseKey: "base" })
      const override = createDeepObject(55, { overrideKey: "override" })

      //#when
      const result = deepMerge(base, override)

      //#then
      // Navigate to depth 55 (leaf level, beyond MAX_DEPTH of 50)
      let current: AnyObject = result as AnyObject
      for (let i = 0; i < 55; i++) {
        current = current.nested as AnyObject
      }
      // At depth 55, only override's key should exist because
      // override replaced base entirely at depth 51+ (beyond MAX_DEPTH)
      expect(current.overrideKey).toBe("override")
      expect(current.baseKey).toBeUndefined()
    })
  })
})
