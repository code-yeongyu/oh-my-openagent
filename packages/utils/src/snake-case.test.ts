import { describe, expect, test } from "bun:test"

import { camelToSnake, objectToCamelCase, objectToSnakeCase, snakeToCamel, transformObjectKeys } from "./snake-case"

describe("snake-case utilities", () => {
  describe("#given string converters #when converting key names #then only matching separators change", () => {
    test("converts camelCase and PascalCase letters to snake_case", () => {
      expect(camelToSnake("camelCaseKey")).toBe("camel_case_key")
      expect(camelToSnake("PascalCaseKey")).toBe("_pascal_case_key")
      expect(camelToSnake("already_snake")).toBe("already_snake")
    })

    test("converts snake_case segments to camelCase", () => {
      expect(snakeToCamel("snake_case_key")).toBe("snakeCaseKey")
      expect(snakeToCamel("alreadyCamel")).toBe("alreadyCamel")
      expect(snakeToCamel("multiple_word_key")).toBe("multipleWordKey")
    })
  })

  describe("#given object key transformers #when deep mode is enabled #then nested plain objects are transformed", () => {
    test("converts nested object keys and object entries inside arrays to snake_case", () => {
      const input = {
        topLevelKey: "value",
        nestedConfig: {
          innerKey: 1,
        },
        arrayItems: [{ childKey: true }, "literal"],
      }

      expect(objectToSnakeCase(input)).toEqual({
        top_level_key: "value",
        nested_config: {
          inner_key: 1,
        },
        array_items: [{ child_key: true }, "literal"],
      })
    })

    test("converts nested object keys and object entries inside arrays to camelCase", () => {
      const input = {
        top_level_key: "value",
        nested_config: {
          inner_key: 1,
        },
        array_items: [{ child_key: true }, "literal"],
      }

      expect(objectToCamelCase(input)).toEqual({
        topLevelKey: "value",
        nestedConfig: {
          innerKey: 1,
        },
        arrayItems: [{ childKey: true }, "literal"],
      })
    })
  })

  describe("#given shallow mode or non-plain values #when transforming keys #then values remain intact", () => {
    test("does not transform nested keys when deep mode is disabled", () => {
      const input = {
        topLevelKey: {
          innerKey: "unchanged",
        },
      }

      expect(objectToSnakeCase(input, false)).toEqual({
        top_level_key: {
          innerKey: "unchanged",
        },
      })
    })

    test("keeps dates and primitive array values unchanged", () => {
      const date = new Date("2026-06-27T00:00:00.000Z")
      const input = {
        createdAt: date,
        values: [1, null, "text"],
      }

      expect(objectToSnakeCase(input)).toEqual({
        created_at: date,
        values: [1, null, "text"],
      })
    })

    test("uses a custom transformer for top-level and nested keys", () => {
      const input = {
        firstKey: {
          secondKey: "value",
        },
      }

      expect(transformObjectKeys(input, (key) => `x_${key}`)).toEqual({
        x_firstKey: {
          x_secondKey: "value",
        },
      })
    })
  })
})
