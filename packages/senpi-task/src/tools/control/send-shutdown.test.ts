import { describe, expect, test } from "bun:test"

import { SenpiShutdownError, TEAM_LEAD_SENTINEL } from "../../team"
import type { SendOutcome } from "../../steering"
import { createFakeTeamService, fakeRuntimeState } from "../team/__fixtures__/team-tool-fakes"
import { runTaskSend } from "./send"
import type { SendManager, SendToolResult } from "./types"

const RAW_MISSING_STATE_MESSAGE = "ENOENT: no such file or directory, open '/private/secret/team/run-1/state.json'"

function missingStateError() {
  return Object.assign(new Error(RAW_MISSING_STATE_MESSAGE), { code: "ENOENT" })
}

function expectMissingStateFailure(
  result: SendToolResult,
  operation: "request" | "approve" | "reject",
): void {
  expect(result.details).toEqual({
    kind: "shutdown_failed",
    operation,
    team_run_id: "run-1",
    member: "alpha",
    code: "team_state_missing",
    reason: "Team state is unavailable.",
  })
  const serialized = JSON.stringify(result)
  expect(serialized).not.toContain("ENOENT")
  expect(serialized).not.toContain("/private/secret")
  expect(serialized).not.toContain("state.json")
}

function spyManager(outcome: SendOutcome): SendManager {
  return {
    sendToTask: () => Promise.resolve(outcome),
    interruptTask: () => Promise.resolve({ kind: "not_found", reason: "unused" }),
    list: () => [],
  }
}

