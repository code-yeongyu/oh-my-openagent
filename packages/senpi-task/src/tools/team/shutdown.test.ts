import { describe, expect, test } from "bun:test"

import { SenpiShutdownError } from "../../team"
import { createFakeTeamService, fakeRuntimeState } from "./__fixtures__/team-tool-fakes"
import {
  runTeamApproveShutdown,
  runTeamRejectShutdown,
  runTeamShutdownRequest,
} from "./shutdown"

describe("shutdown request route", () => {
  test("#given a member #when request runs #then it reports requested", async () => {
    const service = createFakeTeamService({ requestShutdown: async () => fakeRuntimeState({ status: "shutdown_requested" }) })
    const result = await runTeamShutdownRequest(service, { team_run_id: "run-1", member: "alpha" })
    expect(result.details).toMatchObject({ kind: "requested", member: "alpha" })
    expect(service.calls[0]).toMatchObject({ method: "requestShutdown", args: ["run-1", "alpha"] })
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("'alpha'")
    expect(text).toContain("run-1")
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
})

describe("shutdown approve route", () => {
  test("#given a pending request #when approve runs #then it reports approved", async () => {
    const service = createFakeTeamService({ approveShutdown: async () => fakeRuntimeState() })
    const result = await runTeamApproveShutdown(service, { team_run_id: "run-1", member: "alpha" })
    expect(result.details).toMatchObject({ kind: "approved", member: "alpha" })
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("'alpha'")
    expect(text).toContain("run-1")
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
})

describe("shutdown reject route", () => {
  test("#given a pending request #when reject runs #then it reports rejected with the reason", async () => {
    const service = createFakeTeamService({ rejectShutdown: async () => fakeRuntimeState() })
    const result = await runTeamRejectShutdown(service, { team_run_id: "run-1", member: "alpha", reason: "keep going" })
    expect(result.details).toMatchObject({ kind: "rejected", member: "alpha", reason: "keep going" })
    expect(service.calls[0]).toMatchObject({ method: "rejectShutdown", args: ["run-1", "alpha", "keep going"] })
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("'alpha'")
    expect(text).toContain("run-1")
    expect(text).toContain("keep going")
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
})
