import { describe, expect, test } from "bun:test"
import { extractRuntimeFallbackAutoRetrySignal } from "./runtime-fallback-auto-retry-signal"

describe("extractRuntimeFallbackAutoRetrySignal", () => {
  test("#given a free usage exhaustion message #when extracting a retry signal #then it returns the provider message", () => {
    //#given
    const message = "Free usage exceeded, subscribe to Go"

    //#when
    const signal = extractRuntimeFallbackAutoRetrySignal({ message })

    //#then
    expect(signal).toEqual({ signal: message })
  })
})
