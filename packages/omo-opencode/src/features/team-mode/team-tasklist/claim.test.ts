import { describe, expect, test } from "bun:test"

import {
  AlreadyClaimedError,
  BlockedByError,
  claimTask,
} from "./claim"
import {
  AlreadyClaimedError as coreAlreadyClaimedError,
  BlockedByError as coreBlockedByError,
  claimTask as coreClaimTask,
} from "@oh-my-opencode/team-core/team-tasklist/claim"

describe("claimTask adapter shim", () => {
  test("#given omo-opencode shim #when imported #then it re-exports team-core implementation", () => {
    expect(claimTask).toBe(coreClaimTask)
    expect(AlreadyClaimedError).toBe(coreAlreadyClaimedError)
    expect(BlockedByError).toBe(coreBlockedByError)
  })
})
