import { describe, expect, test } from "bun:test"
import { engineMethodClasses } from "./rpc-relay-parity"
import { type Answer, compareAnswers, describe as describeAnswer } from "./rpc-relay-parity-compare"
import { probeRecord } from "./rpc-relay-parity-probes"
import { type SweepLeg, sweepMethods, verdictLine } from "./rpc-relay-parity-sweep"

type Rec = Record<string, unknown>

// A fake engine host: answers every record with its own type and routing id, and a per-call timestamp.
const engineReply = (record: Rec, engineSession: string): Answer => ({
  kind: "reply",
  reply: {
    type: "response",
    id: record["id"],
    command: record["type"],
    success: true,
    data: { sessionId: record["sessionId"] === undefined ? null : engineSession, at: new Date().toISOString() },
  },
})

const LOCAL_SESSION = "engine-session-local"
const RELAY_SESSION = "engine-session-relay"
const LISTING_KEY = "listing-key-relay"

function fakeLegs(relayAnswer: (record: Rec, forwarded: Answer) => Answer = (_record, forwarded) => forwarded) {
  const sent: { local: Rec[]; relay: Rec[] } = { local: [], relay: [] }
  const local: SweepLeg = {
    context: { sessionId: LOCAL_SESSION },
    send: async (_route, record) => {
      sent.local.push(record)
      return engineReply(record, LOCAL_SESSION)
    },
  }
  // The fake relay maps the listing key to the engine's routing id, as the host does, and adds the delegated receipt.
  const relay: SweepLeg = {
    context: { sessionId: LISTING_KEY },
    send: async (_route, record) => {
      sent.relay.push(record)
      const forwarded = engineReply(record, RELAY_SESSION)
      const withReceipt: Answer =
        forwarded.kind === "reply"
          ? { kind: "reply", reply: { ...forwarded.reply, authority: { exec: 1 } } }
          : forwarded
      return relayAnswer(record, withReceipt)
    },
  }
  const aliases = new Map([
    [LOCAL_SESSION, "<session>"],
    [RELAY_SESSION, "<session>"],
    [LISTING_KEY, "<session>"],
  ])
  return { local, relay, sent, aliases: () => aliases }
}

describe("relay parity sweep", () => {
  test("walks every method of the engine's own table on both routes and excludes connection_local", async () => {
    const table = await engineMethodClasses()
    const { local, relay, sent, aliases } = fakeLegs()

    const result = await sweepMethods(table, local, relay, aliases)

    const names = Object.keys(table.classes)
    const probed = names.filter((name) => table.classes[name] !== "connection_local")
    expect(result.methods.map((entry) => entry.method)).toEqual(probed)
    expect(result.excluded).toEqual(names.filter((name) => table.classes[name] === "connection_local"))
    expect(sent.local.map((record) => record["type"])).toEqual(probed.flatMap((name) => [name, name]))
    expect(sent.relay.map((record) => record["type"])).toEqual(sent.local.map((record) => record["type"]))
    expect(result.counts).toMatchObject({ same: probed.length, differs: 0, missing: 0 })
  })

  test("a relay that refuses one engine class reports those methods missing with the refusal", async () => {
    const table = await engineMethodClasses()
    const { local, relay, aliases } = fakeLegs((record, forwarded) =>
      table.classes[String(record["type"])] === "device_admin"
        ? {
            kind: "reply",
            reply: { type: "response", command: record["type"], success: false, errorCode: "delegation_not_granted" },
          }
        : forwarded,
    )

    const result = await sweepMethods(table, local, relay, aliases)

    const adminMethods = Object.keys(table.classes).filter((name) => table.classes[name] === "device_admin")
    expect(result.counts.missing).toBe(adminMethods.length)
    const missing = result.methods.find((entry) => entry.method === adminMethods[0])
    expect(missing === undefined ? undefined : verdictLine(missing)).toContain(
      "missing: session route: delegation_not_granted",
    )
  })

  test("a relay answer whose value differs is reported with the path and both values", async () => {
    const table = await engineMethodClasses()
    const target = Object.keys(table.classes).find((name) => table.classes[name] === "observe") ?? ""
    const { local, relay, aliases } = fakeLegs((record, forwarded) =>
      record["type"] === target && forwarded.kind === "reply"
        ? { kind: "reply", reply: { ...forwarded.reply, success: false, errorCode: "session_not_found" } }
        : forwarded,
    )

    const result = await sweepMethods(table, local, relay, aliases)

    expect(result.counts.differs).toBe(1)
    const entry = result.methods.find((candidate) => candidate.method === target)
    expect(entry?.verdict).toEqual({
      kind: "differs",
      detail: "session route: $.errorCode: only through the relay",
    })
  })
})

describe("compareAnswers", () => {
  const aliases = new Map([["sid-1", "<session>"]])

  test("per-call values (timestamps, uuids, request ids) never make answers differ", () => {
    const local: Answer = {
      kind: "reply",
      reply: {
        id: "a",
        success: true,
        data: { sessionId: "sid-1", at: "2026-11-16T01:02:03.000Z", op: "6f1b9a8e-1111-4c4c-8d8d-123456789abc" },
      },
    }
    const relay: Answer = {
      kind: "reply",
      reply: {
        id: "b",
        success: true,
        data: { sessionId: "sid-1", at: "2026-11-16T09:09:09.999Z", op: "0a0b0c0d-2222-4c4c-8d8d-cba987654321" },
      },
    }
    expect(compareAnswers(local, relay, aliases)).toEqual({ kind: "same" })
  })

  test("a record the engine never answers equals a relay command the engine applied without a reply", () => {
    expect(compareAnswers({ kind: "no_reply" }, { kind: "outcome", state: "engine_applied" }, aliases)).toEqual({
      kind: "same",
    })
  })

  test("a record served locally but refused by the relay transport is missing", () => {
    const local: Answer = { kind: "reply", reply: { success: true } }
    expect(compareAnswers(local, { kind: "refused", code: "unsupported", message: "no endpoint" }, aliases)).toEqual({
      kind: "missing",
      error: "unsupported",
    })
  })

  test("a reply that succeeds but reports an outcome it did not apply is shown with that outcome (unload_session)", () => {
    const refusedUnload: Answer = {
      kind: "reply",
      reply: { success: true, data: { outcome: "refused", reason: "unsupported", detail: "unknown_session" } },
    }
    expect(describeAnswer(refusedUnload)).toBe("reply ok (outcome refused: unknown_session)")
    expect(describeAnswer({ kind: "reply", reply: { success: true, data: { outcome: "applied" } } })).toBe("reply ok")
    expect(describeAnswer({ kind: "reply", reply: { success: true, data: {} } })).toBe("reply ok")
  })

  test("the same typed refusal on both legs is the same answer", () => {
    const refusal = (id: string): Answer => ({
      kind: "reply",
      reply: { id, success: false, errorCode: "unknown_session" },
    })
    expect(compareAnswers(refusal("x"), refusal("y"), aliases)).toEqual({ kind: "same" })
  })
})

test("the session route names the leg's own fixture; the endpoint route sends no session", () => {
  expect(probeRecord("get_state", "session", { sessionId: "s" }, "r1")).toEqual({
    id: "r1",
    sessionId: "s",
    type: "get_state",
  })
  expect(probeRecord("get_state", "endpoint", { sessionId: "s" }, "r1")).toEqual({ id: "r1", type: "get_state" })
  expect(probeRecord("close_session", "session", { sessionId: "s" }, "r1")["sessionId"]).toBe("rpcpar-none")
})
