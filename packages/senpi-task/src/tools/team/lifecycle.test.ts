import { describe, expect, test } from "bun:test"

import { SenpiTeamRuntimeError, SenpiTeamSpecError } from "../../team"
import { createFakeTeamService, fakeCreateResult, fakeDeleteResult } from "./__fixtures__/team-tool-fakes"
import { TeamCreateParams, createTeamCreateTool, createTeamDeleteTool, runTeamCreate, runTeamDelete } from "./lifecycle"

describe("team_create tool", () => {
  test("#given the team_create schema #when inspected #then it exposes no model-supplied lead_session_id override", () => {
    // then: the lead is always the current session; the spoofable override must not exist
    expect(Object.keys(TeamCreateParams.properties)).not.toContain("lead_session_id")
  })

  test("#given an inline spec #when team_create runs #then it reports the created run and members", async () => {
    // given
    const service = createFakeTeamService({ createTeam: async () => fakeCreateResult() })

    // when
    const result = await runTeamCreate(service, { inline_spec: { name: "demo", members: [] } })

    // then
    expect(result.details).toMatchObject({ kind: "created", team_name: "demo" })
    if (result.details.kind !== "created") throw new Error("expected created")
    expect(result.details.members.map((member) => member.name).sort()).toEqual(["alpha", "beta"])
    expect(service.calls[0]).toMatchObject({ method: "createTeam", args: [{ inlineSpec: { name: "demo", members: [] } }] })
  })

  test("#given both team_name and inline_spec #when team_create runs #then it rejects with invalid_arguments", async () => {
    // given
    const service = createFakeTeamService()

    // when
    const result = await runTeamCreate(service, { team_name: "x", inline_spec: { name: "y" } })

    // then
    expect(result.details.kind).toBe("invalid_arguments")
    expect(service.calls).toHaveLength(0)
  })

  test("#given neither team_name nor inline_spec #when team_create runs #then it rejects with invalid_arguments", async () => {
    const service = createFakeTeamService()
    const result = await runTeamCreate(service, {})
    expect(result.details.kind).toBe("invalid_arguments")
  })

  test("#given a spec error #when team_create runs #then it surfaces spec_error with the code", async () => {
    // given
    const service = createFakeTeamService({
      createTeam: async () => {
        throw new SenpiTeamSpecError("bad member", "UNKNOWN_SUBAGENT_TYPE", "demo")
      },
    })

    // when
    const result = await runTeamCreate(service, { team_name: "demo" })

    // then
    expect(result.details).toMatchObject({ kind: "spec_error", code: "UNKNOWN_SUBAGENT_TYPE" })
  })

  test("#given a bounds runtime error #when team_create runs #then it surfaces runtime_error with the code", async () => {
    const service = createFakeTeamService({
      createTeam: async () => {
        throw new SenpiTeamRuntimeError("too many", "bounds_exceeded", "demo")
      },
    })
    const result = await runTeamCreate(service, { team_name: "demo" })
    expect(result.details).toMatchObject({ kind: "runtime_error", code: "bounds_exceeded" })
  })

  test("#given the factory #when built #then it names the tool team_create", () => {
    const tool = createTeamCreateTool({ service: createFakeTeamService() })
    expect(tool.name).toBe("team_create")
  })
})

describe("team_delete tool", () => {
  test("#given an active run #when team_delete runs #then it reports the deleted run + cancelled tasks", async () => {
    // given
    const service = createFakeTeamService({ deleteTeam: async () => fakeDeleteResult() })

    // when
    const result = await runTeamDelete(service, { team_run_id: "run-1" })

    // then
    expect(result.details).toMatchObject({ kind: "deleted", cancelled_task_ids: ["st_a"] })
    expect(service.calls[0]).toMatchObject({ method: "deleteTeam", args: [{ teamRunId: "run-1", force: undefined }] })
  })

  test("#given force #when team_delete runs #then it forwards force=true", async () => {
    const service = createFakeTeamService({ deleteTeam: async () => fakeDeleteResult() })
    await runTeamDelete(service, { team_run_id: "run-1", force: true })
    expect(service.calls[0]?.args[0]).toMatchObject({ teamRunId: "run-1", force: true })
  })

  test("#given an illegal delete state #when team_delete runs #then it surfaces invalid_state", async () => {
    const service = createFakeTeamService({
      deleteTeam: async () => {
        throw new SenpiTeamRuntimeError("cannot delete", "invalid_delete_state", "run-1")
      },
    })
    const result = await runTeamDelete(service, { team_run_id: "run-1" })
    expect(result.details).toMatchObject({ kind: "invalid_state", team_run_id: "run-1" })
  })

  test("#given the factory #when built #then it names the tool team_delete", () => {
    const tool = createTeamDeleteTool({ service: createFakeTeamService() })
    expect(tool.name).toBe("team_delete")
  })
})
