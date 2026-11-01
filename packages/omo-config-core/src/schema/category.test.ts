import { describe, expect, test } from "bun:test"

import { OmoCategoryConfigSchema } from "./category"

describe("OmoCategoryConfigSchema warn_unavailable", () => {
  test("#given no category warning override #when category parses #then suppression remains absent", () => {
    // given
    const input = {}

    // when
    const parsed = OmoCategoryConfigSchema.parse(input)

    // then
    expect(parsed.warn_unavailable).toBeUndefined()
  })

  test("#given a boolean category warning override #when category parses #then the override is preserved", () => {
    // given
    const input = { warn_unavailable: true }

    // when
    const parsed = OmoCategoryConfigSchema.parse(input)

    // then
    expect(parsed.warn_unavailable).toBe(true)
  })

  test("#given a non-boolean category warning override #when category parses #then validation fails at the field path", () => {
    // given
    const input = { warn_unavailable: "nope" }

    // when
    const result = OmoCategoryConfigSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
    if (result.success) throw new Error("Expected category parsing to fail")
    expect(result.error.issues.map((issue) => issue.path.join(".")).join(",")).toContain("warn_unavailable")
  })
})

describe("OmoCategoryConfigSchema retired provider_lock (config migration contract)", () => {
  test.each([true, false])("#given an omo.json category that still sets provider_lock: %p #when it parses #then it loads without error and the key is dropped", (value) => {
    // given
    const input = { model: "openai/gpt-6-astra", provider_lock: value }

    // when
    const result = OmoCategoryConfigSchema.safeParse(input)

    // then
    expect(result.success).toBe(true)
    if (!result.success) throw new Error("Expected the retired key to be ignored")
    expect(result.data).toEqual({ model: "openai/gpt-6-astra" })
  })
})
