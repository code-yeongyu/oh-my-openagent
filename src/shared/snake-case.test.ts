import { describe, expect, test } from "bun:test"
import {
  camelToSnake,
  snakeToCamel,
  objectToSnakeCase,
  objectToCamelCase,
} from "./snake-case"

describe("camelToSnake", () => {
  test("converts basic camelCase to snake_case", () => {
    //#given
    const input = "camelCase"

    //#when
    const result = camelToSnake(input)

    //#then
    expect(result).toBe("camel_case")
  })

  test("converts multiple words", () => {
    //#given
    const input = "myVariableName"

    //#when
    const result = camelToSnake(input)

    //#then
    expect(result).toBe("my_variable_name")
  })

  test("handles consecutive uppercase letters", () => {
    //#given
    const input = "XMLParser"

    //#when
    const result = camelToSnake(input)

    //#then
    expect(result).toBe("_x_m_l_parser")
  })

  test("returns empty string for empty input", () => {
    //#given
    const input = ""

    //#when
    const result = camelToSnake(input)

    //#then
    expect(result).toBe("")
  })

  test("returns unchanged for all lowercase", () => {
    //#given
    const input = "lowercase"

    //#when
    const result = camelToSnake(input)

    //#then
    expect(result).toBe("lowercase")
  })

  test("handles all uppercase letters", () => {
    //#given
    const input = "ABC"

    //#when
    const result = camelToSnake(input)

    //#then
    expect(result).toBe("_a_b_c")
  })

  test("handles first letter uppercase", () => {
    //#given
    const input = "MyClass"

    //#when
    const result = camelToSnake(input)

    //#then
    expect(result).toBe("_my_class")
  })
})

describe("snakeToCamel", () => {
  test("converts basic snake_case to camelCase", () => {
    //#given
    const input = "snake_case"

    //#when
    const result = snakeToCamel(input)

    //#then
    expect(result).toBe("snakeCase")
  })

  test("converts multiple words", () => {
    //#given
    const input = "my_variable_name"

    //#when
    const result = snakeToCamel(input)

    //#then
    expect(result).toBe("myVariableName")
  })

  test("returns empty string for empty input", () => {
    //#given
    const input = ""

    //#when
    const result = snakeToCamel(input)

    //#then
    expect(result).toBe("")
  })

  test("returns unchanged when no underscores", () => {
    //#given
    const input = "nochange"

    //#when
    const result = snakeToCamel(input)

    //#then
    expect(result).toBe("nochange")
  })

  test("preserves trailing underscore", () => {
    //#given
    const input = "trailing_"

    //#when
    const result = snakeToCamel(input)

    //#then
    expect(result).toBe("trailing_")
  })

  test("converts leading underscore followed by lowercase", () => {
    //#given
    const input = "_leading"

    //#when
    const result = snakeToCamel(input)

    //#then
    expect(result).toBe("Leading")
  })
})

describe("objectToSnakeCase", () => {
  describe("shallow conversion", () => {
    test("converts simple object keys", () => {
      //#given
      const input = { myKey: 1, anotherKey: 2 }

      //#when
      const result = objectToSnakeCase(input, false)

      //#then
      expect(result).toEqual({ my_key: 1, another_key: 2 })
    })

    test("does not convert nested object keys when deep is false", () => {
      //#given
      const input = { outerKey: { innerKey: 1 } }

      //#when
      const result = objectToSnakeCase(input, false)

      //#then
      expect(result).toEqual({ outer_key: { innerKey: 1 } })
    })

    test("returns empty object for empty input", () => {
      //#given
      const input = {}

      //#when
      const result = objectToSnakeCase(input, false)

      //#then
      expect(result).toEqual({})
    })
  })

  describe("deep conversion", () => {
    test("converts nested object keys recursively", () => {
      //#given
      const input = { outerKey: { innerKey: { deepKey: 1 } } }

      //#when
      const result = objectToSnakeCase(input)

      //#then
      expect(result).toEqual({ outer_key: { inner_key: { deep_key: 1 } } })
    })

    test("converts objects inside arrays", () => {
      //#given
      const input = { myArray: [{ itemKey: 1 }, { itemKey: 2 }] }

      //#when
      const result = objectToSnakeCase(input)

      //#then
      expect(result).toEqual({ my_array: [{ item_key: 1 }, { item_key: 2 }] })
    })

    test("preserves non-object values in arrays", () => {
      //#given
      const input = { myArray: [1, "string", null, { itemKey: 1 }] }

      //#when
      const result = objectToSnakeCase(input)

      //#then
      expect(result).toEqual({ my_array: [1, "string", null, { item_key: 1 }] })
    })

    test("preserves primitive values", () => {
      //#given
      const input = { stringVal: "hello", numVal: 42, boolVal: true, nullVal: null }

      //#when
      const result = objectToSnakeCase(input)

      //#then
      expect(result).toEqual({ string_val: "hello", num_val: 42, bool_val: true, null_val: null })
    })
  })
})

describe("objectToCamelCase", () => {
  describe("shallow conversion", () => {
    test("converts simple object keys", () => {
      //#given
      const input = { my_key: 1, another_key: 2 }

      //#when
      const result = objectToCamelCase(input, false)

      //#then
      expect(result).toEqual({ myKey: 1, anotherKey: 2 })
    })

    test("does not convert nested object keys when deep is false", () => {
      //#given
      const input = { outer_key: { inner_key: 1 } }

      //#when
      const result = objectToCamelCase(input, false)

      //#then
      expect(result).toEqual({ outerKey: { inner_key: 1 } })
    })

    test("returns empty object for empty input", () => {
      //#given
      const input = {}

      //#when
      const result = objectToCamelCase(input, false)

      //#then
      expect(result).toEqual({})
    })
  })

  describe("deep conversion", () => {
    test("converts nested object keys recursively", () => {
      //#given
      const input = { outer_key: { inner_key: { deep_key: 1 } } }

      //#when
      const result = objectToCamelCase(input)

      //#then
      expect(result).toEqual({ outerKey: { innerKey: { deepKey: 1 } } })
    })

    test("converts objects inside arrays", () => {
      //#given
      const input = { my_array: [{ item_key: 1 }, { item_key: 2 }] }

      //#when
      const result = objectToCamelCase(input)

      //#then
      expect(result).toEqual({ myArray: [{ itemKey: 1 }, { itemKey: 2 }] })
    })

    test("preserves non-object values in arrays", () => {
      //#given
      const input = { my_array: [1, "string", null, { item_key: 1 }] }

      //#when
      const result = objectToCamelCase(input)

      //#then
      expect(result).toEqual({ myArray: [1, "string", null, { itemKey: 1 }] })
    })

    test("preserves primitive values", () => {
      //#given
      const input = { string_val: "hello", num_val: 42, bool_val: true, null_val: null }

      //#when
      const result = objectToCamelCase(input)

      //#then
      expect(result).toEqual({ stringVal: "hello", numVal: 42, boolVal: true, nullVal: null })
    })
  })
})
