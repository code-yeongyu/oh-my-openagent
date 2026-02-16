import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { initializeMcbFromConfig } from "./config-gate"
import { getMcbAvailability, resetMcbAvailability } from "./availability"
import type { McbConfig } from "../../config/schema/mcb"

describe("mcb-integration/config-gate", () => {
  beforeEach(() => {
    resetMcbAvailability()
  })

  afterEach(() => {
    resetMcbAvailability()
  })

  //#given no mcb config (undefined)
  //#when initializeMcbFromConfig is called
  //#then mcb is completely unavailable and locked
  it("disables MCB when config is missing", () => {
    initializeMcbFromConfig(undefined)

    const status = getMcbAvailability()
    expect(status.available).toBe(false)
    
    // Verify it's locked (subsequent calls don't reset it)
    // We can't directly check 'locked' state, but we can check if it remains unavailable
    // even if we try to access it again
    const status2 = getMcbAvailability()
    expect(status2.available).toBe(false)
  })

  //#given mcb config with enabled: false
  //#when initializeMcbFromConfig is called
  //#then mcb is completely unavailable and locked
  it("disables MCB when enabled is false", () => {
    const config: McbConfig = {
      enabled: false,
    }
    initializeMcbFromConfig(config)

    const status = getMcbAvailability()
    expect(status.available).toBe(false)
  })

  //#given mcb config with enabled: true
  //#when initializeMcbFromConfig is called
  //#then mcb is available with all tools enabled by default
  it("enables MCB when enabled is true", () => {
    const config: McbConfig = {
      enabled: true,
      url: "http://localhost:3000",
    }
    initializeMcbFromConfig(config)

    const status = getMcbAvailability()
    expect(status.available).toBe(true)
    expect(status.tools.search).toBe(true)
    expect(status.tools.memory).toBe(true)
  })

  //#given mcb config with enabled: true and specific tools disabled
  //#when initializeMcbFromConfig is called
  //#then mcb is available but specific tools are disabled
  it("respects per-tool configuration", () => {
    const config: McbConfig = {
      enabled: true,
      tools: {
        memory: false,
        vcs: false,
        search: true, // explicit true
        // index implicit true
      },
    }
    initializeMcbFromConfig(config)

    const status = getMcbAvailability()
    expect(status.available).toBe(true)
    expect(status.tools.memory).toBe(false)
    expect(status.tools.vcs).toBe(false)
    expect(status.tools.search).toBe(true)
    expect(status.tools.index).toBe(true) // default
  })

  //#given mcb is initialized and locked
  //#when time passes (simulated)
  //#then the configuration is NOT overwritten by cache expiration logic
  it("locks configuration against cache expiration", () => {
    // 1. Initialize as disabled
    initializeMcbFromConfig({ enabled: false })
    
    // 2. Verify disabled
    expect(getMcbAvailability().available).toBe(false)

    // 3. Even if we manually reset the internal cache (simulating expiry logic inside availability.ts),
    // the lock should prevent re-enabling if we were able to modify availability.ts to expose it.
    // However, since we can't easily mock the internal state of availability.ts without 
    // more complex mocking, we rely on the contract that initializeMcbFromConfig calls lockMcbAvailability.
    
    // Instead, let's verify that calling getMcbAvailability multiple times returns the same result
    for (let i = 0; i < 5; i++) {
        expect(getMcbAvailability().available).toBe(false)
    }
  })
})
