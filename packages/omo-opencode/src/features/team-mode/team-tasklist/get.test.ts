import { describe, expect, test } from "bun:test"

import { getTask } from "./get"
import { getTask as coreGetTask } from "@oh-my-opencode/team-core/team-tasklist/get"

describe("getTask adapter shim", () => {
  test("#given omo-opencode shim #when imported #then it re-exports team-core implementation", () => {
    expect(getTask).toBe(coreGetTask)
  })
})
