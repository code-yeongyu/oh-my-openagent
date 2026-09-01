import { describe, expect, test } from "bun:test"

import { extractAutoRetrySignal } from "./auto-retry-signal"

describe("extractAutoRetrySignal", () => {
  test("detects Volcano Engine 'exceeded the usage quota' signal", () => {
    //#given
    const info = {
      status: "You have exceeded the 5-hour usage quota. It will reset at 2026-05-11 01:20:12 +0800 CST.",
    }

    //#when
    const signal = extractAutoRetrySignal(info)

    //#then
    expect(signal).toBeDefined()
    expect(signal?.signal).toContain("exceeded")
    expect(signal?.signal).toContain("usage quota")
  })

  test("detects standard 'quota exceeded' signal", () => {
    //#given
    const info = { message: "Quota exceeded for model gpt-4" }

    //#when
    const signal = extractAutoRetrySignal(info)

    //#then
    expect(signal).toBeDefined()
  })

  test("returns undefined for non-retryable info", () => {
    //#given
    const info = { message: "Something went wrong" }

    //#when
    const signal = extractAutoRetrySignal(info)

    //#then
    expect(signal).toBeUndefined()
  })
})
