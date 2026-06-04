import { describe, test, expect } from "bun:test"
import {
  camelToSnake,
  snakeToCamel,
  transformObjectKeys,
  objectToSnakeCase,
  objectToCamelCase,
} from "./snake-case"

describe("camelToSnake", () => {
  describe("#given simple camelCase strings", () => {
    test("#when converting single word, #then returns unchanged", () => {
      expect(camelToSnake("hello")).toBe("hello")
    })

    test("#when converting camelCase, #then converts to snake_case", () => {
      expect(camelToSnake("helloWorld")).toBe("hello_world")
    })

    test("#when converting multiple words, #then converts all to snake_case", () => {
      expect(camelToSnake("helloWorldFoo")).toBe("hello_world_foo")
    })
  })

  describe("#given edge cases", () => {
    test("#when converting empty string, #then returns empty string", () => {
      expect(camelToSnake("")).toBe("")
    })

    test("#when converting already snake_case, #then does not add extra underscores", () => {
      expect(camelToSnake("hello_world")).toBe("hello_world")
    })

    test("#when converting PascalCase, #then converts with leading underscore", () => {
      expect(camelToSnake("HelloWorld")).toBe("_hello_world")
    })

    test("#when converting consecutive capitals, #then adds underscore before each", () => {
      expect(camelToSnake("HTTPSConnection")).toBe("_h_t_t_p_s_connection")
    })

    test("#when converting single capital letter, #then converts to lowercase with underscore", () => {
      expect(camelToSnake("A")).toBe("_a")
    })
  })
})

describe("snakeToCamel", () => {
  describe("#given simple snake_case strings", () => {
    test("#when converting single word, #then returns unchanged", () => {
      expect(snakeToCamel("hello")).toBe("hello")
    })

    test("#when converting snake_case, #then converts to camelCase", () => {
      expect(snakeToCamel("hello_world")).toBe("helloWorld")
    })

    test("#when converting multiple underscores, #then converts all to camelCase", () => {
      expect(snakeToCamel("hello_world_foo")).toBe("helloWorldFoo")
    })
  })

  describe("#given edge cases", () => {
    test("#when converting empty string, #then returns empty string", () => {
      expect(snakeToCamel("")).toBe("")
    })

    test("#when converting already camelCase, #then returns unchanged", () => {
      expect(snakeToCamel("helloWorld")).toBe("helloWorld")
    })

    test("#when converting leading underscore, #then converts following letters", () => {
      expect(snakeToCamel("_hello_world")).toBe("HelloWorld")
    })

    test("#when converting consecutive underscores, #then only converts after lowercase", () => {
      expect(snakeToCamel("hello__world")).toBe("hello_World")
    })

    test("#when converting trailing underscore, #then keeps it", () => {
      expect(snakeToCamel("hello_world_")).toBe("helloWorld_")
    })
  })
})

describe("transformObjectKeys", () => {
  describe("#given flat objects", () => {
    test("#when transforming with camelToSnake, #then converts all keys", () => {
      const obj = { helloWorld: 1, fooBar: 2 }
      const result = transformObjectKeys(obj, camelToSnake)
      expect(result).toEqual({ hello_world: 1, foo_bar: 2 })
    })

    test("#when transforming with snakeToCamel, #then converts all keys", () => {
      const obj = { hello_world: 1, foo_bar: 2 }
      const result = transformObjectKeys(obj, snakeToCamel)
      expect(result).toEqual({ helloWorld: 1, fooBar: 2 })
    })

    test("#when transforming empty object, #then returns empty object", () => {
      const result = transformObjectKeys({}, camelToSnake)
      expect(result).toEqual({})
    })
  })

  describe("#given nested objects with deep=true", () => {
    test("#when transforming nested object, #then converts all nested keys", () => {
      const obj = { helloWorld: { fooBar: 1 } }
      const result = transformObjectKeys(obj, camelToSnake, true)
      expect(result).toEqual({ hello_world: { foo_bar: 1 } })
    })

    test("#when transforming deeply nested object, #then converts all levels", () => {
      const obj = { levelOne: { levelTwo: { levelThree: 1 } } }
      const result = transformObjectKeys(obj, camelToSnake, true)
      expect(result).toEqual({
        level_one: { level_two: { level_three: 1 } },
      })
    })
  })

  describe("#given nested objects with deep=false", () => {
    test("#when transforming with deep=false, #then only converts top-level keys", () => {
      const obj = { helloWorld: { fooBar: 1 } }
      const result = transformObjectKeys(obj, camelToSnake, false)
      expect(result).toEqual({ hello_world: { fooBar: 1 } })
    })
  })

  describe("#given arrays in objects", () => {
    test("#when transforming object with array of primitives, #then preserves array", () => {
      const obj = { helloWorld: [1, 2, 3] }
      const result = transformObjectKeys(obj, camelToSnake, true)
      expect(result).toEqual({ hello_world: [1, 2, 3] })
    })

    test("#when transforming object with array of objects, #then transforms nested object keys", () => {
      const obj = { helloWorld: [{ fooBar: 1 }, { bazQux: 2 }] }
      const result = transformObjectKeys(obj, camelToSnake, true)
      expect(result).toEqual({
        hello_world: [{ foo_bar: 1 }, { baz_qux: 2 }],
      })
    })

    test("#when transforming with deep=false and array of objects, #then does not transform nested keys", () => {
      const obj = { helloWorld: [{ fooBar: 1 }] }
      const result = transformObjectKeys(obj, camelToSnake, false)
      expect(result).toEqual({ hello_world: [{ fooBar: 1 }] })
    })

    test("#when transforming array with mixed primitives and objects, #then only transforms objects", () => {
      const obj = { items: [1, { fooBar: 2 }, "string", { bazQux: 3 }] }
      const result = transformObjectKeys(obj, camelToSnake, true)
      expect(result).toEqual({
        items: [1, { foo_bar: 2 }, "string", { baz_qux: 3 }],
      })
    })
  })

  describe("#given complex nested structures", () => {
    test("#when transforming mixed nested and array structure, #then transforms all keys", () => {
      const obj = {
        userData: {
          userInfo: { firstName: "John", lastName: "Doe" },
          userRoles: [{ roleName: "admin" }, { roleName: "user" }],
        },
      }
      const result = transformObjectKeys(obj, camelToSnake, true)
      expect(result).toEqual({
        user_data: {
          user_info: { first_name: "John", last_name: "Doe" },
          user_roles: [{ role_name: "admin" }, { role_name: "user" }],
        },
      })
    })
  })

  describe("#given non-plain objects", () => {
    test("#when transforming object with null value, #then preserves null", () => {
      const obj = { helloWorld: null }
      const result = transformObjectKeys(obj, camelToSnake, true)
      expect(result).toEqual({ hello_world: null })
    })

    test("#when transforming object with undefined value, #then preserves undefined", () => {
      const obj = { helloWorld: undefined }
      const result = transformObjectKeys(obj, camelToSnake, true)
      expect(result).toEqual({ hello_world: undefined })
    })

    test("#when transforming object with Date value, #then preserves Date", () => {
      const date = new Date("2024-01-01")
      const obj = { createdAt: date }
      const result = transformObjectKeys(obj, camelToSnake, true)
      expect(result).toEqual({ created_at: date })
      expect(result.created_at).toBe(date)
    })
  })
})

