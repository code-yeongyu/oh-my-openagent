import { describe, expect, test } from "bun:test"

import type { NotificationConfig, ParentState } from "../../completion"
import { deliverToLead } from "./deliver-lead"
import { buildTeamMessage } from "./message"
import { FakeLeadNotifier } from "./__fixtures__/messaging-fakes"

const CONFIG: NotificationConfig = { deliver_as: "followUp" }

function leadMessage() {
  return buildTeamMessage(
    { from: "alpha", to: "lead", body: "member alpha needs a decision", summary: "decision" },
    { now: () => 100, newMessageId: () => "55555555-5555-4555-8555-555555555555" },
  )
}

describe("deliverToLead", () => {
  test("#given an idle parent with wake enabled #when delivered #then the notifier gets a team-message payload with triggerTurn", () => {
    // given
    const notifier = new FakeLeadNotifier()

    // when
    const result = deliverToLead({
      message: leadMessage(),
      parentState: { kind: "idle" },
      notificationConfig: CONFIG,
      notifier,
    })

    // then
    expect(result).toEqual({ kind: "delivered", decision: "wake" })
    expect(notifier.enqueued).toHaveLength(1)
    expect(notifier.enqueued[0]).toEqual({
      customType: "senpi-task.team-message",
      content:
        `<peer_message from="alpha" timestamp="100" messageId="55555555-5555-4555-8555-555555555555" kind="message" correlationId="" summary="decision">
member alpha needs a decision
</peer_message>`,
      display: false,
      from: "alpha",
      messageId: "55555555-5555-4555-8555-555555555555",
      triggerTurn: true,
    })
  })

  test("#given a streaming parent #when delivered #then it carries the configured deliverAs and triggerTurn", () => {
    // given
    const notifier = new FakeLeadNotifier()

    // when
    const result = deliverToLead({
      message: leadMessage(),
      parentState: { kind: "streaming" },
      notificationConfig: { deliver_as: "steer" },
      notifier,
    })

    // then a streaming lead delivery both steers AND guarantees a turn
    expect(result).toEqual({ kind: "delivered", decision: "deliver_streaming" })
    expect(notifier.enqueued[0]?.deliverAs).toBe("steer")
    expect(notifier.enqueued[0]?.triggerTurn).toBe(true)
  })

  test.each<[ParentState["kind"], "compacting" | "session_switching" | "session_shutdown"]>([
    ["compacting", "compacting"],
    ["session_switching", "session_switching"],
    ["session_shutdown", "session_shutdown"],
  ])("#given a %s parent #when delivered #then it is buffered without enqueue", (kind, reason) => {
    // given
    const notifier = new FakeLeadNotifier()

    // when
    const result = deliverToLead({
      message: leadMessage(),
      parentState: { kind } as ParentState,
      notificationConfig: CONFIG,
      notifier,
    })

    // then
    expect(result).toEqual({ kind: "buffered", reason })
    expect(notifier.enqueued).toHaveLength(0)
  })

  test("#given enqueue throws once #when delivered #then a single retry lands the message", () => {
    // given
    const notifier = new FakeLeadNotifier("throw", 1)

    // when
    const result = deliverToLead({
      message: leadMessage(),
      parentState: { kind: "idle" },
      notificationConfig: CONFIG,
      notifier,
    })

    // then
    expect(result).toEqual({ kind: "delivered", decision: "wake" })
    expect(notifier.enqueued).toHaveLength(1)
  })

  test("#given enqueue always throws #when delivered #then the result is failed after one retry", () => {
    // given
    const notifier = new FakeLeadNotifier("throw")

    // when
    const result = deliverToLead({
      message: leadMessage(),
      parentState: { kind: "idle" },
      notificationConfig: CONFIG,
      notifier,
    })

    // then
    expect(result).toEqual({ kind: "failed" })
    expect(notifier.enqueued).toHaveLength(0)
  })
})
