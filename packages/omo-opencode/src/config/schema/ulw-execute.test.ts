/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { UlwExecuteConfigSchema } from "./ulw-execute"

describe("UlwExecuteConfigSchema", () => {
  test("#given empty object #when parsing #then auto_commit and auto_merge default to true", () => {
    // given
    const input = {}

    // when
    const parsed = UlwExecuteConfigSchema.parse(input)

    // then
    expect(parsed.auto_commit).toBe(true)
    expect(parsed.auto_merge).toBe(true)
  })

  test("#given auto_merge false #when parsing #then auto_merge is false and auto_commit stays independent", () => {
    // given
    const input = { auto_merge: false }

    // when
    const parsed = UlwExecuteConfigSchema.parse(input)

    // then
    expect(parsed.auto_merge).toBe(false)
    expect(parsed.auto_commit).toBe(true)
  })
})
