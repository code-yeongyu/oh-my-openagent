/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { createTrackedSession } from "./tracked-session-state"

describe("createTrackedSession", () => {
  it("#given attachActivated true #when createTrackedSession called #then returns session with eager activation fields set", () => {
    // given
    const now = new Date()

    // when
    const session = createTrackedSession({
      sessionId: "ses-cmux-1",
      paneId: "%5",
      description: "test worker",
      attachActivated: true,
      now,
    })

    // then — eager activation fields mirror what activateFocusedPanes sets on normal activation
    expect(session.attachActivated).toBe(true)
    expect(session.attachActivatedAt).toBe(now)
    expect(session.stableIdlePolls).toBe(0)
    expect(session.observedIdleActivityVersion).toBe(0)  // matches activityVersion at creation
    expect(session.activityVersion).toBe(0)
    expect(session.createdAt).toBe(now)
    expect(session.lastSeenAt).toBe(now)
    expect(session.closePending).toBe(false)
    expect(session.closeRetryCount).toBe(0)
  })

  it("#given no attachActivated #when createTrackedSession called #then returns session with attachActivated false (regression guard)", () => {
    // given
    const now = new Date()

    // when
    const session = createTrackedSession({
      sessionId: "ses-normal-1",
      paneId: "%3",
      description: "normal worker",
      now,
    })

    // then — standard non-cmux behavior unchanged
    expect(session.attachActivated).toBe(false)
    expect(session.attachActivatedAt).toBeUndefined()
    expect(session.stableIdlePolls).toBeUndefined()
    expect(session.observedIdleActivityVersion).toBeUndefined()
    expect(session.activityVersion).toBe(0)
    expect(session.createdAt).toBe(now)
    expect(session.lastSeenAt).toBe(now)
  })
})
