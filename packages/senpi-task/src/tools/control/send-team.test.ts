import { describe, expect, test } from "bun:test"

import { TEAM_LEAD_SENTINEL } from "../../team"
import type { SendInput, SendOutcome } from "../../steering"
import { createFakeTeamService } from "../team/__fixtures__/team-tool-fakes"
import { createMemberScopedTaskSendTool, runTaskSend } from "./send"
import type { SendManager } from "./types"

function spyManager(outcome: SendOutcome): { manager: SendManager; sendCalls: SendInput[] } {
  const sendCalls: SendInput[] = []
  return {
    manager: {
      sendToTask: (input) => {
        sendCalls.push(input)
        return Promise.resolve(outcome)
      },
      interruptTask: () => Promise.resolve({ kind: "not_found", reason: "unused" }),
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
})
