import { describe, expect, test } from "bun:test"

import { listTasks } from "./list"
import { listTasks as coreListTasks } from "@oh-my-opencode/team-core/team-tasklist/list"

describe("listTasks adapter shim", () => {
  test("#given omo-opencode shim #when imported #then it re-exports team-core implementation", () => {
    expect(listTasks).toBe(coreListTasks)
  })
})
