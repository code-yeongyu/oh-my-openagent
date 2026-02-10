import { describe, it, expect } from "bun:test"

import { pruneRecentSyntheticIdles } from "./recent-synthetic-idles"

describe("pruneRecentSyntheticIdles", () => {
  it("removes entries older than dedup window", () => {
    //#given
    const recentSyntheticIdles = new Map<string, number>([
      ["ses_old", 1000],
      ["ses_new", 1600],
    ])

    //#when
    pruneRecentSyntheticIdles({
      recentSyntheticIdles,
      now: 2000,
      dedupWindowMs: 500,
    })

    //#then
    expect(recentSyntheticIdles.has("ses_old")).toBe(false)
    expect(recentSyntheticIdles.has("ses_new")).toBe(true)
  })
})
