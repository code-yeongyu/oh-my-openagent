import { describe, expect, it } from "bun:test"
import { gate, nagIntervalMs, nextNagAt } from "./decision_nag"
import { HEADER_ID, intentOf, post, repaired, repairedText, THREAD } from "./testing"

const MIN = 60_000

describe("decision_nag gate", () => {
  it("#given every 30m #when re-pings go unanswered #then the wait doubles and caps at 4h", () => {
    expect([0, 1, 2, 3, 4, 5].map((pings) => nagIntervalMs({ every: "30m" }, pings) / MIN)).toEqual([30, 60, 120, 240, 240, 240])
    expect(nextNagAt({}, 1_000, 0)).toBe(1_000 + 30 * MIN)
  })

  it("#given a question that already mentions the person asked, no header #when run #then it passes", async () => {
    expect(await gate.run(intentOf("question", [post("<@U000OWNER> A or B?")]), { every: "30m" }, { decision: { ask: "U000OWNER" } })).toEqual({ ok: true })
  })

  it("#given a question without the mention #when run #then it mentions the person and sets the waiting reaction", async () => {
    const ctx = { decision: { ask: "U000OWNER" }, work_item: { header_message_id: HEADER_ID } }
    const result = await gate.run(intentOf("question", [post("A or B?")]), { every: "30m" }, ctx)
    expect(repairedText(result)).toBe("<@U000OWNER> A or B?")
    expect(repaired(result).ops.at(-1)).toEqual({ op: "react", key: THREAD, message_id: HEADER_ID, name: "waiting" })
  })

  it("#given a malformed interval #when run #then it throws a params error (the pipeline refuses)", () => {
    expect(() => gate.run(intentOf("question", [post("?")]), { every: "soon" }, { decision: { ask: "U1" } })).toThrow("duration")
  })
})