describe("objectToSnakeCase", () => {
  describe("#given flat objects", () => {
    test("#when converting flat object, #then converts all keys to snake_case", () => {
      const obj = { helloWorld: 1, fooBar: 2 }
      const result = objectToSnakeCase(obj)
      expect(result).toEqual({ hello_world: 1, foo_bar: 2 })
    })
  })

  describe("#given nested objects with deep=true (default)", () => {
    test("#when converting nested object, #then converts all nested keys", () => {
      const obj = { helloWorld: { fooBar: 1 } }
      const result = objectToSnakeCase(obj)
      expect(result).toEqual({ hello_world: { foo_bar: 1 } })
    })

    test("#when converting with explicit deep=true, #then converts all levels", () => {
      const obj = { levelOne: { levelTwo: { levelThree: 1 } } }
      const result = objectToSnakeCase(obj, true)
      expect(result).toEqual({
        level_one: { level_two: { level_three: 1 } },
      })
    })
  })

  describe("#given nested objects with deep=false", () => {
    test("#when converting with deep=false, #then only converts top-level keys", () => {
      const obj = { helloWorld: { fooBar: 1 } }
      const result = objectToSnakeCase(obj, false)
      expect(result).toEqual({ hello_world: { fooBar: 1 } })
    })
  })

  describe("#given arrays in objects", () => {
    test("#when converting object with array of objects, #then transforms nested keys", () => {
      const obj = { userData: [{ firstName: "John" }, { firstName: "Jane" }] }
      const result = objectToSnakeCase(obj)
      expect(result).toEqual({
        user_data: [{ first_name: "John" }, { first_name: "Jane" }],
      })
    })
  })
})

describe("objectToCamelCase", () => {
  describe("#given flat objects", () => {
    test("#when converting flat object, #then converts all keys to camelCase", () => {
      const obj = { hello_world: 1, foo_bar: 2 }
      const result = objectToCamelCase(obj)
      expect(result).toEqual({ helloWorld: 1, fooBar: 2 })
    })
  })

  describe("#given nested objects with deep=true (default)", () => {
    test("#when converting nested object, #then converts all nested keys", () => {
      const obj = { hello_world: { foo_bar: 1 } }
      const result = objectToCamelCase(obj)
      expect(result).toEqual({ helloWorld: { fooBar: 1 } })
    })

    test("#when converting with explicit deep=true, #then converts all levels", () => {
      const obj = { level_one: { level_two: { level_three: 1 } } }
      const result = objectToCamelCase(obj, true)
      expect(result).toEqual({
        levelOne: { levelTwo: { levelThree: 1 } },
      })
    })
  })

  describe("#given nested objects with deep=false", () => {
    test("#when converting with deep=false, #then only converts top-level keys", () => {
      const obj = { hello_world: { foo_bar: 1 } }
      const result = objectToCamelCase(obj, false)
      expect(result).toEqual({ helloWorld: { foo_bar: 1 } })
    })
  })

  describe("#given arrays in objects", () => {
    test("#when converting object with array of objects, #then transforms nested keys", () => {
      const obj = { user_data: [{ first_name: "John" }, { first_name: "Jane" }] }
      const result = objectToCamelCase(obj)
      expect(result).toEqual({
        userData: [{ firstName: "John" }, { firstName: "Jane" }],
      })
    })
  })
})

describe("round-trip conversions", () => {
  test("#when converting camelCase to snake_case and back, #then returns original", () => {
    const original = { helloWorld: { fooBar: 1 } }
    const toSnake = objectToSnakeCase(original)
    const backToCamel = objectToCamelCase(toSnake)
    expect(backToCamel).toEqual(original)
  })

  test("#when converting snake_case to camelCase and back, #then returns original", () => {
    const original = { hello_world: { foo_bar: 1 } }
    const toCamel = objectToCamelCase(original)
    const backToSnake = objectToSnakeCase(toCamel)
    expect(backToSnake).toEqual(original)
  })
})
