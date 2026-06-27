import { describe, expect, test } from "bun:test"

import { isPlainRecord } from "./record.js"

describe("isPlainRecord", () => {
  test("#given non-array objects #when checking plain record shape #then accepts them", () => {
    expect(isPlainRecord({ method: "tools/list" })).toBe(true)
    expect(isPlainRecord(new Date("2026-06-27T00:00:00.000Z"))).toBe(true)
  })

  test("#given arrays null and primitives #when checking plain record shape #then rejects them", () => {
    expect(isPlainRecord([])).toBe(false)
    expect(isPlainRecord(null)).toBe(false)
    expect(isPlainRecord("text")).toBe(false)
    expect(isPlainRecord(1)).toBe(false)
    expect(isPlainRecord(true)).toBe(false)
  })
})
