/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

// Same cross-bundle duplication hazard as pi-tui-shared-state.test.ts, for the engine barrel:
// issue #7339 observed "The @code-yeongyu/senpi barrel was accessed before it was loaded" when a
// sync reader lived in a different bundle copy than the async entry point that awaited the load.
type SenpiBarrelBoundary = typeof import("./senpi-barrel")

describe("senpi barrel lazy boundary across duplicated module instances", () => {
  it("#given loadSenpiBarrel awaited through one module copy #when a second copy reads senpiBarrel() #then it resolves without throwing", async () => {
    // given
    const first = (await import("./senpi-barrel")) as SenpiBarrelBoundary
    const duplicateCopySpecifier = "./senpi-barrel.ts?duplicate-bundle-copy"
    const second = (await import(duplicateCopySpecifier)) as SenpiBarrelBoundary
    expect(second).not.toBe(first)
    await first.loadSenpiBarrel()

    // when / then
    expect(() => second.senpiBarrel()).not.toThrow()
    expect(second.senpiBarrel()).toBe(first.senpiBarrel())
  })
})
