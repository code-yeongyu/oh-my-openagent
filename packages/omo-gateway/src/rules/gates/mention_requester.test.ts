import { describe, expect, it } from "bun:test"
import { gate } from "./mention_requester"
import { intentOf, post, repairedText } from "./testing"

describe("mention_requester gate", () => {
  it("#given a question that mentions the requester #when run #then it passes", async () => {
    expect(await gate.run(intentOf("question", [post("<@U000ALICE> ship now or wait?")]), {}, { requester: "U000ALICE" })).toEqual({ ok: true })
  })

  it("#given a header with a bold name instead of a mention #when run #then the mention is added", async () => {
    const result = await gate.run(intentOf("header", [post("*alice*: fix login")]), {}, { requester: "U000ALICE" })
    expect(repairedText(result)).toBe("<@U000ALICE>: *alice*: fix login")
  })

  it("#given no known requester #when a question is sent #then it is refused", async () => {
    expect(await gate.run(intentOf("question", [post("ship?")]), {}, {})).toHaveProperty("refuse")
  })

  it("#given a plain reply #when run #then it passes untouched", async () => {
    expect(await gate.run(intentOf("reply", [post("done")]), {}, {})).toEqual({ ok: true })
  })
})
