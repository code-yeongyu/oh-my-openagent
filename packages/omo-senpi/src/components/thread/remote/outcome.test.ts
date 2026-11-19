import { describe, expect, test } from "bun:test";
import { outcomeFailure } from "./outcome";

describe("outcomeFailure for a session the other device no longer runs", () => {
  for (const reason of ["unknown_session", "session_not_found", "route_unlisted"]) {
    test(`#given a command refused ${reason} #when it is explained #then it is not_resumable`, () => {
      const failure = outcomeFailure({ kind: "refused", reason }, "b");
      expect(failure.error.code).toBe("not_resumable");
      expect(failure.error.details).toEqual({ device: "b", reason });
    });
  }

  test("#given an unknown refusal #when it is explained #then it stays unsupported", () => {
    expect(outcomeFailure({ kind: "refused", reason: "method_unclassified" }, "b").error.code).toBe(
      "unsupported",
    );
  });
});

// A host refuses a live session engine_capability_missing and names why in the receipt (`detail`). Only a cause that
// says the engine will never take the command is an unsupported device; a transient one is a retry, never "update omo".
describe("outcomeFailure for engine_capability_missing with a named cause", () => {
  for (const cause of ["engine_unproven", "daemon_unavailable"]) {
    test(`#given a refusal naming ${cause} #when it is explained #then it is host_unavailable naming that cause`, () => {
      const failure = outcomeFailure(
        { kind: "refused", reason: "engine_capability_missing", detail: cause },
        "b",
      );
      expect(failure.error.code).toBe("host_unavailable");
      expect(failure.error.details).toEqual({
        device: "b",
        reason: "engine_capability_missing",
        cause,
      });
    });
  }

  test("#given a refusal naming engine_not_delegated or no cause #when it is explained #then it stays unsupported", () => {
    for (const detail of ["engine_not_delegated", undefined]) {
      const outcome = {
        kind: "refused" as const,
        reason: "engine_capability_missing",
        ...(detail === undefined ? {} : { detail }),
      };
      expect(outcomeFailure(outcome, "b").error.code).toBe("unsupported");
    }
  });
});
