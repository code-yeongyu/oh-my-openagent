import { describe, expect, test } from "bun:test"

import { CrossOwnerUpdateError, InvalidTaskTransitionError, updateTaskStatus } from "./update"
import {
  CrossOwnerUpdateError as CoreCrossOwnerUpdateError,
  InvalidTaskTransitionError as CoreInvalidTaskTransitionError,
  updateTaskStatus as coreUpdateTaskStatus,
} from "@oh-my-opencode/team-core/team-tasklist/update"

describe("updateTaskStatus adapter shim", () => {
  test("#given omo-opencode shim #when imported #then it re-exports team-core implementation", () => {
    expect(updateTaskStatus).toBe(coreUpdateTaskStatus)
    expect(CrossOwnerUpdateError).toBe(CoreCrossOwnerUpdateError)
    expect(InvalidTaskTransitionError).toBe(CoreInvalidTaskTransitionError)
  })
})
