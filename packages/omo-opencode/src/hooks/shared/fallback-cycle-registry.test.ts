import { describe, expect, it } from "bun:test"

import { FallbackCycleRegistry } from "./fallback-cycle-registry"

describe("FallbackCycleRegistry", () => {
  it("#given no probe registered #when isActive is queried #then it reports inactive", () => {
    // given
    // no probe registered (fresh module state)

    // when
    const active = FallbackCycleRegistry.isActive("ses_any")

    // then
    expect(active).toBe(false)
  })

  it("#given a probe reporting a cycle #when isActive is queried for that session #then it reports active", () => {
    // given
    const probe = (sessionID: string) => sessionID === "ses_fallback_active"
    FallbackCycleRegistry.register(probe)

    try {
      // when
      const active = FallbackCycleRegistry.isActive("ses_fallback_active")
      const inactive = FallbackCycleRegistry.isActive("ses_other")

      // then
      expect(active).toBe(true)
      expect(inactive).toBe(false)
    } finally {
      FallbackCycleRegistry.unregister(probe)
    }
  })

  it("#given an older probe unregistered after a newer probe #when unregister runs #then the newer probe stays registered", () => {
    // given
    const olderProbe = () => false
    const newerProbe = () => true
    FallbackCycleRegistry.register(olderProbe)
    FallbackCycleRegistry.register(newerProbe)

    try {
      // when
      FallbackCycleRegistry.unregister(olderProbe)

      // then
      expect(FallbackCycleRegistry.isActive("ses_any")).toBe(true)
    } finally {
      FallbackCycleRegistry.unregister(newerProbe)
    }
  })

  it("#given the active probe is unregistered #when isActive is queried #then it reports inactive again", () => {
    // given
    const probe = () => true
    FallbackCycleRegistry.register(probe)
    expect(FallbackCycleRegistry.isActive("ses_any")).toBe(true)

    // when
    FallbackCycleRegistry.unregister(probe)

    // then
    expect(FallbackCycleRegistry.isActive("ses_any")).toBe(false)
  })
})
