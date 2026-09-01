import { describe, expect, test } from "bun:test"

import { createTask } from "./store"
import { createTask as coreCreateTask } from "@oh-my-opencode/team-core/team-tasklist/store"

describe("createTask adapter shim", () => {
  test("#given omo-opencode shim #when imported #then it re-exports team-core implementation", () => {
    expect(createTask).toBe(coreCreateTask)
  })
})
