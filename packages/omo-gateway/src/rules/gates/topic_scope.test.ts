import { describe, expect, it } from "bun:test"
import { gate } from "./topic_scope"
import { reply } from "./testing"

const params = { deny: ["Othercorp"], redirect: "the owner in a private message" }

describe("topic_scope gate", () => {
  it("#given a denied term #when the text avoids it (even as a substring) #then it passes", async () => {
    expect(await gate.run(reply("Othercorporate is not a word we deny; the release is out."), params, {})).toEqual({ ok: true })
  })

  it("#given a denied term #when the text names it in another case #then it is refused with the redirect", async () => {
    expect(await gate.run(reply("Status of the OTHERCORP contract?"), params, {})).toEqual({
      refuse: "'Othercorp' is outside this scope's topics; take it to the owner in a private message",
    })
  })
})
