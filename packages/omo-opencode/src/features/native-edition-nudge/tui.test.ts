import { describe, expect, test } from "bun:test"

import { applyNativeEditionNudgeAction, NATIVE_NUDGE_OPTIONS } from "./tui"
import type { NudgeStateStore } from "../../hooks/native-edition-nudge"
import { NUDGE_SNOOZE_MS, NUDGE_STATE_VERSION, type NudgeState, type NudgeStateRead } from "../../hooks/native-edition-nudge/types"

const NOW = 1_700_000_000_000

function store(initial: NudgeStateRead = "missing") {
  let current = initial
  const writes: NudgeState[] = []
  const impl: NudgeStateStore = {
    read: () => current,
    write: (state) => {
      writes.push(state)
      current = state
      return true
    },
    probeWritable: () => true,
  }
  return { store: impl, writes }
}

function shown(autoShows: number): NudgeState {
  return {
    schemaVersion: NUDGE_STATE_VERSION,
    autoShows,
    lastShownAt: NOW,
    nextEligibleAt: NOW,
    decision: "none",
    decidedAt: null,
    writtenBy: "test",
  }
}

describe("the dialog offers every action the issue asks for", () => {
  test("#given the option list #when read #then it offers install, guide, postpone and never", () => {
    // given / when
    const values = NATIVE_NUDGE_OPTIONS.map((option) => option.value)

    // then
    expect(values).toEqual(["install", "guide", "later", "never"])
  })
})

describe("install hands over the command without claiming the user migrated", () => {
  test("#given bun is available #when install is chosen #then the bun command is returned and no state is written", () => {
    // given
    const fake = store()

    // when
    const result = applyNativeEditionNudgeAction("install", { store: fake.store, now: NOW, bunAvailable: true })

    // then
    expect(result.toast).toContain("bun add -g omo-ai@beta")
    expect(result.toast).toContain("omo setup")
    expect(fake.writes).toHaveLength(0)
  })

  test("#given bun is absent #when install is chosen #then the npm fallback command is returned", () => {
    // given
    const fake = store()

    // when
    const result = applyNativeEditionNudgeAction("install", { store: fake.store, now: NOW, bunAvailable: false })

    // then
    expect(result.toast).toContain("npm i -g omo-ai@beta")
  })
})

describe("a reminder the user asked for is not nagging", () => {
  test("#given later is chosen #when applied #then it schedules a week out without consuming a showing", () => {
    // given
    const fake = store(shown(2))

    // when
    applyNativeEditionNudgeAction("later", { store: fake.store, now: NOW, bunAvailable: true })

    // then
    expect(fake.writes[0]?.nextEligibleAt).toBe(NOW + NUDGE_SNOOZE_MS)
    expect(fake.writes[0]?.decision).toBe("snoozed")
    expect(fake.writes[0]?.autoShows).toBe(2)
  })
})

describe("never is permanent", () => {
  test("#given never is chosen #when applied #then the decision is recorded and dated", () => {
    // given
    const fake = store(shown(1))

    // when
    const result = applyNativeEditionNudgeAction("never", { store: fake.store, now: NOW, bunAvailable: true })

    // then
    expect(fake.writes[0]?.decision).toBe("never")
    expect(fake.writes[0]?.decidedAt).toBe(NOW)
    expect(result.toast).toContain("command palette")
  })
})

describe("guide opens the documented URL", () => {
  test("#given guide is chosen #when applied #then it returns the guide url and defers the next automatic showing", () => {
    // given
    const fake = store()

    // when
    const result = applyNativeEditionNudgeAction("guide", { store: fake.store, now: NOW, bunAvailable: true })

    // then
    expect(result.url).toContain("docs/guide/installation.md")
    expect(fake.writes[0]?.nextEligibleAt).toBe(NOW + NUDGE_SNOOZE_MS)
  })
})
