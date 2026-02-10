import { describe, it, expect } from "bun:test"

import { pruneRecentSyntheticIdles } from "./recent-synthetic-idles"

describe("pruneRecentSyntheticIdles", () => {
  it("removes entries where now - emittedAt >= dedupWindowMs (stale cleanup works)", () => {
    //#given
    const recentSyntheticIdles = new Map<string, number>([
      ["ses_old", 1000],
      ["ses_new", 1600],
    ])
    const recentRealIdles = new Map<string, number>()

    //#when
    pruneRecentSyntheticIdles({
      recentSyntheticIdles,
      recentRealIdles,
      now: 2000,
      dedupWindowMs: 500,
    })

    //#then
    expect(recentSyntheticIdles.has("ses_old")).toBe(false)
    expect(recentSyntheticIdles.has("ses_new")).toBe(true)
  })

  it("preserves entries where now - emittedAt < dedupWindowMs (fresh entries kept)", () => {
    //#given
    const recentSyntheticIdles = new Map<string, number>([
      ["ses_fresh_1", 1950],
      ["ses_fresh_2", 1980],
    ])
    const recentRealIdles = new Map<string, number>()

    //#when
    pruneRecentSyntheticIdles({
      recentSyntheticIdles,
      recentRealIdles,
      now: 2000,
      dedupWindowMs: 100,
    })

    //#then
    expect(recentSyntheticIdles.has("ses_fresh_1")).toBe(true)
    expect(recentSyntheticIdles.has("ses_fresh_2")).toBe(true)
    expect(recentSyntheticIdles.size).toBe(2)
  })

  it("handles empty Map without crashing (no-op on empty)", () => {
    //#given
    const recentSyntheticIdles = new Map<string, number>()
    const recentRealIdles = new Map<string, number>()

    //#when
    pruneRecentSyntheticIdles({
      recentSyntheticIdles,
      recentRealIdles,
      now: 2000,
      dedupWindowMs: 500,
    })

    //#then
    expect(recentSyntheticIdles.size).toBe(0)
  })

  it("removes only stale entries in mixed sessions (mixed sessions: only stale removed, fresh kept)", () => {
    //#given
    const recentSyntheticIdles = new Map<string, number>([
      ["ses_stale_1", 1000],
      ["ses_fresh_1", 1950],
      ["ses_stale_2", 1200],
      ["ses_fresh_2", 1980],
    ])
    const recentRealIdles = new Map<string, number>()

    //#when
    pruneRecentSyntheticIdles({
      recentSyntheticIdles,
      recentRealIdles,
      now: 2000,
      dedupWindowMs: 500,
    })

    //#then
    expect(recentSyntheticIdles.has("ses_stale_1")).toBe(false)
    expect(recentSyntheticIdles.has("ses_stale_2")).toBe(false)
    expect(recentSyntheticIdles.has("ses_fresh_1")).toBe(true)
    expect(recentSyntheticIdles.has("ses_fresh_2")).toBe(true)
    expect(recentSyntheticIdles.size).toBe(2)
  })

  it("clears all entries when all are stale (all-stale → Map becomes empty)", () => {
    //#given
    const recentSyntheticIdles = new Map<string, number>([
      ["ses_old_1", 500],
      ["ses_old_2", 800],
      ["ses_old_3", 1200],
    ])
    const recentRealIdles = new Map<string, number>()

    //#when
    pruneRecentSyntheticIdles({
      recentSyntheticIdles,
      recentRealIdles,
      now: 2000,
      dedupWindowMs: 500,
    })

    //#then
    expect(recentSyntheticIdles.size).toBe(0)
  })

  it("cleans 100+ entries in single pass (bulk cleanup works)", () => {
    //#given
    const recentSyntheticIdles = new Map<string, number>()
    // Add 50 stale entries
    for (let i = 0; i < 50; i++) {
      recentSyntheticIdles.set(`ses_stale_${i}`, 500 + i)
    }
    // Add 60 fresh entries
    for (let i = 0; i < 60; i++) {
      recentSyntheticIdles.set(`ses_fresh_${i}`, 1950 + i)
    }
    const recentRealIdles = new Map<string, number>()

    //#when
    pruneRecentSyntheticIdles({
      recentSyntheticIdles,
      recentRealIdles,
      now: 2000,
      dedupWindowMs: 500,
    })

    //#then
    expect(recentSyntheticIdles.size).toBe(60)
    // Verify all stale entries are gone
    for (let i = 0; i < 50; i++) {
      expect(recentSyntheticIdles.has(`ses_stale_${i}`)).toBe(false)
    }
    // Verify all fresh entries remain
    for (let i = 0; i < 60; i++) {
      expect(recentSyntheticIdles.has(`ses_fresh_${i}`)).toBe(true)
    }
  })

  it("prunes both synthetic and real idle maps (dual map pruning)", () => {
    //#given
    const recentSyntheticIdles = new Map<string, number>([
      ["synthetic_old", 1000],
      ["synthetic_new", 1600],
    ])
    const recentRealIdles = new Map<string, number>([
      ["real_old", 1000],
      ["real_new", 1600],
    ])

    //#when
    pruneRecentSyntheticIdles({
      recentSyntheticIdles,
      recentRealIdles,
      now: 2000,
      dedupWindowMs: 500,
    })

    //#then - both maps pruned
    expect(recentSyntheticIdles.has("synthetic_old")).toBe(false)
    expect(recentSyntheticIdles.has("synthetic_new")).toBe(true)
    expect(recentRealIdles.has("real_old")).toBe(false)
    expect(recentRealIdles.has("real_new")).toBe(true)
    expect(recentSyntheticIdles.size).toBe(1)
    expect(recentRealIdles.size).toBe(1)
  })
})
