import { describe, expect, test } from "bun:test"

import { buildPeerMessageEnvelope, buildTeamMessage } from "./message"

describe("buildTeamMessage", () => {
  test("#given from/to/body #when built #then a well-formed message-kind Message is produced", () => {
    // given
    const now = () => 1_700_000_000_000
    const newMessageId = () => "11111111-1111-4111-8111-111111111111"

    // when
    const message = buildTeamMessage({ from: "alpha", to: "beta", body: "ping" }, { now, newMessageId })

    // then
    expect(message).toEqual({
      version: 1,
      messageId: "11111111-1111-4111-8111-111111111111",
      from: "alpha",
      to: "beta",
      kind: "message",
      body: "ping",
      timestamp: 1_700_000_000_000,
    })
  })

  test("#given a summary #when built #then the summary is carried and a broadcast target is preserved", () => {
    // given / when
    const message = buildTeamMessage(
      { from: "alpha", to: "*", body: "hi", summary: "greeting" },
      { now: () => 1, newMessageId: () => "22222222-2222-4222-8222-222222222222" },
    )

    // then
    expect(message.summary).toBe("greeting")
    expect(message.to).toBe("*")
  })
})

describe("buildPeerMessageEnvelope", () => {
  test("#given a message with markup-bearing fields #when the envelope is built #then attributes are escaped in team-core's order", () => {
    // given
    const message = buildTeamMessage(
      { from: "al<pha", to: "beta", body: "body & <content>" },
      { now: () => 42, newMessageId: () => "33333333-3333-4333-8333-333333333333" },
    )

    // when
    const envelope = buildPeerMessageEnvelope(message)

    // then
    expect(envelope).toBe(
      `<peer_message from="al&lt;pha" timestamp="42" messageId="33333333-3333-4333-8333-333333333333" kind="message" correlationId="">
body & <content>
</peer_message>`,
    )
  })

  test("#given a summary #when the envelope is built #then the summary attribute is appended", () => {
    // given
    const message = buildTeamMessage(
      { from: "alpha", to: "beta", body: "b", summary: "the-summary" },
      { now: () => 7, newMessageId: () => "44444444-4444-4444-8444-444444444444" },
    )

    // when
    const envelope = buildPeerMessageEnvelope(message)

    // then
    expect(envelope).toContain(`summary="the-summary"`)
  })
})
