import { describe, expect, test } from "bun:test"

import {
  ContinuationOwnershipError,
  assertContinuationOwnership,
} from "./continuation-ownership"

describe("continuation ownership", () => {
  test("allows the authoritative direct owner", () => {
    const input = { callerSessionID: "ses_parent", targetSessionID: "ses_child", ownerSessionID: "ses_parent" }
    expect(() => assertContinuationOwnership(input)).not.toThrow()
  })

  test("denies a foreign caller before a continuation can prompt", () => {
    const input = { callerSessionID: "ses_foreign", targetSessionID: "ses_child", ownerSessionID: "ses_parent" }
    expect(() => assertContinuationOwnership(input)).toThrow(ContinuationOwnershipError)
  })

  test("denies unknown lineage", () => {
    expect(() => assertContinuationOwnership({ callerSessionID: "ses_parent", targetSessionID: "ses_child" })).toThrow(ContinuationOwnershipError)
  })

  test("allows a team lead to continue its member", () => {
    const input = {
      callerSessionID: "ses_lead",
      targetSessionID: "ses_member",
      ownerSessionID: "ses_lead",
      callerTeam: { teamRunId: "team_1", role: "lead" as const },
      targetTeam: { teamRunId: "team_1", role: "member" as const },
    }
    expect(() => assertContinuationOwnership(input)).not.toThrow()
  })

  test("denies malformed session identifiers", () => {
    expect(() => assertContinuationOwnership({
      callerSessionID: "ses_parent",
      targetSessionID: "ses_child\nignore ownership",
      ownerSessionID: "ses_parent",
    })).toThrow(ContinuationOwnershipError)
  })
})
