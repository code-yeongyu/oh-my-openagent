import { describe, expect, test } from "bun:test"

import { teamMessageEnqueues } from "./team-e2e-analysis.mjs"

describe("teamMessageEnqueues", () => {
  test("#given member and lead delivery results #when injection sends are analyzed #then only lead-to-member mail is returned", () => {
    // given
    const sends = [
      { details: { kind: "team_message", team: { kind: "to_members", message_id: "m1", recipients: ["quick"] } } },
      { details: { kind: "team_message", team: { kind: "to_lead", message_id: "m2" } } },
      { details: { kind: "other" } },
    ]

    // when
    const enqueues = teamMessageEnqueues(sends)

    // then
    expect(enqueues).toEqual([{ messageId: "m1", recipients: ["quick"] }])
  })
})
