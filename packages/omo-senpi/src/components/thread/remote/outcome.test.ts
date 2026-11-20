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