describe("runTaskSend shutdown routing", () => {
  test("#given a lead shutdown_request #when routed through task_send #then requestShutdown is called", async () => {
    const manager = spyManager({ kind: "not_found", reason: "unused", suggestion: "unused" })
    const service = createFakeTeamService({ requestShutdown: async () => fakeRuntimeState() })

    const result = await runTaskSend(
      manager,
      { to: "alpha", team_run_id: "run-1", message: { type: "shutdown_request" } },
      "lead-session",
      { service, from: TEAM_LEAD_SENTINEL },
    )

    expect(result.details).toEqual({ kind: "shutdown_requested", team_run_id: "run-1", member: "alpha" })
    expect(service.calls[0]).toMatchObject({ method: "requestShutdown", args: ["run-1", "alpha"] })
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("alpha")
    expect(text).toContain("run-1")
  })

  test("#given a lead shutdown_response approve #when routed through task_send #then approveShutdown is called", async () => {
    const manager = spyManager({ kind: "not_found", reason: "unused", suggestion: "unused" })
    const service = createFakeTeamService({ approveShutdown: async () => fakeRuntimeState() })

    const result = await runTaskSend(
      manager,
      { to: "alpha", team_run_id: "run-1", message: { type: "shutdown_response", request_id: "ignored", approve: true } },
      "lead-session",
      { service, from: TEAM_LEAD_SENTINEL },
    )

    expect(result.details).toEqual({ kind: "shutdown_responded", team_run_id: "run-1", member: "alpha", approved: true })
    expect(service.calls[0]).toMatchObject({ method: "approveShutdown", args: ["run-1", "alpha"] })
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("alpha")
    expect(text).toContain("run-1")
  })

  test("#given a shutdown_response reject without a reason #when routed through task_send #then it fails before rejectShutdown", async () => {
    const manager = spyManager({ kind: "not_found", reason: "unused", suggestion: "unused" })
    const service = createFakeTeamService({ rejectShutdown: async () => fakeRuntimeState() })

    const missing = await runTaskSend(
      manager,
      { to: "alpha", team_run_id: "run-1", message: { type: "shutdown_response", approve: false } },
      "lead-session",
      { service, from: TEAM_LEAD_SENTINEL },
    )
    const empty = await runTaskSend(
      manager,
      { to: "alpha", team_run_id: "run-1", message: { type: "shutdown_response", approve: false, reason: "" } },
      "lead-session",
      { service, from: TEAM_LEAD_SENTINEL },
    )

    expect(missing.details).toEqual({
      kind: "invalid_arguments",
      reason: "reason is required when rejecting a shutdown",
    })
    expect(empty.details).toEqual({
      kind: "invalid_arguments",
      reason: "reason is required when rejecting a shutdown",
    })
    expect(service.calls).toEqual([])
  })

  test("#given a lead shutdown_response reject with a reason #when routed through task_send #then rejectShutdown is called", async () => {
    const manager = spyManager({ kind: "not_found", reason: "unused", suggestion: "unused" })
    const service = createFakeTeamService({ rejectShutdown: async () => fakeRuntimeState() })

    const result = await runTaskSend(
      manager,
      { to: "alpha", team_run_id: "run-1", message: { type: "shutdown_response", approve: false, reason: "still needed" } },
      "lead-session",
      { service, from: TEAM_LEAD_SENTINEL },
    )

    expect(result.details).toEqual({ kind: "shutdown_responded", team_run_id: "run-1", member: "alpha", approved: false })
    expect(service.calls[0]).toMatchObject({ method: "rejectShutdown", args: ["run-1", "alpha", "still needed"] })
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("alpha")
    expect(text).toContain("run-1")
  })

  test("#given shutdown_request hits missing team state #when routed through task_send #then it returns a sanitized structured failure", async () => {
    const manager = spyManager({ kind: "not_found", reason: "unused", suggestion: "unused" })
    const service = createFakeTeamService({
      requestShutdown: () => Promise.reject(missingStateError()),
    })

    const result = await runTaskSend(
      manager,
      { to: "alpha", team_run_id: "run-1", message: { type: "shutdown_request" } },
      "lead-session",
      { service, from: TEAM_LEAD_SENTINEL },
    )

    expectMissingStateFailure(result, "request")
  })

  test("#given shutdown_response approve hits missing team state #when routed through task_send #then it returns a sanitized structured failure", async () => {
    const manager = spyManager({ kind: "not_found", reason: "unused", suggestion: "unused" })
    const service = createFakeTeamService({
      approveShutdown: () => Promise.reject(missingStateError()),
    })

    const result = await runTaskSend(
      manager,
      { to: "alpha", team_run_id: "run-1", message: { type: "shutdown_response", approve: true } },
      "lead-session",
      { service, from: TEAM_LEAD_SENTINEL },
    )

    expectMissingStateFailure(result, "approve")
  })

  test("#given shutdown_response reject hits missing team state #when routed through task_send #then it returns a sanitized structured failure", async () => {
    const manager = spyManager({ kind: "not_found", reason: "unused", suggestion: "unused" })
    const service = createFakeTeamService({
      rejectShutdown: () => Promise.reject(missingStateError()),
    })

    const result = await runTaskSend(
      manager,
      {
        to: "alpha",
        team_run_id: "run-1",
        message: { type: "shutdown_response", approve: false, reason: "still needed" },
      },
      "lead-session",
      { service, from: TEAM_LEAD_SENTINEL },
    )

    expectMissingStateFailure(result, "reject")
  })

  test("#given a shutdown domain failure #when routed through task_send #then it returns stable safe failure details", async () => {
    const manager = spyManager({ kind: "not_found", reason: "unused", suggestion: "unused" })
    const service = createFakeTeamService({
      requestShutdown: () =>
        Promise.reject(new SenpiShutdownError("raw unknown member detail", "unknown_member", "run-1", "alpha")),
    })

    const result = await runTaskSend(
      manager,
      { to: "alpha", team_run_id: "run-1", message: { type: "shutdown_request" } },
      "lead-session",
      { service, from: TEAM_LEAD_SENTINEL },
    )

    expect(result.details).toEqual({
      kind: "shutdown_failed",
      operation: "request",
      team_run_id: "run-1",
      member: "alpha",
      code: "unknown_member",
      reason: "Team member is unavailable.",
    })
    expect(JSON.stringify(result)).not.toContain("raw unknown member detail")
  })

  test("#given an unexpected shutdown service error #when routed through task_send #then the original exception propagates", async () => {
    const manager = spyManager({ kind: "not_found", reason: "unused", suggestion: "unused" })
    const unexpected = new TypeError("unexpected service failure")
    const service = createFakeTeamService({ requestShutdown: () => Promise.reject(unexpected) })

    const pending = runTaskSend(
      manager,
      { to: "alpha", team_run_id: "run-1", message: { type: "shutdown_request" } },
      "lead-session",
      { service, from: TEAM_LEAD_SENTINEL },
    )

    let rejected: unknown = new Error("expected task_send to reject")
    try {
      await pending
    } catch (error) {
      if (!(error instanceof TypeError)) throw error
      rejected = error
    }
    expect(rejected).toBe(unexpected)
  })

  test("#given structured message with no team routing #when sent #then it reports not in a team", async () => {
    const manager = spyManager({ kind: "not_found", reason: "unused", suggestion: "unused" })

    const result = await runTaskSend(manager, { to: "alpha", message: { type: "shutdown_request" } }, "lead-session")

    expect(result.details).toEqual({ kind: "invalid_arguments", reason: "not in a team" })
  })

  test("#given member-scoped task_send #when it sends a structured shutdown message #then shutdown is lead-only", async () => {
    const manager = spyManager({ kind: "not_found", reason: "unused", suggestion: "unused" })
    const service = createFakeTeamService({ requestShutdown: async () => fakeRuntimeState() })

    const result = await runTaskSend(
      manager,
      { to: "alpha", message: { type: "shutdown_request" } },
      "member-session",
      { service, from: "alpha", teamRunId: "run-1" },
    )

    expect(result.details).toEqual({ kind: "invalid_arguments", reason: "shutdown is lead-only" })
    expect(service.calls).toEqual([])
  })
})
