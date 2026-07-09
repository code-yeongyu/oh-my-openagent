import { describe, expect, test } from "bun:test"

import { TEAM_LEAD_SENTINEL } from "../../team"
import type { SendOutcome } from "../../steering"
import { createFakeTeamService, fakeRuntimeState } from "../team/__fixtures__/team-tool-fakes"
import { runTaskSend } from "./send"
import type { SendManager } from "./types"

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
