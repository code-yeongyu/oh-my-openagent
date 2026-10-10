import { describe, expect, test } from "bun:test"

import { decideNativeEditionNudge } from "./decide"
import {
  NUDGE_AUTO_SHOW_CAP,
  NUDGE_CORRUPT_RECOVERY_MS,
  NUDGE_STATE_VERSION,
  type NudgeDecisionInput,
  type NudgeState,
} from "./types"

const NOW = 1_700_000_000_000

function state(overrides: Partial<NudgeState> = {}): NudgeState {
  return {
    schemaVersion: NUDGE_STATE_VERSION,
    autoShows: 0,
    lastShownAt: null,
    nextEligibleAt: NOW,
    decision: "none",
    decidedAt: null,
    writtenBy: "test",
    ...overrides,
  }
}

function eligible(overrides: Partial<NudgeDecisionInput> = {}): NudgeDecisionInput {
  return {
    now: NOW,
    state: "missing",
    nativeEditionInstalled: false,
    hookDisabled: false,
    interactive: true,
    childSession: false,
    shownThisProcess: false,
    stateWritable: true,
    toastAvailable: true,
    version: "test",
    ...overrides,
  }
}

describe("the nudge shows for a user who can act on it", () => {
  test("#given a first eligible session #when decided #then it shows and schedules the next window", () => {
    // given / when
    const decision = decideNativeEditionNudge(eligible())

    // then
    expect(decision.show).toBe(true)
    expect(decision.nextState?.autoShows).toBe(1)
    expect(decision.nextState?.nextEligibleAt).toBeGreaterThan(NOW)
  })
})

describe("every suppression condition, each beside its control", () => {
  // Each row is a pair: the condition set must suppress, and the SAME input with only that
  // condition cleared must show. Without the control a blanket refusal would pass every row.
  const conditions: readonly { readonly name: string; readonly patch: Partial<NudgeDecisionInput>; readonly reason: string }[] = [
    { name: "the native edition is already installed", patch: { nativeEditionInstalled: true }, reason: "already-migrated" },
    { name: "the hook is listed in disabled_hooks", patch: { hookDisabled: true }, reason: "opted-out" },
    { name: "the session is non-interactive", patch: { interactive: false }, reason: "non-interactive" },
    { name: "the session is a child session", patch: { childSession: true }, reason: "child-session" },
    { name: "it already fired in this process", patch: { shownThisProcess: true }, reason: "already-shown-this-process" },
    { name: "the toast API is unavailable", patch: { toastAvailable: false }, reason: "toast-unavailable" },
    { name: "the state directory is unwritable", patch: { stateWritable: false }, reason: "state-unwritable" },
    { name: "the user said never", patch: { state: state({ decision: "never" }) }, reason: "opted-out" },
    { name: "the user already migrated", patch: { state: state({ decision: "migrated" }) }, reason: "already-migrated" },
    { name: "the lifetime cap is reached", patch: { state: state({ autoShows: NUDGE_AUTO_SHOW_CAP }) }, reason: "lifetime-cap-reached" },
    { name: "the next window has not opened", patch: { state: state({ nextEligibleAt: NOW + 1 }) }, reason: "not-yet-eligible" },
  ]

  for (const condition of conditions) {
    test(`#given ${condition.name} #when decided #then it stays silent`, () => {
      // given / when
      const decision = decideNativeEditionNudge(eligible(condition.patch))

      // then
      expect(decision.show).toBe(false)
      expect(decision.reason).toBe(condition.reason)
    })

    test(`#given ${condition.name} is cleared #when decided #then it shows`, () => {
      // given / when
      const decision = decideNativeEditionNudge(eligible())

      // then
      expect(decision.show).toBe(true)
    })
  }
})

describe("a dismissal survives a damaged state file", () => {
  test("#given never with every sibling field corrupted #when decided #then it still stays silent", () => {
    // given
    const damaged = { ...state({ decision: "never" }), autoShows: -999, nextEligibleAt: 0, schemaVersion: 99 }

    // when
    const decision = decideNativeEditionNudge(eligible({ state: damaged }))

    // then
    expect(decision.show).toBe(false)
    expect(decision.reason).toBe("opted-out")
  })

  test("#given an unparseable state file #when decided #then it stays silent and defers rather than showing now", () => {
    // given / when
    const decision = decideNativeEditionNudge(eligible({ state: "corrupt" }))

    // then
    expect(decision.show).toBe(false)
    expect(decision.reason).toBe("state-corrupt-recovering")
    expect(decision.nextState?.nextEligibleAt).toBe(NOW + NUDGE_CORRUPT_RECOVERY_MS)
  })
})

describe("the lifetime cap is reached by repeated showings", () => {
  test("#given the nudge is accepted each time it is offered #when the cap is hit #then it never shows again", () => {
    // given
    let current: NudgeState | "missing" = "missing"
    let shows = 0
    let clock = NOW

    // when
    for (let attempt = 0; attempt < NUDGE_AUTO_SHOW_CAP + 3; attempt += 1) {
      const decision = decideNativeEditionNudge(eligible({ now: clock, state: current }))
      if (decision.show) {
        shows += 1
        current = decision.nextState
        clock = decision.nextState.nextEligibleAt
        continue
      }
      clock += 365 * 24 * 60 * 60 * 1000
    }

    // then
    expect(shows).toBe(NUDGE_AUTO_SHOW_CAP)
  })
})
