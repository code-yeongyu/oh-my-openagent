import { afterEach, describe, expect, test } from "bun:test"
import { UNKNOWN_CALLER } from "./tools"
import { ENGINE, comparable, createRemoteThreadFixture } from "./thread-remote-fixture"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

describe("authoritative prompt admission", () => {
  test("#given b was busy at preflight but starts this input #when admission names its turn #then the send and its retry are confirmed", async () => {
    const a = account({ engine: { ...ENGINE, streaming: true }, promptResponse: { disposition: "started", turnId: "2" } })
    const { run } = surface(a.remote)
    const input = { thread: "dur-on-b", message: "once", idempotency_key: "admitted-turn" }
    expect(await run("thread_send", input)).toMatchObject({ kind: "ok", delivery: { kind: "started", turn_id: "2" }, deduplicated: false })
    expect(await run("thread_send", input)).toMatchObject({ kind: "ok", delivery: { kind: "started", turn_id: "2" }, deduplicated: true })
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "prompt")).toHaveLength(1)
  })

  test.each([
    ["absent", { disposition: "started" }],
    ["empty", { disposition: "started", turnId: "" }],
    ["not started", { disposition: "handled", turnId: "2" }],
  ] as const)("#given an %s authoritative admission identity #when sent and retried #then the existing uncertain result is preserved", async (_name, promptResponse) => {
    const a = account({ promptResponse })
    const { run } = surface(a.remote)
    const input = { thread: "dur-on-b", message: "once", idempotency_key: "uncertain-turn" }
    expect(await run("thread_send", input)).toMatchObject({ kind: "error", error: { code: "idempotency_uncertain" } })
    expect(await run("thread_send", input)).toMatchObject({ kind: "error", error: { code: "idempotency_uncertain" } })
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "prompt")).toHaveLength(1)
  })
})

describe("SC-R8: from this device on another (create, list, open, status, prompt, abort, fork)", () => {

  test("#given a running thread on b #when thread_read, thread_send and thread_interrupt name it #then messages, state, prompt and interrupt reach b's session", async () => {
    const a = account({ engine: { ...ENGINE, messages: [{ role: "user", content: "hi b" }, { role: "assistant", content: "hello from b" }], interrupt: { turnId: "turn-b", interrupted: true } } })
    const { run } = surface(a.remote)
    expect(await run("thread_read", { thread: "dur-on-b" })).toMatchObject({ kind: "ok", device: "b", items: [{ role: "user", content: JSON.stringify("hi b") }, { role: "assistant", content: JSON.stringify("hello from b") }] })
    expect(await run("thread_send", { thread: "dur-on-b", message: "do the thing" })).toMatchObject({ kind: "ok", thread_id: "dur-on-b", device: "b", delivery: { kind: "started", turn_id: "turn-b" } })
    expect(await run("thread_interrupt", { thread: "dur-on-b" })).toMatchObject({ kind: "ok", thread_id: "dur-on-b", turn_id: "turn-b", interrupted: true })
    expect(a.sent.map((entry) => [entry.via, entry.rpc?.["type"]])).toEqual([["session", "get_messages"], ["session", "get_state"], ["session", "prompt"], ["session", "interrupt"]])
  })

  test.each([
    ["capability_missing", "scope_denied"],
    ["host_detached", "host_unavailable"],
  ])("#given b refuses with %s #when a command reaches it #then the tool answers %s, as data, with the device named", async (reason, code) => {
    const a = account({ refuse: reason })
    const { run } = surface(a.remote)
    expect(await run("thread_send", { thread: "dur-on-b", message: "x" })).toMatchObject({ kind: "error", error: { code, details: { device: "b", reason } } })
  })
})

describe("K8 / R8.c: a chain carries its count across devices; no count or cost limit by default", () => {
  test("#given a caller with no cause and then one running on a hop-1 delivery #when it sends to b #then the wire gets hop 1 and then hop 2, with no cost field", async () => {
    const a = account()
    let cause: string | undefined
    const { run } = surface(a.remote, { callerCause: () => cause })
    await run("thread_send", { thread: "dur-on-b", message: "start of a chain" })
    const local = await run("thread_send", { thread: "dur-local", message: "a hop-1 delivery" })
    if (local.kind !== "ok" || !("delivery_id" in local) || local.delivery_id === undefined) throw new Error(`local send failed: ${JSON.stringify(local)}`)
    cause = local.delivery_id
    await run("thread_send", { thread: "dur-on-b", message: "continues the chain" })
    expect(a.hops).toEqual([1, 2])
    const prompts = a.sent.filter((entry) => entry.rpc?.["type"] === "prompt").map((entry) => entry.rpc ?? {})
    expect(prompts.map((record) => [record["chain_count"], Object.keys(record).some((key) => /cost/i.test(key))])).toEqual([[1, false], [2, false]])
  })
})

