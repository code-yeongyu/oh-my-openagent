import { describe, expect, test } from "bun:test"

import { asArray, asRecord, finiteNumber, isRecord, nonEmptyString, optional } from "./guards"

describe("panel guards", () => {
  test("#given an array #when narrowed #then it is not a record", () => {
    // given the copy this replaced had stopped excluding arrays, and an array indexes by number
    expect(isRecord([])).toBe(false)
    expect(asRecord([1, 2])).toBeUndefined()
  })

  test("#given null or a primitive #when narrowed #then nothing comes back", () => {
    // given / when / then
    expect(asRecord(null)).toBeUndefined()
    expect(asRecord("x")).toBeUndefined()
    expect(asRecord(undefined)).toBeUndefined()
  })

  test("#given a plain object #when narrowed #then it passes through unchanged", () => {
    // given
    const value = { a: 1 }

    // when / then
    expect(asRecord(value)).toBe(value)
  })

  test("#given anything but an array #when read as a list #then it reads as empty", () => {
    // given a payload whose list field is missing must not throw on iteration
    expect(asArray(undefined)).toEqual([])
    expect(asArray({ length: 2 })).toEqual([])
    expect(asArray([1])).toEqual([1])
  })

  test("#given a number that cannot be shown #when narrowed #then it is refused", () => {
    // given NaN and Infinity would render as garbage in a row
    expect(finiteNumber(Number.NaN)).toBeUndefined()
    expect(finiteNumber(Number.POSITIVE_INFINITY)).toBeUndefined()
    expect(finiteNumber("3")).toBeUndefined()
    expect(finiteNumber(0)).toBe(0)
  })

  test("#given an empty string #when narrowed #then it counts as absent", () => {
    // given / when / then
    expect(nonEmptyString("")).toBeUndefined()
    expect(nonEmptyString(" ")).toBe(" ")
    expect(nonEmptyString(7)).toBeUndefined()
  })

  test("#given an absent value #when made optional #then it spreads to nothing", () => {
    // given
    expect({ ...optional("a", undefined) }).toEqual({})
    expect({ ...optional("a", 0) }).toEqual({ a: 0 })
    // and a falsy value is still a value: only undefined is absent
    expect({ ...optional("a", "") }).toEqual({ a: "" })
  })
})
