import { describe, expect, test } from "bun:test"

import type { RecallCandidate } from "@oh-my-opencode/memory-core"

import {
  ACCEPTED_NUDGE_COOLDOWN_LIMIT,
  ACCEPTED_NUDGE_COOLDOWN_WINDOW_MS,
  backoffDelayMs,
  createAcceptedNudgeCooldown,
  decideWake,
  KIBITZER_BACKOFF_MAX_MS,
  KIBITZER_BACKOFF_MIN_MS,
} from "./wake-policy"

function candidate(path: string, score = 1): RecallCandidate {
  return { path, description: `about ${path}`, excerpt: `excerpt of ${path}`, score }
}

const quiet = { exhausted: () => false }
const exhausted = { exhausted: () => true }

describe("decideWake", () => {
  test("#given a batch with one path never offered #when decided #then it wakes with only the fresh eligible candidates", () => {
    const decision = decideWake({
      candidates: [candidate("reference/a.md"), candidate("reference/b.md"), candidate("reference/c.md"), candidate("system/hidden.md"), candidate("reference/b.md", 2)],
      offered: new Set(["reference/a.md"]),
      surfaced: new Set(["reference/c.md"]),
      maxItems: 2,
      cooldown: quiet,
    })

    expect(decision.wake).toBe(true)
    if (!decision.wake) throw new Error("expected a wake")
    // a.md was offered this lifetime, c.md is in the surfaced ledger, system/ is never nudge-eligible,
    // and the duplicate b.md collapses to its first occurrence.
    expect(decision.candidates.map((entry) => entry.path)).toEqual(["reference/b.md"])
    expect(decision.candidates[0]?.score).toBe(1)
  })

  test("#given no candidates, a zero cap, or only already-offered paths #when decided #then each stays silent with its own reason", () => {
    expect(decideWake({ candidates: [], offered: new Set(), surfaced: new Set(), maxItems: 2, cooldown: quiet }))
      .toEqual({ wake: false, reason: "no_candidates" })
    expect(decideWake({ candidates: [candidate("reference/a.md")], offered: new Set(), surfaced: new Set(), maxItems: 0, cooldown: quiet }))
      .toEqual({ wake: false, reason: "max_items_zero" })
    expect(decideWake({
      candidates: [candidate("reference/a.md"), candidate("reference/b.md")],
      offered: new Set(["reference/a.md"]),
      surfaced: new Set(["reference/b.md"]),
      maxItems: 2,
      cooldown: quiet,
    })).toEqual({ wake: false, reason: "no_new_candidate" })
  })

  test("#given an exhausted cooldown #when decided #then a fresh candidate buffers as cooldown but nothing-new still reports nothing-new", () => {
    expect(decideWake({ candidates: [candidate("reference/a.md")], offered: new Set(), surfaced: new Set(), maxItems: 2, cooldown: exhausted }))
      .toEqual({ wake: false, reason: "cooldown" })
    expect(decideWake({ candidates: [candidate("reference/a.md")], offered: new Set(["reference/a.md"]), surfaced: new Set(), maxItems: 2, cooldown: exhausted }))
      .toEqual({ wake: false, reason: "no_new_candidate" })
  })
})

describe("createAcceptedNudgeCooldown", () => {
  test("#given the fixed advisory budget #when two accepted wakes are charged #then the window is exhausted until it slides past the first charge", () => {
    const clock = { now: 1_000_000 }
    const cooldown = createAcceptedNudgeCooldown({ now: () => clock.now })

    expect(cooldown.limit).toBe(ACCEPTED_NUDGE_COOLDOWN_LIMIT)
    expect(cooldown.windowMs).toBe(ACCEPTED_NUDGE_COOLDOWN_WINDOW_MS)
    expect(cooldown.exhausted()).toBe(false)

    cooldown.charge()
    clock.now += 60_000
    cooldown.charge()
    expect(cooldown.charges()).toBe(2)
    expect(cooldown.exhausted()).toBe(true)

    // 10 minutes after the FIRST charge it has left the window; the second is still inside.
    clock.now = 1_000_000 + ACCEPTED_NUDGE_COOLDOWN_WINDOW_MS + 1
    expect(cooldown.exhausted()).toBe(false)
    expect(cooldown.charges()).toBe(1)
  })
})

describe("backoffDelayMs", () => {
  test("#given consecutive child failures #when the delay is computed #then it doubles with jitter inside the 1s..5min band", () => {
    expect(KIBITZER_BACKOFF_MIN_MS).toBe(1_000)
    expect(KIBITZER_BACKOFF_MAX_MS).toBe(300_000)

    // The first retry is never faster than the floor, whatever the jitter draws.
    expect(backoffDelayMs(0, () => 0)).toBe(1_000)
    expect(backoffDelayMs(0, () => 1)).toBe(1_000)
    // Attempt 3 caps at 8s and jitter keeps at least half of it.
    expect(backoffDelayMs(3, () => 0)).toBe(4_000)
    expect(backoffDelayMs(3, () => 1)).toBe(8_000)
    // Deep into a streak the cap is the ceiling and jitter still spreads below it.
    expect(backoffDelayMs(20, () => 1)).toBe(300_000)
    expect(backoffDelayMs(20, () => 0)).toBe(150_000)
    // A custom band is honoured the same way.
    expect(backoffDelayMs(1, () => 0.5, { minMs: 100, maxMs: 250 })).toBe(150)
  })

  test("#given a streak of consecutive failures #when each retry delay is computed #then the ladder climbs 1s, 2s, 4s ... and settles on the five-minute cap, every draw inside the band", () => {
    // Full-jitter draw: the ladder itself, capped at five minutes from the ninth retry on.
    const ladder = Array.from({ length: 12 }, (_, attempt) => backoffDelayMs(attempt, () => 1))
    expect(ladder).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000, 300_000, 300_000, 300_000])

    // Whatever the draw, a delay never leaves [1s, 5min] and never drops below half its rung.
    for (const attempt of [0, 1, 4, 8, 9, 30]) {
      for (const draw of [0, 0.01, 0.37, 0.5, 0.99, 1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const delay = backoffDelayMs(attempt, () => draw)
        expect(delay).toBeGreaterThanOrEqual(KIBITZER_BACKOFF_MIN_MS)
        expect(delay).toBeLessThanOrEqual(KIBITZER_BACKOFF_MAX_MS)
        expect(delay).toBeGreaterThanOrEqual(Math.min(KIBITZER_BACKOFF_MAX_MS, KIBITZER_BACKOFF_MIN_MS * 2 ** attempt) / 2)
      }
    }
  })
})
