import { afterEach, describe, expect, test } from "bun:test"

import { baseSpec, cleanupProjects, makeManager } from "../../manager/__fixtures__/manager-fakes"
import { TEAM_LEAD_SENTINEL } from "../../team"
import type { SendInput, SendOutcome } from "../../steering"
import { createFakeTeamService, fakeRuntimeState } from "../team/__fixtures__/team-tool-fakes"
import { createMemberScopedTaskSendTool, runTaskSend } from "./send"
import type { SendManager } from "./types"

afterEach(cleanupProjects)

function spyManager(outcome: SendOutcome): { manager: SendManager; sendCalls: SendInput[] } {
  const sendCalls: SendInput[] = []
  return {
    manager: {
      sendToTask: (input) => {
        sendCalls.push(input)
        return Promise.resolve(outcome)
      },
      list: () => [],
    },
    sendCalls,
  }
}

describe("runTaskSend team routing", () => {
  test("#given a string recipient that is not a child but is a team member #when team routing is present #then it sends a team message", async () => {
    const { manager } = spyManager({ kind: "not_found", reason: "No task found for \"beta\".", suggestion: "unused" })
    const service = createFakeTeamService({
      sendMessage: async () => ({
        kind: "to_members",
        messageId: "msg-1",
        recipients: ["beta"],
      }),
    })

    const result = await runTaskSend(
      manager,
      { to: "beta", message: "please report", team_run_id: "run-1", summary: "report" },
      "lead-session",
      { service, from: TEAM_LEAD_SENTINEL },
    )

    expect(result.details.kind).toBe("team_message")
    expect(service.calls[0]).toMatchObject({
      method: "sendMessage",
      args: ["run-1", { from: TEAM_LEAD_SENTINEL, to: "beta", body: "please report", summary: "report" }],
    })
  })

  test("#given a team route without a run id #when child lookup misses #then it fails before service calls", async () => {
    const { manager } = spyManager({ kind: "not_found", reason: "No task found for \"beta\".", suggestion: "unused" })
    const service = createFakeTeamService({
      sendMessage: async () => ({ kind: "to_members", messageId: "unused", recipients: [] }),
    })

    const result = await runTaskSend(
      manager,
      { to: "beta", message: "please report" },
      "lead-session",
      { service, from: TEAM_LEAD_SENTINEL },
    )

    expect(result.details.kind).toBe("invalid_arguments")
    if (result.details.kind !== "invalid_arguments") throw new Error("expected invalid_arguments")
    expect(result.details.reason).toContain("team_run_id is required")
    expect(service.calls).toEqual([])
  })

  test("#given no team_run_id and a default resolver with one owned team #when child lookup misses #then the send uses the resolved team", async () => {
    const { manager } = spyManager({ kind: "not_found", reason: "No task found for \"beta\".", suggestion: "unused" })
    const service = createFakeTeamService({
      sendMessage: async () => ({ kind: "to_members", messageId: "msg-1", recipients: ["beta"] }),
    })

    const result = await runTaskSend(
      manager,
      { to: "beta", message: "please report" },
      "lead-session",
      { service, from: TEAM_LEAD_SENTINEL, resolveDefaultTeamRunId: async () => ({ kind: "resolved", teamRunId: "run-1" }) },
    )

    expect(result.details.kind).toBe("team_message")
    expect(service.calls[0]).toMatchObject({ method: "sendMessage", args: ["run-1", { to: "beta" }] })
  })

  test("#given no team_run_id and an ambiguous default resolver #when child lookup misses #then it reports the owned runs without service calls", async () => {
    const { manager } = spyManager({ kind: "not_found", reason: "No task found for \"beta\".", suggestion: "unused" })
    const service = createFakeTeamService({
      sendMessage: async () => ({ kind: "to_members", messageId: "unused", recipients: [] }),
    })

    const result = await runTaskSend(
      manager,
      { to: "beta", message: "please report" },
      "lead-session",
      {
        service,
        from: TEAM_LEAD_SENTINEL,
        resolveDefaultTeamRunId: async () => ({
          kind: "ambiguous",
          reason: "Multiple active teams: run-1 ('alpha-team'), run-2 ('beta-team'). Pass team_run_id.",
        }),
      },
    )

    expect(result.details.kind).toBe("invalid_arguments")
    if (result.details.kind !== "invalid_arguments") throw new Error("expected invalid_arguments")
    expect(result.details.reason).toContain("run-1")
    expect(result.details.reason).toContain("run-2")
    expect(service.calls).toEqual([])
  })

  test("#given no team_run_id and a default resolver reporting no owned team #when child lookup misses #then it falls back to the known-tasks not-found", async () => {
    const { manager } = spyManager({ kind: "not_found", reason: "No task found for \"beta\".", suggestion: "unused" })
    const service = createFakeTeamService({
      sendMessage: async () => ({ kind: "to_members", messageId: "unused", recipients: [] }),
    })

    const result = await runTaskSend(
      manager,
      { to: "beta", message: "please report" },
      "lead-session",
      { service, from: TEAM_LEAD_SENTINEL, resolveDefaultTeamRunId: async () => ({ kind: "none" }) },
    )

    expect(result.details.kind).toBe("not_found")
    expect(service.calls).toEqual([])
  })

  test("#given a shutdown_request without team_run_id and a resolver with one owned team #when routed #then requestShutdown uses the resolved team", async () => {
    const { manager } = spyManager({ kind: "not_found", reason: "unused", suggestion: "unused" })
    const service = createFakeTeamService({ requestShutdown: async () => fakeRuntimeState() })

    const result = await runTaskSend(
      manager,
      { to: "alpha", message: { type: "shutdown_request" } },
      "lead-session",
      { service, from: TEAM_LEAD_SENTINEL, resolveDefaultTeamRunId: async () => ({ kind: "resolved", teamRunId: "run-1" }) },
    )

    expect(result.details.kind).toBe("shutdown_requested")
    expect(service.calls[0]).toMatchObject({ method: "requestShutdown", args: ["run-1", "alpha"] })
  })

  test("#given the member-scoped factory #when created #then it exposes the shared task_send surface", () => {
    const { manager } = spyManager({ kind: "not_found", reason: "No task found for \"lead\".", suggestion: "unused" })
    const service = createFakeTeamService({
      sendMessage: async () => ({ kind: "to_lead", messageId: "msg-2" }),
    })
    const tool = createMemberScopedTaskSendTool({
      manager,
      service,
      teamRunId: "bound-run",
      from: "alpha",
      resolveCallerSessionId: () => "member-session",
    })

    expect(tool.name).toBe("task_send")
    expect(Object.keys(tool.parameters.properties)).toContain("to")
    expect(Object.keys(tool.parameters.properties)).not.toContain("deliver_as")
    expect(tool.description).toContain("always steer")
    expect(tool.description).not.toContain("followUp")
  })

  test("#given member routing with a bound run id #when params include another run id #then the bound run id wins", async () => {
    const { manager } = spyManager({ kind: "not_found", reason: "No task found for \"lead\".", suggestion: "unused" })
    const service = createFakeTeamService({
      sendMessage: async () => ({ kind: "to_lead", messageId: "msg-2" }),
    })

    await runTaskSend(manager, { to: "lead", message: "done", team_run_id: "wrong-run" }, "member-session", {
      service,
      from: "alpha",
      teamRunId: "bound-run",
    })

    expect(service.calls[0]).toMatchObject({
      method: "sendMessage",
      args: ["bound-run", { from: "alpha", to: "lead", body: "done" }],
    })
  })

  test("#given a member-scoped peer send #when the recipient is running #then the steering engine delivers as steer", async () => {
    const { manager, inProcess } = makeManager()
    const started = await manager.start(baseSpec({ parent_session_id: "member-session", name: "lead" }))
    if (started.kind !== "started") throw new Error("expected started")

    const result = await runTaskSend(
      manager,
      { to: "lead", message: "peer update" },
      "member-session",
      { service: createFakeTeamService(), from: "alpha", teamRunId: "bound-run" },
    )

    expect(result.details).toMatchObject({ kind: "steered", delivered: "steer" })
    const handle = inProcess.handles.get(started.task_id)
    if (handle === undefined) throw new Error("expected member handle")
    expect(handle.steerCalls).toEqual(["peer update"])
    expect(handle.followUpCalls).toEqual([])
  })

  test("#given a lead send with team_run_id #when the recipient is running #then the steering engine delivers as steer", async () => {
    const { manager, inProcess } = makeManager()
    const started = await manager.start(baseSpec({ parent_session_id: "lead-session", name: "beta" }))
    if (started.kind !== "started") throw new Error("expected started")

    const result = await runTaskSend(
      manager,
      { to: "beta", message: "lead update", team_run_id: "run-1" },
      "lead-session",
      { service: createFakeTeamService(), from: TEAM_LEAD_SENTINEL },
    )

    expect(result.details).toMatchObject({ kind: "steered", delivered: "steer" })
    const handle = inProcess.handles.get(started.task_id)
    if (handle === undefined) throw new Error("expected member handle")
    expect(handle.steerCalls).toEqual(["lead update"])
    expect(handle.followUpCalls).toEqual([])
  })

  test("#given a team shutdown message #when lead routing sends it #then no delivery option is needed", async () => {
    const { manager } = spyManager({ kind: "not_found", reason: "unused", suggestion: "unused" })
    const service = createFakeTeamService({ requestShutdown: async () => fakeRuntimeState() })

    const result = await runTaskSend(
      manager,
      { to: "beta", message: { type: "shutdown_request" }, team_run_id: "run-1" },
      "lead-session",
      { service, from: TEAM_LEAD_SENTINEL },
    )

    expect(result.details).toMatchObject({ kind: "shutdown_requested", team_run_id: "run-1", member: "beta" })
    expect(service.calls[0]).toMatchObject({ method: "requestShutdown", args: ["run-1", "beta"] })
  })
})
