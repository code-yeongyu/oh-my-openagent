import { describe, expect, test } from "bun:test"

import { TEAM_LEAD_SENTINEL } from "../../team"
import { createFakeTeamService } from "./__fixtures__/team-tool-fakes"
import { runTeamSend } from "./messaging"

class NamedError extends Error {
  constructor(name: string, message: string) {
    super(message)
    this.name = name
  }
}

describe("team messaging route", () => {
  test("#given a message to the lead #when it is enqueued #then it reports the lead inbox result", async () => {
    const service = createFakeTeamService({
      sendMessage: async () => ({ kind: "to_lead", messageId: "m1" }),
    })

    const result = await runTeamSend(service, "run-1", TEAM_LEAD_SENTINEL, { to: "lead", body: "hi" })

    expect(result.content).toEqual([{ type: "text", text: "Message enqueued to lead." }])
    expect(result.details).toEqual({ kind: "to_lead", message_id: "m1" })
  })

  test("#given a member-direction message #when enqueued #then it reports the recipient list", async () => {
    const service = createFakeTeamService({
      sendMessage: async () => ({
        kind: "to_members",
        messageId: "m2",
        recipients: ["beta"],
      }),
    })
    const result = await runTeamSend(service, "run-1", TEAM_LEAD_SENTINEL, { to: "beta", body: "go" })
    expect(result.content).toEqual([{ type: "text", text: "Message enqueued to 1 recipient(s)." }])
    expect(result.details).toEqual({ kind: "to_members", message_id: "m2", recipients: ["beta"] })
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
})

describe("member-routed team messaging", () => {
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
