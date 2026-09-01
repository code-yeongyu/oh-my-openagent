/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

// The plugin ships senpi-task inside more than one bundle (omo.js warms pi-tui in compose;
// omo-task.js carries its own copy of this module and renders the DAG status widget from a
// timer). A second module instance must observe the warm-up done through the first one, or the
// timer render throws outside any try/catch and kills the process.
type PiTuiBoundary = typeof import("./pi-tui")

describe("pi-tui lazy boundary across duplicated module instances", () => {
  it("#given loadPiTui awaited through one module copy #when a second copy reads piTui() #then it resolves without throwing", async () => {
    // given
    const first = (await import("./pi-tui")) as PiTuiBoundary
    // A query-suffixed specifier makes the runtime instantiate a second, independent module copy,
    // standing in for the second bundle. Kept as a value so tsgo resolves types from the real path.
    const duplicateCopySpecifier = "./pi-tui.ts?duplicate-bundle-copy"
    const second = (await import(duplicateCopySpecifier)) as PiTuiBoundary
    expect(second).not.toBe(first)
    await first.loadPiTui()

    // when / then
    expect(() => second.piTui()).not.toThrow()
    expect(second.piTui()).toBe(first.piTui())
  })
})
