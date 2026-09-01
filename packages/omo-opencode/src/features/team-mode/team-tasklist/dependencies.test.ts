import { describe, expect, test } from "bun:test"

import { canClaim } from "./dependencies"
import { canClaim as coreCanClaim } from "@oh-my-opencode/team-core/team-tasklist/dependencies"

describe("canClaim adapter shim", () => {
  test("#given omo-opencode shim #when imported #then it re-exports team-core implementation", () => {
    expect(canClaim).toBe(coreCanClaim)
  })
})
