import { describe, expect, test } from "bun:test"

import { resolveRuntimeFallbackDedupeHoldMs } from "./retry-dedupe-hold"

describe("resolveRuntimeFallbackDedupeHoldMs", () => {
  test("#given config timeout of 30s and no option #when the hold resolves #then it is the timeout plus the margin", () => {
    // given
    const config = { timeout_seconds: 30 }

    // when
    const holdMs = resolveRuntimeFallbackDedupeHoldMs(config)

    // then
    expect(holdMs).toBe(35_000)
  })

  test("#given session_timeout_ms option #when the hold resolves #then the option overrides the config timeout", () => {
    // given
    const config = { timeout_seconds: 30 }

    // when
    const holdMs = resolveRuntimeFallbackDedupeHoldMs(config, { session_timeout_ms: 1 })

    // then
    expect(holdMs).toBe(5_001)
  })

  test("#given timeouts disabled #when the hold resolves #then it defers to the gate default", () => {
    // given
    const config = { timeout_seconds: 0 }

    // when
    const holdMs = resolveRuntimeFallbackDedupeHoldMs(config)

    // then
    expect(holdMs).toBeUndefined()
  })

  test("#given timeouts disabled but an explicit option #when the hold resolves #then the option still sizes the hold", () => {
    // given
    const config = { timeout_seconds: 0 }

    // when
    const holdMs = resolveRuntimeFallbackDedupeHoldMs(config, { session_timeout_ms: 50 })

    // then
    expect(holdMs).toBe(5_050)
  })
})
