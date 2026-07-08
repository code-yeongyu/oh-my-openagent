import { describe, expect, test } from "bun:test"

import { createFakeTeamService, fakeRuntimeState, fakeSummary } from "./__fixtures__/team-tool-fakes"
import { createTeamListTool, createTeamStatusTool, runTeamList, runTeamStatus } from "./status"

describe("team_status tool", () => {
  test("#given an active run #when team_status runs #then it reports members + statuses", async () => {
    // given
    const service = createFakeTeamService({ status: async () => fakeRuntimeState() })

    // when
    const result = await runTeamStatus(service, { team_run_id: "run-1" })

    // then
    expect(result.details).toMatchObject({ kind: "status", team_name: "demo", status: "active" })
    if (result.details.kind !== "status") throw new Error("expected status")
    expect(result.details.members).toEqual([
      { name: "alpha", status: "running" },
      { name: "beta", status: "idle" },
    ])
  })

  test("#given a missing run #when team_status runs #then it reports not_found", async () => {
    const service = createFakeTeamService({
      status: async () => {
        const error: NodeJS.ErrnoException = new Error("missing")
        error.code = "ENOENT"
        throw error
      },
    })
    const result = await runTeamStatus(service, { team_run_id: "gone" })
    expect(result.details).toMatchObject({ kind: "not_found", team_run_id: "gone" })
  })

  test("#given the factory #when built #then it names the tool team_status", () => {
    expect(createTeamStatusTool({ service: createFakeTeamService() }).name).toBe("team_status")
  })
})

describe("team_list tool", () => {
  test("#given active teams #when team_list runs #then it reports the rows", async () => {
    // given
    const service = createFakeTeamService({ listTeams: async () => [fakeSummary(), fakeSummary({ teamRunId: "run-2", teamName: "other" })] })

    // when
    const result = await runTeamList(service)

    // then
    expect(result.details.kind).toBe("list")
    if (result.details.kind !== "list") throw new Error("expected list")
    expect(result.details.teams.map((team) => team.team_name)).toEqual(["demo", "other"])
  })

  test("#given the factory #when built #then it names the tool team_list", () => {
    expect(createTeamListTool({ service: createFakeTeamService() }).name).toBe("team_list")
  })
})
