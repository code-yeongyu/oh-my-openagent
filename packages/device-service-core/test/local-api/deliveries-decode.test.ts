import { describe, expect, test } from "bun:test"
import { validateEvent, validateRequest, validateResponse } from "../../src/local-api/validate.ts"

// omo#13037 delivery consumers on the local API v1, as relayd ships them (omo-relay-daemon #1076,
// packages/local-api/src/validate-deliveries.ts at 2728922e4b): each request, answer and event decodes in its exact
// shape, and a field the shape does not name, or a wrong type, is refused.

const PAIR = { sender_device: "dev-peer-1", session_id: "dur-1", last_command_id: "Y29tbWFuZC1pZC0wMDAwMQ" }
const response = (data: unknown) => ({ id: "r1", type: "response", ok: true, data })
const ok = (v: unknown): boolean => validateRequest(v).ok

describe("delivery consumer requests", () => {
  test.each([
    ["deliveries.serve", { agent_dir: "/agents/a", v: 1 }, { agent_dir: "agents/a", v: 1 }],
    ["delivery.answer", { sender_device: "dev-peer-1", command_id: "Y29tbWFuZC1pZC0wMDAwMQ", reply: { kind: "queued" } }, { sender_device: "dev-peer-1", command_id: "Y29tbWFuZC1pZC0wMDAwMQ", reply: "queued" }],
    ["delivery.held", { ask_id: "ask-1", holds: true }, { ask_id: "ask-1", holds: "yes" }],
    ["delivery.pending", { pairs: [PAIR] }, { pairs: [{ ...PAIR, extra: 1 }] }],
    ["delivery.drained", PAIR, { sender_device: "dev-peer-1", session_id: "dur-1" }],
    ["peer.admitted", { device: "dev-peer-1" }, { device: 7 }],
  ])("#given %s #when it is decoded #then its exact shape passes and a malformed one is refused", (type, good, bad) => {
    expect(ok({ id: "1", type, ...good })).toBe(true)
    expect(ok({ id: "1", type, ...good, surprise: 1 })).toBe(false)
    expect(ok({ id: "1", type, ...bad })).toBe(false)
  })
})

describe("delivery consumer answers", () => {
  test.each([
    ["deliveries.serve", { wake: true, newer: 1 }, { wake: true }, {}],
    ["delivery.answer", { newer: 1 }, {}, "x"],
    ["delivery.held", {}, {}, "x"],
    ["delivery.pending", {}, {}, "x"],
    ["delivery.drained", { kept: true, expecting: "Y29tbWFuZC1pZC0wMDAwMg" }, { kept: true, expecting: "Y29tbWFuZC1pZC0wMDAwMg" }, { kept: false, expecting: "Y29tbWFuZC1pZC0wMDAwMg" }],
    ["peer.admitted", { admitted: false }, { admitted: false }, { admitted: "no" }],
  ] as const)("#given the answer to %s #when it is decoded #then the data reads back without fields this version does not define, and a malformed one is a violation", (type, data, read, bad) => {
    expect(validateResponse(response(data), type)).toEqual({ id: "r1", ok: true, data: read })
    expect(() => validateResponse(response(bad), type)).toThrow()
  })

  test("#given a drained answer that keeps nothing #when it is decoded #then it is kept false with no command", () => {
    expect(validateResponse(response({ kept: false }), "delivery.drained")).toEqual({ id: "r1", ok: true, data: { kept: false } })
  })
})

describe("delivery consumer events", () => {
  test.each([
    [
      "delivery.inbound",
      { command_id: "Y29tbWFuZC1pZC0wMDAwMQ", sender_device: "dev-peer-1", durable_id: "dur-1", record: { type: "admit_external_message" } },
      { record: "not an object" },
    ],
    ["delivery.holds", { ask_id: "ask-1", durable_id: "dur-1" }, { durable_id: 5 }],
    ["delivery.wake", { enabled: true }, { enabled: "on" }],
  ])("#given the %s event #when it is decoded #then it reads back and a malformed one is refused", (kind, body, bad) => {
    const wire: unknown = { type: "event", kind, ...body }
    expect(validateEvent(wire)).toEqual(wire as never)
    const malformed: unknown = { type: "event", kind, ...body, ...bad }
    expect(() => validateEvent(malformed)).toThrow()
  })
})
