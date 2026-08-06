import { describe, expect, test } from "bun:test"
import { filterSharedParentTools, mergeChildCustomTools } from "../../runners"
import { createMemberScopedTaskSendTool, type SendManager } from "../control"
import { createFakeTeamService } from "./__fixtures__/team-tool-fakes"
import { buildLeadTeamTools } from "./index"
import type { LeadTeamToolDeps } from "./types"

const fakeSendManager: SendManager = {
  sendToTask: async () => ({ kind: "not_found", reason: "missing", suggestion: "none" }),
  list: () => [],
}

function leadToolDeps(): LeadTeamToolDeps {
  return { service: createFakeTeamService() }
}

describe("member child team-tool allowlist", () => {
  test("#given the lead team tools w2lead #when built #then the injection-only surface has no blocking wait", () => {
    // given / when
    const tools = buildLeadTeamTools(leadToolDeps())

    // then
    expect(tools.map((tool) => tool.name)).toEqual([
      "team_create",
      "team_delete",
      "task_create",
      "task_get",
      "task_list",
      "task_update",
    ])
  })

  test("#given the lead team tools as shared parent tools #when filtered for a child #then all are excluded", () => {
    // given
    const teamTools = buildLeadTeamTools(leadToolDeps())

    // when
    const childTools = filterSharedParentTools(teamTools)

    // then
    expect(childTools).toHaveLength(0)
  })

  test("#given a member with the pre-scoped send #when child tools merge #then ONLY task_send survives", () => {
    const teamTools = buildLeadTeamTools(leadToolDeps())
    const memberSend = createMemberScopedTaskSendTool({
      manager: fakeSendManager,
      service: createFakeTeamService(),
      teamRunId: "run-1",
      from: "alpha",
    })

    // when
    const childTools = mergeChildCustomTools(teamTools, [memberSend])

    // then
    expect(childTools.map((tool) => tool.name)).toEqual(["task_send"])
  })
})
