import { describe, test, expect } from "bun:test"
import {
  findCaseInsensitive,
  includesCaseInsensitive,
  findByNameCaseInsensitive,
  equalsIgnoreCase,
} from "./case-insensitive"

describe("findCaseInsensitive", () => {
  test("returns undefined for empty/undefined object", () => {
    // #given - undefined object
    const obj = undefined
    
    // #when - lookup any key
    const result = findCaseInsensitive(obj, "key")
    
    // #then - returns undefined
    expect(result).toBeUndefined()
  })

  test("finds exact match first", () => {
    // #given - object with exact key
    const obj = { Oracle: "value1", oracle: "value2" }
    
    // #when - lookup with exact case
    const result = findCaseInsensitive(obj, "Oracle")
    
    // #then - returns exact match
    expect(result).toBe("value1")
  })

  test("finds case-insensitive match when no exact match", () => {
    // #given - object with lowercase key
    const obj = { oracle: "value" }
    
    // #when - lookup with uppercase
    const result = findCaseInsensitive(obj, "ORACLE")
    
    // #then - returns case-insensitive match
    expect(result).toBe("value")
  })

  test("returns undefined when key not found", () => {
    // #given - object without target key
    const obj = { other: "value" }
    
    // #when - lookup missing key
    const result = findCaseInsensitive(obj, "oracle")
    
    // #then - returns undefined
    expect(result).toBeUndefined()
  })
})

describe("includesCaseInsensitive", () => {
  test("returns true for exact match", () => {
    // #given - array with exact value
    const arr = ["explore", "librarian"]
    
    // #when - check exact match
    const result = includesCaseInsensitive(arr, "explore")
    
    // #then - returns true
    expect(result).toBe(true)
  })

  test("returns true for case-insensitive match", () => {
    // #given - array with lowercase values
    const arr = ["explore", "librarian"]
    
    // #when - check uppercase value
    const result = includesCaseInsensitive(arr, "EXPLORE")
    
    // #then - returns true
    expect(result).toBe(true)
  })

  test("returns true for mixed case match", () => {
    // #given - array with mixed case values
    const arr = ["Oracle", "Sisyphus"]
    
    // #when - check different case
    const result = includesCaseInsensitive(arr, "oracle")
    
    // #then - returns true
    expect(result).toBe(true)
  })

  test("returns false when value not found", () => {
    // #given - array without target value
    const arr = ["explore", "librarian"]
    
    // #when - check missing value
    const result = includesCaseInsensitive(arr, "oracle")
    
    // #then - returns false
    expect(result).toBe(false)
  })

  test("returns false for empty array", () => {
    // #given - empty array
    const arr: string[] = []
    
    // #when - check any value
    const result = includesCaseInsensitive(arr, "explore")
    
    // #then - returns false
    expect(result).toBe(false)
  })
})

describe("findByNameCaseInsensitive", () => {
  test("finds element by exact name", () => {
    // #given - array with named objects
    const arr = [{ name: "Oracle", value: 1 }, { name: "explore", value: 2 }]
    
    // #when - find by exact name
    const result = findByNameCaseInsensitive(arr, "Oracle")
    
    // #then - returns matching element
    expect(result).toEqual({ name: "Oracle", value: 1 })
  })

  test("finds element by case-insensitive name", () => {
    // #given - array with named objects
    const arr = [{ name: "Oracle", value: 1 }, { name: "explore", value: 2 }]
    
    // #when - find by different case
    const result = findByNameCaseInsensitive(arr, "oracle")
    
    // #then - returns matching element
    expect(result).toEqual({ name: "Oracle", value: 1 })
  })

  test("returns undefined when name not found", () => {
    // #given - array without target name
    const arr = [{ name: "Oracle", value: 1 }]
    
    // #when - find missing name
    const result = findByNameCaseInsensitive(arr, "librarian")
    
    // #then - returns undefined
    expect(result).toBeUndefined()
  })
})

describe("equalsIgnoreCase", () => {
  test("returns true for same case", () => {
    // #given - same strings
    // #when - compare
    // #then - returns true
    expect(equalsIgnoreCase("oracle", "oracle")).toBe(true)
  })

  test("returns true for different case", () => {
    // #given - strings with different case
    // #when - compare
    // #then - returns true
    expect(equalsIgnoreCase("Oracle", "ORACLE")).toBe(true)
    expect(equalsIgnoreCase("Sisyphus-Junior", "sisyphus-junior")).toBe(true)
  })

  test("returns false for different strings", () => {
    // #given - different strings
    // #when - compare
    // #then - returns false
    expect(equalsIgnoreCase("oracle", "explore")).toBe(false)
  })
})
