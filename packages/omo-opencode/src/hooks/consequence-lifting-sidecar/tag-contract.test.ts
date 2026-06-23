/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { TAG_VALUE } from "./tag-contract"

describe("TAG_VALUE", () => {
  it("#when matches @value:safety #then extracts safety", () => {
    expect("@value:safety".match(TAG_VALUE)?.[1]).toBe("safety")
  })

  it("#when matches @value:autonomy #then extracts autonomy", () => {
    expect("@value:autonomy".match(TAG_VALUE)?.[1]).toBe("autonomy")
  })

  it("#when @value: empty #then no match", () => {
    expect(TAG_VALUE.test("@value:")).toBe(false)
  })

  it("#when not a tag #then no match", () => {
    expect(TAG_VALUE.test("plain_text")).toBe(false)
  })
})
