import { describe, expect, test } from "bun:test"
import { outcomeFailure } from "./outcome"

describe("outcomeFailure for a session the other device no longer runs", () => {
  for (const reason of ["unknown_session", "session_not_found"]) {
    test(`#given a command refused ${reason} #when it is explained #then it is not_resumable`, () => {
      const failure = outcomeFailure({ kind: "refused", reason }, "b")
      expect(failure.error.code).toBe("not_resumable")
      expect(failure.error.details).toEqual({ device: "b", reason })
    })
  }

  test("#given an unknown refusal #when it is explained #then it stays unsupported", () => {
    expect(outcomeFailure({ kind: "refused", reason: "method_unclassified" }, "b").error.code).toBe("unsupported")
  })
})
