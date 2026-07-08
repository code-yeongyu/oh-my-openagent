import { describe, expect, test } from "bun:test"

import { filterSharedParentTools, mergeChildCustomTools } from "../../runners"
import { createFakeTeamService } from "./__fixtures__/team-tool-fakes"
import { buildLeadTeamTools, createMemberScopedSendMessageTool } from "./index"

describe("member child team-tool allowlist", () => {
  test("#given the 12 lead team tools #when built #then exactly the 12 named team tools exist", () => {
    // given / when
    const tools = buildLeadTeamTools({ service: createFakeTeamService() })

    // then
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [
        "team_approve_shutdown",
        "team_create",
        "team_delete",
        "team_list",
        "team_reject_shutdown",
        "team_send_message",
        "team_shutdown_request",
        "team_status",
        "team_task_create",
        "team_task_get",
        "team_task_list",
        "team_task_update",
      ].sort(),
    )
  })

  test("#given the 12 team tools as shared parent tools #when filtered for a child #then ALL 12 are excluded", () => {
    // given
    const teamTools = buildLeadTeamTools({ service: createFakeTeamService() })

    // when
    const childTools = filterSharedParentTools(teamTools)

    // then
    expect(childTools).toHaveLength(0)
  })

  test("#given a member with the pre-scoped send #when child tools merge #then ONLY team_send_message survives", () => {
    // given: the parent exposes all 12 lead team tools; the spawner injects the member-scoped send
    const teamTools = buildLeadTeamTools({ service: createFakeTeamService() })
    const memberSend = createMemberScopedSendMessageTool({ service: createFakeTeamService(), teamRunId: "run-1", from: "alpha" })

    // when
    const childTools = mergeChildCustomTools(teamTools, [memberSend])

    // then
    expect(childTools.map((tool) => tool.name)).toEqual(["team_send_message"])
  })
})
