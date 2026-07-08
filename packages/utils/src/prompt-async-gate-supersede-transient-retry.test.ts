import { afterEach, describe, expect, test } from "bun:test"

import { releaseAllPromptAsyncReservationsForTesting, releasePromptAsyncReservation } from "./prompt-async-gate"
import {
  getPromptReservation,
  isTransientRetryReservationOwner,
  reservationSourceMatches,
  setPromptReservation,
  TRANSIENT_RETRY_RESERVATION_OWNER,
} from "./prompt-async-gate/reservations"

function reserve(sessionID: string, source: string): void {
  setPromptReservation(sessionID, {
    source,
    dedupeKey: "in-flight-stream",
    reservedAt: Date.now(),
    token: Symbol("in-flight-stream"),
    expiresAt: Date.now() + 60_000,
  })
}

describe("isTransientRetryReservationOwner", () => {
  test("#given the bare model-suggestion-retry owner #then it is transient", () => {
    expect(isTransientRetryReservationOwner(TRANSIENT_RETRY_RESERVATION_OWNER)).toBe(true)
  })

  test("#given a model-suggestion-retry: variant owner #then it is transient", () => {
    expect(isTransientRetryReservationOwner("model-suggestion-retry:sync")).toBe(true)
    expect(isTransientRetryReservationOwner("model-suggestion-retry:sync-retry")).toBe(true)
  })

  test("#given an unrelated owner #then it is not transient", () => {
    expect(isTransientRetryReservationOwner("user-prompt")).toBe(false)
    expect(isTransientRetryReservationOwner("ralph-loop")).toBe(false)
    expect(isTransientRetryReservationOwner("runtime-fallback:session.status")).toBe(false)
  })
})

describe("reservationSourceMatches supersedeTransientRetryOwners", () => {
  test("#given a model-suggestion-retry reservation and a foreign expected source #when supersede is on #then it matches", () => {
    expect(reservationSourceMatches("model-suggestion-retry", "ralph-loop", undefined, true)).toBe(true)
    expect(reservationSourceMatches("model-suggestion-retry:sync", "runtime-fallback:x", undefined, true)).toBe(true)
  })

  test("#given a model-suggestion-retry reservation #when supersede is off #then it does NOT match a foreign source", () => {
    expect(reservationSourceMatches("model-suggestion-retry", "ralph-loop", undefined, false)).toBe(false)
    expect(reservationSourceMatches("model-suggestion-retry", "ralph-loop")).toBe(false)
  })

  test("#given a user-prompt reservation #when supersede is on #then it is still NOT matched (foreground turn protected)", () => {
    expect(reservationSourceMatches("user-prompt", "ralph-loop", undefined, true)).toBe(false)
  })
})

describe("releasePromptAsyncReservation supersedeTransientRetryOwners", () => {
  afterEach(() => {
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given a session reserved by model-suggestion-retry #when a foreign recovery release passes supersede #then the reservation is cleared", () => {
    // given
    const sessionID = "session-transient-held"
    reserve(sessionID, "model-suggestion-retry")

    // when
    const released = releasePromptAsyncReservation(sessionID, "ralph-loop", {
      supersedeTransientRetryOwners: true,
    })

    // then
    expect(released).toBe(true)
    expect(getPromptReservation(sessionID)).toBeUndefined()
  })

  test("#given a session reserved by model-suggestion-retry #when the foreign release omits supersede #then the reservation survives (reproduces the original deadlock)", () => {
    // given
    const sessionID = "session-transient-deadlock"
    reserve(sessionID, "model-suggestion-retry")

    // when
    const released = releasePromptAsyncReservation(sessionID, "ralph-loop")

    // then
    expect(released).toBe(false)
    expect(getPromptReservation(sessionID)?.source).toBe("model-suggestion-retry")
  })

  test("#given a session reserved by user-prompt #when a recovery release passes supersede #then the foreground turn is preserved", () => {
    // given
    const sessionID = "session-user-held"
    reserve(sessionID, "user-prompt")

    // when
    const released = releasePromptAsyncReservation(sessionID, "runtime-fallback-abort:x", {
      reservedBy: "runtime-fallback:x",
      reservedByPrefix: "runtime-fallback:",
      supersedeTransientRetryOwners: true,
    })

    // then
    expect(released).toBe(false)
    expect(getPromptReservation(sessionID)?.source).toBe("user-prompt")
  })
})
