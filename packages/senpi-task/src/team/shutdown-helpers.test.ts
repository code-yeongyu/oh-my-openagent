import { describe, expect, test } from "bun:test"

import type { RuntimeStateMember } from "@oh-my-opencode/team-core/types"

import { DELETABLE_MEMBER_STATUSES, isMemberDeletable } from "./shutdown-helpers"

const MEMBER_STATUSES: readonly RuntimeStateMember["status"][] = [
  "pending",
  "running",
  "idle",
  "errored",
  "completed",
  "shutdown_approved",
]

describe("shutdown helpers", () => {
  test("#given the omo shutdown-helpers parity set #when DELETABLE_MEMBER_STATUSES is read #then it is exactly completed/shutdown_approved/errored", () => {
    // given / when
    const deletable = [...DELETABLE_MEMBER_STATUSES].sort()

    // then
    expect(deletable).toEqual(["completed", "errored", "shutdown_approved"])
  })

  test("#given each member status #when isMemberDeletable is applied #then only terminal-safe statuses are deletable", () => {
    // given / when
    const verdicts = MEMBER_STATUSES.map((status) => [status, isMemberDeletable(status)] as const)

    // then
    expect(verdicts).toEqual([
      ["pending", false],
      ["running", false],
      ["idle", false],
      ["errored", true],
      ["completed", true],
      ["shutdown_approved", true],
    ])
  })
})