describe("remote == local: the same call answers the same on b as on this device", () => {

  test("#given a send to b #when the same idempotency_key is used twice #then b gets one prompt and the retry replays the first answer as deduplicated", async () => {
    const a = account()
    const { run } = surface(a.remote)
    const first = await run("thread_send", { thread: "dur-on-b", message: "once", idempotency_key: "k1" })
    const again = await run("thread_send", { thread: "dur-on-b", message: "once", idempotency_key: "k1" })
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "prompt")).toHaveLength(1)
    expect(first).toMatchObject({ kind: "ok", deduplicated: false })
    expect(again).toMatchObject({ kind: "ok", deduplicated: true, delivery: (first as { delivery: unknown }).delivery })
  })

  test("#given b is busy with 3 pending messages #when a message is sent #then it is queued at the position b reports and no gateway sequence is invented", async () => {
    const a = account({ engine: { ...ENGINE, streaming: true, pending: 3 } })
    const { run } = surface(a.remote)
    const sent = await run("thread_send", { thread: "dur-on-b", message: "later" })
    expect(sent).toMatchObject({ kind: "ok", delivery: { kind: "queued", queue_position: 3 } })
    expect("message_seq" in sent).toBe(false)
  })
})

describe("remote == local, round 2: send modes, handoff, list and alias order", () => {
  test.each([
    ["a steer with no expected_turn_id", { delivery: "steer" }],
    ["a steer with a malformed expected_turn_id", { delivery: "steer", expected_turn_id: "abc" }],
  ] as const)("#given %s #when it is sent here and to b #then both refuse the same way at send time and b gets nothing", async (_label, args) => {
    const a = account()
    const { run } = surface(a.remote)
    const here = await run("thread_send", { thread: "dur-local", message: "x", ...args })
    const there = await run("thread_send", { thread: "dur-on-b", message: "x", ...args })
    expect(comparable(there)).toEqual(comparable(here))
    expect(here).toMatchObject({ kind: "error" })
    expect(a.sent).toEqual([])
  })

  test("#given b is idle #when a steer with an expected turn reaches it #then it is not_steerable, as a steer into an idle session is, and no prompt is sent", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_send", { thread: "dur-on-b", message: "x", delivery: "steer", expected_turn_id: "3" })).toMatchObject({ kind: "error", error: { code: "not_steerable" } })
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "prompt")).toEqual([])
  })

  test("#given b is mid-turn #when a steer with a well-formed expected turn reaches it #then it is refused turn_conflict because b's engine cannot confirm the turn yet, and no prompt is sent", async () => {
    const a = account({ engine: { ...ENGINE, streaming: true, pending: 0 } })
    const { run } = surface(a.remote)
    expect(await run("thread_send", { thread: "dur-on-b", message: "x", delivery: "steer", expected_turn_id: "3" })).toMatchObject({ kind: "error", error: { code: "turn_conflict", details: { device: "b", reason: "remote_turn_not_verifiable" } } })
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "prompt")).toEqual([])
  })

  test("#given a follow_up to b while it runs #when it is sent #then it is queued behind b's own pending count", async () => {
    const a = account({ engine: { ...ENGINE, streaming: true, pending: 2 } })
    const { run } = surface(a.remote)
    expect(await run("thread_send", { thread: "dur-on-b", message: "x", delivery: "follow_up" })).toMatchObject({ kind: "ok", delivery: { kind: "queued", queue_position: 2 } })
    expect(a.sent.find((entry) => entry.rpc?.["type"] === "prompt")?.rpc?.["streamingBehavior"]).toBe("followUp")
  })

  test("#given b's thread #when thread_handoff names it by id #then the message reaches b and the receipt names the thread, its device and how it was resolved", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_handoff", { thread: "dur-on-b", message: "take this" })).toMatchObject({ kind: "ok", resolved_by: "exact_name", thread: { thread_id: "dur-on-b", device: "b" }, delivery: { kind: "started" } })
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "prompt").map((entry) => entry.rpc?.["message"])).toEqual(["take this"])
  })

  test("#given a caller with no durable id #when it sends here and to b #then both refuse the same way at send time and b gets nothing", async () => {
    const a = account()
    const { run } = surface(a.remote, { caller: UNKNOWN_CALLER })
    const here = await run("thread_send", { thread: "dur-local", message: "x", idempotency_key: "k-here" })
    const there = await run("thread_send", { thread: "dur-on-b", message: "x", idempotency_key: "k-there" })
    expect(here).toMatchObject({ kind: "error", error: { code: "caller_context_missing" } })
    expect(comparable(there)).toEqual(comparable(here))
    // A refusal before any store write leaves no receipt, so a retry under the same key with other args refuses the same way.
    const hereAgain = await run("thread_send", { thread: "dur-local", message: "y", idempotency_key: "k-here" })
    const thereAgain = await run("thread_send", { thread: "dur-on-b", message: "y", idempotency_key: "k-there" })
    expect(hereAgain).toMatchObject({ kind: "error", error: { code: "caller_context_missing" } })
    expect(comparable(thereAgain)).toEqual(comparable(hereAgain))
    expect(a.sent.filter((entry) => entry.rpc?.["type"] === "prompt")).toEqual([])
  })
})
