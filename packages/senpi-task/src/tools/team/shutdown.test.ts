import { describe, expect, test } from "bun:test"

import { SenpiShutdownError } from "../../team"
import { createFakeTeamService, fakeRuntimeState } from "./__fixtures__/team-tool-fakes"
import {
  createTeamApproveShutdownTool,
  createTeamRejectShutdownTool,
  createTeamShutdownRequestTool,
  runTeamApproveShutdown,
  runTeamRejectShutdown,
  runTeamShutdownRequest,
} from "./shutdown"

describe("team_shutdown_request tool", () => {
  test("#given a member #when request runs #then it reports requested", async () => {
    const service = createFakeTeamService({ requestShutdown: async () => fakeRuntimeState({ status: "shutdown_requested" }) })
    const result = await runTeamShutdownRequest(service, { team_run_id: "run-1", member: "alpha" })
    expect(result.details).toMatchObject({ kind: "requested", member: "alpha" })
    expect(service.calls[0]).toMatchObject({ method: "requestShutdown", args: ["run-1", "alpha"] })
  })

  test("#given an unknown member #when request runs #then it reports unknown_member", async () => {
    const service = createFakeTeamService({
      requestShutdown: async () => {
        throw new SenpiShutdownError("unknown", "unknown_member", "run-1", "ghost")
      },
    })
    const result = await runTeamShutdownRequest(service, { team_run_id: "run-1", member: "ghost" })
    expect(result.details).toMatchObject({ kind: "unknown_member", member: "ghost" })
  })

  test("#given the factory #when built #then it names the tool team_shutdown_request", () => {
    expect(createTeamShutdownRequestTool({ service: createFakeTeamService() }).name).toBe("team_shutdown_request")
  })
})

describe("team_approve_shutdown tool", () => {
  test("#given a pending request #when approve runs #then it reports approved", async () => {
    const service = createFakeTeamService({ approveShutdown: async () => fakeRuntimeState() })
    const result = await runTeamApproveShutdown(service, { team_run_id: "run-1", member: "alpha" })
    expect(result.details).toMatchObject({ kind: "approved", member: "alpha" })
  })

  test("#given no pending request #when approve runs #then it reports no_pending_request", async () => {
    const service = createFakeTeamService({
      approveShutdown: async () => {
        throw new SenpiShutdownError("none", "no_pending_request", "run-1", "alpha")
      },
    })
    const result = await runTeamApproveShutdown(service, { team_run_id: "run-1", member: "alpha" })
    expect(result.details).toMatchObject({ kind: "no_pending_request", member: "alpha" })
  })

  test("#given the factory #when built #then it names the tool team_approve_shutdown", () => {
    expect(createTeamApproveShutdownTool({ service: createFakeTeamService() }).name).toBe("team_approve_shutdown")
  })
})

describe("team_reject_shutdown tool", () => {
  test("#given a pending request #when reject runs #then it reports rejected with the reason", async () => {
    const service = createFakeTeamService({ rejectShutdown: async () => fakeRuntimeState() })
    const result = await runTeamRejectShutdown(service, { team_run_id: "run-1", member: "alpha", reason: "keep going" })
    expect(result.details).toMatchObject({ kind: "rejected", member: "alpha", reason: "keep going" })
    expect(service.calls[0]).toMatchObject({ method: "rejectShutdown", args: ["run-1", "alpha", "keep going"] })
  })

  test("#given no pending request #when reject runs #then it reports no_pending_request", async () => {
    const service = createFakeTeamService({
      rejectShutdown: async () => {
        throw new SenpiShutdownError("none", "no_pending_request", "run-1", "alpha")
      },
    })
    const result = await runTeamRejectShutdown(service, { team_run_id: "run-1", member: "alpha", reason: "no" })
    expect(result.details.kind).toBe("no_pending_request")
  })

  test("#given the factory #when built #then it names the tool team_reject_shutdown", () => {
    expect(createTeamRejectShutdownTool({ service: createFakeTeamService() }).name).toBe("team_reject_shutdown")
  })
})
