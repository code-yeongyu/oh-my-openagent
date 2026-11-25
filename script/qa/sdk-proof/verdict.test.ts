import { describe, expect, test } from "bun:test"

import { cellOf } from "./cell.ts"
import { ackOf, type Expect } from "./scenario.ts"
import { type BState, verdictOf } from "./world/verdict.ts"

// Negative controls of the X1a proof: every expectation a step can have on device B, and every rule that makes a cell,
// shown going red on the state or answer that must not pass, beside the one that must.

const idle = (messages: BState["messages"], extra: Partial<BState> = {}): BState => ({
  listed: true,
  streaming: false,
  messages,
  held: [],
  ...extra,
})
const user = (text: string) => ({ role: "user", text })
const delivered = (text: string) => ({ role: "custom", text: `From device A [OMO_GATEWAY ...]\n${text}` })
const assistant = (text: string, stopReason = "stop") => ({ role: "assistant", text, stopReason })
const TOKEN = "QA-TOKEN-x1a-t"

type Case = readonly [string, Expect, BState, unknown]
const passing: readonly Case[] = [
  ["exchange, typed", { kind: "exchange", token: TOKEN }, idle([user(TOKEN), assistant(ackOf(TOKEN))]), {}],
  ["exchange, delivered", { kind: "exchange", token: TOKEN }, idle([delivered(TOKEN), assistant(ackOf(TOKEN))]), {}],
  ["answered", { kind: "answered", token: TOKEN }, idle([]), { items: [ackOf(TOKEN)] }],
  ["holding", { kind: "holding", tag: "t" }, idle([], { streaming: true, held: ["t"] }), {}],
  [
    "steered",
    { kind: "steered", tag: "t", token: TOKEN },
    idle([assistant("QA-STREAMING t QA-RELEASED t"), user(TOKEN), assistant(ackOf(TOKEN))]),
    {},
  ],
  ["interrupted", { kind: "interrupted", tag: "t" }, idle([assistant("QA-STREAMING t", "aborted")]), {}],
  [
    "model",
    { kind: "model", provider: "p", id: "m", thinking: "high" },
    idle([], { model: "p/m", thinking: "high" }),
    {},
  ],
  [
    "parked",
    { kind: "parked", provider: "p", id: "m", thinking: "high" },
    idle([], { model: "p/old", pending: { provider: "p", id: "m" } }),
    { kind: "ok", model_switch: "after_compaction" },
  ],
  ["closed", { kind: "closed" }, idle([], { listed: false }), {}],
  [
    "applied after compaction, at its previous level",
    { kind: "applied", token: TOKEN, provider: "p", id: "m" },
    idle([user(TOKEN), assistant(ackOf(TOKEN))], { model: "p/m", thinking: "medium" }),
    {},
  ],
  [
    "level set once landed",
    { kind: "level", provider: "p", id: "m", thinking: "high" },
    idle([], { model: "p/m", thinking: "high" }),
    {},
  ],
]
const failing: readonly Case[] = [
  ["exchange without the answer", { kind: "exchange", token: TOKEN }, idle([user(TOKEN)]), {}],
  [
    "exchange still streaming",
    { kind: "exchange", token: TOKEN },
    idle([user(TOKEN), assistant(ackOf(TOKEN))], { streaming: true }),
    {},
  ],
  ["answered without the token", { kind: "answered", token: TOKEN }, idle([]), { items: [] }],
  ["holding a released turn", { kind: "holding", tag: "t" }, idle([], { streaming: false, held: ["t"] }), {}],
  [
    "steered never released",
    { kind: "steered", tag: "t", token: TOKEN },
    idle([user(TOKEN), assistant(ackOf(TOKEN))]),
    {},
  ],
  ["interrupted but finished", { kind: "interrupted", tag: "t" }, idle([assistant("QA-RELEASED t")]), {}],
  [
    "model left pending",
    { kind: "model", provider: "p", id: "m", thinking: "high" },
    idle([], { model: "p/old", pending: { provider: "p", id: "m" } }),
    {},
  ],
  [
    "parked answered as a partial commit",
    { kind: "parked", provider: "p", id: "m", thinking: "high" },
    idle([], { model: "p/old", pending: { provider: "p", id: "m" } }),
    { kind: "error", error: { code: "partial_commit" } },
  ],
  [
    "parked with nothing pending",
    { kind: "parked", provider: "p", id: "m", thinking: "high" },
    idle([], { model: "p/m" }),
    { model_switch: "after_compaction" },
  ],
  ["closed but still listed", { kind: "closed" }, idle([]), {}],
  [
    "applied but the old model still runs",
    { kind: "applied", token: TOKEN, provider: "p", id: "m" },
    idle([user(TOKEN), assistant(ackOf(TOKEN))], { model: "p/old" }),
    {},
  ],
  [
    "level still the previous one",
    { kind: "level", provider: "p", id: "m", thinking: "high" },
    idle([], { model: "p/m", thinking: "medium" }),
    {},
  ],
]

describe("a step's verdict on device B", () => {
  test("#given no thread adopted on B #when a close is judged #then the absence proves nothing", () => {
    expect(verdictOf({ kind: "closed" }, idle([], { listed: false }), {}, false)).toEqual(expect.any(String))
  })

  test.each(passing)("#given %s #when judged #then it holds", (_name, expected, state, raw) => {
    expect(verdictOf(expected, state, raw)).toBeUndefined()
  })
  test.each(failing)("#given %s #when judged #then it is refused with a reason", (_name, expected, state, raw) => {
    expect(verdictOf(expected, state, raw)).toEqual(expect.any(String))
  })
})

describe("a step's cell", () => {
  const ok = { answered: true, raw: { kind: "ok" } }
  const refused = (code: string) => ({ answered: false, raw: { kind: "error", error: { code } } })

  test("#given a success and B in the expected state #when celled #then it passes", () => {
    expect(cellOf(ok, undefined).cell).toBe("pass")
  })
  test("#given a success but B not in the expected state #when celled #then it fails with B's reason", () => {
    expect(cellOf(ok, "B lacks it")).toEqual({ cell: "fail", why: "B lacks it" })
  })
  test("#given an error answer #when celled #then it fails even when B happens to show the state", () => {
    expect(cellOf(refused("host_unavailable"), undefined)).toEqual({
      cell: "fail",
      why: "the surface answered error host_unavailable",
    })
  })
  test("#given the contract's refusal for this principal #when celled #then the refusal passes", () => {
    expect(cellOf(refused("invalid_arguments"), "B was not steered", "invalid_arguments").cell).toBe("pass")
  })
  test("#given a success where the contract refuses this principal #when celled #then it fails", () => {
    expect(cellOf(ok, undefined, "invalid_arguments").cell).toBe("fail")
  })
  test("#given another refusal where the contract names one #when celled #then it fails", () => {
    expect(cellOf(refused("host_unavailable"), undefined, "invalid_arguments").cell).toBe("fail")
  })
})
