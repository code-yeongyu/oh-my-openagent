/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { TeamTeammateMemberSchema } from "./types"

describe("agent-teams types", () => {
  test("rejects reserved agentType for teammate schema", () => {
    //#given
    const invalidTeammate = {
      agentId: "worker@team",
      name: "worker",
      agentType: "team-lead",
      model: "native",
      prompt: "do work",
      color: "blue",
      planModeRequired: false,
      joinedAt: Date.now(),
      cwd: "/tmp",
      subscriptions: [],
      backendType: "native",
      isActive: false,
    }

    //#when
    const result = TeamTeammateMemberSchema.safeParse(invalidTeammate)

    //#then
    expect(result.success).toBe(false)
  })
})
