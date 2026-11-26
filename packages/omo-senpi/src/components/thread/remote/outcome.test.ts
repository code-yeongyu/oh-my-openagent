import { describe, expect, test } from "bun:test"
import { outcomeFailure } from "./outcome"

describe("outcomeFailure for a session the other device no longer runs", () => {
  for (const reason of ["unknown_session", "session_not_found", "route_unlisted"]) {
    test(`#given a command refused ${reason} #when it is explained #then it is not_resumable`, () => {
      const failure = outcomeFailure({ kind: "refused", reason }, "b")
      expect(failure.error.code).toBe("not_resumable")
      expect(failure.error.details).toEqual({ device: "b", reason })
    })
  }

  // #14320: a busy target whose turn changed is never reported as an unsupported device.
  for (const reason of ["turn_conflict", "not_steerable"] as const) {
    test(`#given a command refused ${reason} #when it is explained #then it is ${reason}, not unsupported`, () => {
      const failure = outcomeFailure({ kind: "refused", reason }, "b")
      expect(failure.error.code).toBe(reason)
      expect(failure.error.details).toEqual({ device: "b", reason })
    })
  }

  test("#given an unknown refusal #when it is explained #then it stays unsupported", () => {
    expect(outcomeFailure({ kind: "refused", reason: "method_unclassified" }, "b").error.code).toBe("unsupported")
  })
})

// #15093: one rule per reason. A reason that says a record's answer was lost after it left (the device service's
// uncertain vocabulary, delivered_unconfirmed, reply_lost) cannot prove the record changed nothing, so its answer never
// says it did (`effect: "unknown"`); only a refusal given before anything reached the device says so (`effect: "none"`).
describe("outcomeFailure classifies each lost-answer reason one way (#15093)", () => {
  for (const reason of ["request_gone", "delivered_unconfirmed", "reply_lost", "no_receipt", "transport_expired"]) {
    test(`#given a read refused ${reason} (its answer was lost after it left) #when it is explained #then host_unavailable with an unknown effect`, () => {
      const failure = outcomeFailure({ kind: "refused", reason }, "b")
      expect(failure.error.code).toBe("host_unavailable")
      expect(failure.error.details).toEqual({ device: "b", reason, effect: "unknown" })
    })
  }

  for (const reason of ["host_not_answering", "attach_failed", "peer_not_found"]) {
    test(`#given a command refused ${reason} before it reached the device #when it is explained #then host_unavailable with no effect`, () => {
      const failure = outcomeFailure({ kind: "refused", reason }, "b")
      expect(failure.error.code).toBe("host_unavailable")
      expect(failure.error.details).toEqual({ device: "b", reason, effect: "none" })
    })
  }
})

// #14358: an engine_capability_missing refusal that names a cause that passes on its own (an attach the device does not
// count even after this device re-attached, no omo engine up there) is a retry, never an "update omo" unsupported device.
describe("outcomeFailure for engine_capability_missing with a named cause", () => {
  for (const cause of ["attach_required", "daemon_unavailable"]) {
    test(`#given a refusal naming ${cause} #when it is explained #then it is host_unavailable naming that cause`, () => {
      const failure = outcomeFailure({ kind: "refused", reason: "engine_capability_missing", detail: cause }, "b")
      expect(failure.error.code).toBe("host_unavailable")
      expect(failure.error.details).toEqual({ device: "b", reason: "engine_capability_missing", cause })
    })
  }

  test("#given a refusal naming no cause #when it is explained #then it stays unsupported", () => {
    expect(outcomeFailure({ kind: "refused", reason: "engine_capability_missing" }, "b").error.code).toBe("unsupported")
  })
})
