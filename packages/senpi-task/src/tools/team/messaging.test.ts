import { describe, expect, test } from "bun:test"

import { TEAM_LEAD_SENTINEL } from "../../team"
import { createFakeTeamService } from "./__fixtures__/team-tool-fakes"
import {
  createMemberScopedSendMessageTool,
  createTeamSendMessageTool,
  runTeamSend,
} from "./messaging"

class NamedError extends Error {
  constructor(name: string, message: string) {
    super(message)
    this.name = name
  }
}

describe("team_send_message (lead)", () => {
  test("#given a message to the lead #when it wakes the parent #then it reports to_lead wake", async () => {
    // given
    const service = createFakeTeamService({
      sendMessage: async () => ({ kind: "to_lead", messageId: "m1", lead: { kind: "delivered", decision: "wake" } }),
    })

    // when
    const result = await runTeamSend(service, "run-1", TEAM_LEAD_SENTINEL, { to: "lead", body: "hi" })

    // then
    expect(result.details).toMatchObject({ kind: "to_lead", message_id: "m1", delivery: "wake" })
  })

  test("#given a lead-message enqueue that double-throws #when send runs #then the caller SEES a failed delivery", async () => {
    // given
    const service = createFakeTeamService({
      sendMessage: async () => ({ kind: "to_lead", messageId: "m1", lead: { kind: "failed" } }),
    })

    // when
    const result = await runTeamSend(service, "run-1", "alpha", { to: "lead", body: "done" })

    // then
    expect(result.details).toMatchObject({ kind: "to_lead", delivery: "failed" })
  })

  test("#given a member-direction message #when delivered #then it reports each member outcome", async () => {
    const service = createFakeTeamService({
      sendMessage: async () => ({
        kind: "to_members",
        messageId: "m2",
        deliveries: [{ kind: "steered", member: "beta", messageId: "m2" }],
      }),
    })
    const result = await runTeamSend(service, "run-1", TEAM_LEAD_SENTINEL, { to: "beta", body: "go" })
    expect(result.details).toMatchObject({ kind: "to_members", message_id: "m2" })
    if (result.details.kind !== "to_members") throw new Error("expected to_members")
    expect(result.details.deliveries[0]).toMatchObject({ member: "beta", outcome: "steered" })
  })

  test("#given a recipient backpressure error #when send runs #then it surfaces recipient_backpressure", async () => {
    const service = createFakeTeamService({
      sendMessage: async () => {
        throw new NamedError("RecipientBackpressureError", "recipient inbox full (backpressure)")
      },
    })
    const result = await runTeamSend(service, "run-1", TEAM_LEAD_SENTINEL, { to: "beta", body: "x" })
    expect(result.details.kind).toBe("recipient_backpressure")
  })

  test("#given a non-lead broadcast #when send runs #then it surfaces broadcast_denied", async () => {
    const service = createFakeTeamService({
      sendMessage: async () => {
        throw new NamedError("BroadcastNotPermittedError", "broadcast requires lead role")
      },
    })
    const result = await runTeamSend(service, "run-1", "alpha", { to: "*", body: "x" })
    expect(result.details.kind).toBe("broadcast_denied")
  })

  test("#given the lead factory #when built #then it is named team_send_message and binds from=lead", async () => {
    const service = createFakeTeamService({
      sendMessage: async () => ({ kind: "to_members", messageId: "m", deliveries: [] }),
    })
    const tool = createTeamSendMessageTool({ service })
    expect(tool.name).toBe("team_send_message")
    await tool.execute("call", { team_run_id: "run-9", to: "beta", body: "b" }, undefined, undefined, {} as never)
    expect(service.calls[0]).toMatchObject({ method: "sendMessage", args: ["run-9", { from: TEAM_LEAD_SENTINEL, to: "beta" }] })
  })
})

describe("member-scoped team_send_message", () => {
  test("#given a member tool #when the member sends #then from is closure-bound and cannot be spoofed", async () => {
    // given
    const service = createFakeTeamService({
      sendMessage: async () => ({ kind: "to_lead", messageId: "m", lead: { kind: "delivered", decision: "wake" } }),
    })
    const tool = createMemberScopedSendMessageTool({ service, teamRunId: "run-2", from: "alpha" })

    // when: params carry NO from/team_run_id; the closure supplies both
    await tool.execute("call", { to: "lead", body: "report" }, undefined, undefined, {} as never)

    // then
    expect(tool.name).toBe("team_send_message")
    expect(service.calls[0]).toMatchObject({ method: "sendMessage", args: ["run-2", { from: "alpha", to: "lead", body: "report" }] })
  })

  test("#given a member targeting a non-member #when send runs #then it surfaces invalid_recipient", async () => {
    const service = createFakeTeamService({
      sendMessage: async () => {
        throw new NamedError("InvalidRecipientError", "unknown or inactive team recipient: ghost")
      },
    })
    const result = await runTeamSend(service, "run-2", "alpha", { to: "ghost", body: "x" })
    expect(result.details).toMatchObject({ kind: "invalid_recipient", to: "ghost" })
  })
})
