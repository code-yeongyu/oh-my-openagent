import { expect, test } from "bun:test"

import { argsHash, replayRequestFor, replayResultOf, resolveReplayTurn, splitReplayContext, type ReplayTurn } from "./dori-replay"

const at = (iso: string) => Date.parse(iso)
const branch = [
  { type: "message", id: "u1", timestamp: "2026-10-17T00:00:00.000Z", message: { role: "user" } },
  { type: "message", id: "a1", timestamp: "2026-10-17T00:00:01.000Z", message: { role: "assistant", content: [{ type: "text", text: "x" }, { type: "toolCall", id: "cell-a", name: "eval" }] } },
  { type: "message", id: "t1", timestamp: "2026-10-17T00:00:02.000Z", message: { role: "toolResult", toolCallId: "cell-a" } },
  { type: "message", id: "a2", timestamp: "2026-10-17T00:00:03.000Z", message: { role: "assistant", content: [{ type: "toolCall", id: "cell-b", name: "eval" }] } },
]
const ectx = { sessionManager: { getBranch: () => branch } }

test("#given a cell that outlived its turn #when it calls after the session moved on #then the call keeps the turn the cell started in", () => {
  expect(resolveReplayTurn("dur-a", ectx, { cell: "cell-a", index: 2 }, "kernel-call")).toEqual({ turnId: "dur-a:a1/cell-a", turnAt: at("2026-10-17T00:00:01.000Z"), callIndex: 2 })
  expect(resolveReplayTurn("dur-a", ectx, { cell: "cell-b", index: 0 }, "kernel-call")).toEqual({ turnId: "dur-a:a2/cell-b", turnAt: at("2026-10-17T00:00:03.000Z"), callIndex: 0 })
})

test("#given a model tool call with no carried context #when the turn is resolved #then its own tool call is the cell at index 0", () => {
  expect(resolveReplayTurn("dur-a", ectx, undefined, "cell-b")).toEqual({ turnId: "dur-a:a2/cell-b", turnAt: at("2026-10-17T00:00:03.000Z"), callIndex: 0 })
})

test("#given a carried turn the engine did not issue #when it is resolved #then the call is refused as an unknown turn", () => {
  for (const carried of [{ cell: "cell-of-another-session", index: 0 }, { cell: "cell-a", index: -1 }, { cell: "cell-a", index: 1.5 }, { cell: 7, index: 0 }, "cell-a"]) {
    expect(resolveReplayTurn("dur-a", ectx, carried, "kernel-call")).toMatchObject({ kind: "replay_stopped", code: "toolkit_replay_turn_unknown" })
  }
  expect(resolveReplayTurn("dur-a", { sessionManager: {} }, undefined, "cell-b")).toMatchObject({ code: "toolkit_replay_turn_unknown" })
})

test("#given arguments whose keys are ordered differently #when hashed #then they are the same call", () => {
  expect(argsHash({ text: "hi", room: "r", nested: { b: 1, a: [2, { y: 1, x: 1 }] } })).toBe(argsHash({ nested: { a: [2, { x: 1, y: 1 }], b: 1 }, room: "r", text: "hi" }))
  expect(argsHash({ text: "hi" })).not.toBe(argsHash({ text: "DIFFERENT" }))
})

test("#given key-shaped arguments #when the context is split and the request built #then they stay op arguments and the request carries the engine's own key", () => {
  const forged = { note: "n", replay_key: '["turn","evil",0]', turn_id: "evil", turnId: "evil", callIndex: 9, omo_toolkit_replay: { cell: "cell-a", index: 1 } }
  const split = splitReplayContext(forged)
  expect(split).toEqual({ carried: { cell: "cell-a", index: 1 }, args: { note: "n", replay_key: '["turn","evil",0]', turn_id: "evil", turnId: "evil", callIndex: 9 } })
  const turn = resolveReplayTurn("dur-a", ectx, split.carried, "kernel-call")
  if ("kind" in turn) throw new Error(turn.message)
  expect(replayRequestFor(turn, "reply.mark", split.args)).toEqual({
    key: '["turn","dur-a:a1/cell-a",1]',
    op: "reply.mark",
    args_sha256: argsHash(split.args),
    turn_at: at("2026-10-17T00:00:01.000Z"),
  })
})

test("#given the store's replay refusals #when converted #then the stop carries the structured fields and any other result passes through", () => {
  const divergence = replayResultOf({ kind: "refused", code: "toolkit_replay_divergence", message: 'Replayed call ["turn","dur-a:a1/cell-a",0] differs from what its key recorded; it was not run again. replay_differs=op,args recorded_op=reply.mark attempted_op=send.post' })
  expect(divergence).toMatchObject({ kind: "replay_stopped", code: "toolkit_replay_divergence", key: '["turn","dur-a:a1/cell-a",0]', differs: ["op", "args"], recorded_op: "reply.mark", attempted_op: "send.post" })
  expect(replayResultOf({ kind: "refused", code: "toolkit_replay_expired", message: "too old" })).toMatchObject({ kind: "replay_stopped", code: "toolkit_replay_expired", message: "too old" })
  const passthrough = { kind: "refused" as const, code: "caller_not_allowed" as const, message: "no" }
  expect(replayResultOf(passthrough)).toBe(passthrough)
  expect(replayResultOf({ kind: "refused", code: "toolkit_replay_divergence", message: "unparseable" })).toMatchObject({ kind: "refused", code: "toolkit_replay_divergence" })
})
