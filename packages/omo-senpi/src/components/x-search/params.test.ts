import { describe, expect, test } from "bun:test"

import { validateXSearchParams } from "./params"

describe("validateXSearchParams", () => {
  test("accepts a valid minimal payload and applies defaults", () => {
    const result = validateXSearchParams({ query: "open source AI" })
    expect(result).toEqual({
      ok: true,
      value: {
        query: "open source AI",
        mode: "latest",
        max_results: 10,
        enable_image_understanding: false,
        enable_video_understanding: false,
      },
    })
  })

  test("rejects both handle lists as INVALID_FILTERS", () => {
    expect(validateXSearchParams({ query: "x", allowed_x_handles: ["alice"], excluded_x_handles: ["bob"] })).toMatchObject({
      ok: false,
      code: "INVALID_FILTERS",
    })
  })

  test("rejects more than 20 handles as TOO_MANY_HANDLES", () => {
    expect(validateXSearchParams({ query: "x", allowed_x_handles: Array.from({ length: 21 }, (_, i) => `user${i}`) })).toMatchObject({
      ok: false,
      code: "TOO_MANY_HANDLES",
    })
  })

  test("rejects impossible calendar dates as INVALID_DATE", () => {
    expect(validateXSearchParams({ query: "x", from_date: "2026-02-30" })).toMatchObject({ ok: false, code: "INVALID_DATE" })
  })

  test("rejects an inverted date range as INVALID_DATE_RANGE", () => {
    expect(validateXSearchParams({ query: "x", from_date: "2026-03-01", to_date: "2026-02-01" })).toMatchObject({
      ok: false,
      code: "INVALID_DATE_RANGE",
    })
  })

  test("rejects unknown properties as INVALID_PARAMS", () => {
    expect(validateXSearchParams({ query: "x", unexpected: true })).toMatchObject({ ok: false, code: "INVALID_PARAMS" })
  })
})
