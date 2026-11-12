import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

import { gatewayDatabasePath } from "./paths"
import { renderDeliveryText } from "./provenance"
import { GATEWAY_MIGRATIONS } from "./schema"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"
import type { IntakeRecord, IntakeRequest } from "./types"

// The intake row of #13037 (design r2 section 5.5, amendment A2.1/A2.11/A2.12/A2.15): a record another device's
// service attested is committed through the store's enqueue transaction and drained under the engine's ledger key.

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

function record(overrides: Partial<IntakeRecord> = {}): IntakeRecord {
  return {
    sessionId: "target",
    deliveryId: "d-1",
    text: "OMO_GATEWAY v=1\nsource=peer_agent\n\nhello from another device",
    displayText: "[peer] hello from another device",
    sender: { kind: "agent", session_id: "sender-s", name: "builder" },
    deliverAs: "followUp",
    chainCount: 1,
    ...overrides,
  }
}

function request(
  h: GatewayHarness,
  overrides: Partial<IntakeRequest> = {},
  rec: Partial<IntakeRecord> = {},
): IntakeRequest {
  return {
    now: h.clock.now,
    attested_device: "dev-a",
    record: record(rec),
    provenance: { workspace: "remote", project: "remote" },
    target_session_kind: "interactive",
    ...overrides,
  }
}

describe("intake", () => {
  test("#given an attested record #when it is taken in #then one committed row carries the ledger id, the verbatim text and the sender's claims, and the answer returns the sender's id", async () => {
    const h = (harness = createGatewayHarness())
    const target = h.session("target")
    const answer = await target.store.intake(request(h, {}, { chainCount: 3 }))
    expect(answer).toMatchObject({
      kind: "queued",
      delivery_id: "d-1",
      ledger_id: "device:dev-a/d-1",
      deduplicated: false,
    })
    if (answer.kind !== "queued") throw new Error("intake refused")
    expect(answer.row_id).not.toBe("d-1")

    // Committed before the answer: a second handle reads the row.
    const rows = await h.store().list({ target_durable_id: "target" })
    expect(rows).toHaveLength(1)
    const row = rows[0]
    if (row === undefined) throw new Error("no row")
    expect(row).toMatchObject({
      delivery_id: answer.row_id,
      ledger_id: "device:dev-a/d-1",
      verbatim_text: record().text,
      verbatim_display_text: record().displayText,
      state: "queued",
      mode_requested: "follow_up",
      hop: 3,
      sender: "device:dev-a#session:sender-s",
    })
    expect(row.envelope.origin).toEqual({ session: "sender-s" })
    expect(row.envelope.provenance?.device).toBe("dev-a")
  })

  test("#given an intake row #when the session drains it #then the engine is handed the ledger id and the record's text and display text unrendered", async () => {
    const h = (harness = createGatewayHarness())
    const target = h.session("target")
    await target.store.intake(request(h))
    await target.drain.drain({ reason: "command" })
    await h.quiesce()
    expect(target.runtime.enqueueCalls.map((call) => call.delivery_id)).toEqual(["device:dev-a/d-1"])
    expect(target.runtime.textOf("device:dev-a/d-1")).toBe(record().text)
    expect(target.runtime.senderOf("device:dev-a/d-1")).toEqual({
      sender: { kind: "agent", session_id: "sender-s", name: "builder" },
      display_text: record().displayText,
    })
    const [row] = await target.store.list({ target_durable_id: "target" })
    expect(row?.state).toBe("applied")
  })

  test("#given a taken-in record #when the same device repeats it #then the first answer replays with deduplicated, and the same id from another device is a second delivery", async () => {
    const h = (harness = createGatewayHarness())
    const target = h.session("target")
    const first = await target.store.intake(request(h))
    const again = await target.store.intake(request(h))
    expect(again).toEqual({ ...first, deduplicated: true } as typeof again)
    const other = await target.store.intake(request(h, { attested_device: "dev-b" }))
    expect(other).toMatchObject({
      kind: "queued",
      delivery_id: "d-1",
      ledger_id: "device:dev-b/d-1",
      deduplicated: false,
    })
    const rows = await target.store.list({ target_durable_id: "target" })
    expect(rows.map((row) => row.ledger_id).sort()).toEqual(["device:dev-a/d-1", "device:dev-b/d-1"])
  })

  test("#given a taken-in record #when the same device repeats its delivery id under another claimed sender #then the first answer replays and no second row exists", async () => {
    const h = (harness = createGatewayHarness())
    const target = h.session("target")
    const first = await target.store.intake(request(h))
    const again = await target.store.intake(request(h, {}, { sender: { kind: "agent", session_id: "someone-else" } }))
    expect(again).toEqual({ ...first, deduplicated: true } as typeof again)
    const rows = await target.store.list({ target_durable_id: "target" })
    expect(rows.map((row) => row.ledger_id)).toEqual(["device:dev-a/d-1"])
  })

  test("#given one device #when it claims a different session id on every record #then the rate bucket still counts that device alone", async () => {
    const h = (harness = createGatewayHarness())
    const target = h.session("target")
    for (let index = 0; index < 8; index++) {
      const answer = await target.store.intake(
        request(h, {}, { deliveryId: `d-${index}`, sender: { kind: "agent", session_id: `claimed-${index}` } }),
      )
      expect(answer.kind).toBe("queued")
    }
    const ninth = await target.store.intake(
      request(h, {}, { deliveryId: "d-8", sender: { kind: "agent", session_id: "claimed-8" } }),
    )
    expect(ninth).toMatchObject({ kind: "refused", code: "overloaded", details: { budget: "pair_rate" } })
    expect((await target.store.intake(request(h, { attested_device: "dev-b" }, { deliveryId: "d-8" }))).kind).toBe(
      "queued",
    )
  })

  test.each([
    ["a steer", {}, { deliverAs: "steer" as const }, { code: "turn_conflict" }],
    [
      "a sender that is not an agent",
      {},
      { sender: { kind: "command_line" } },
      { code: "unsupported", details: { reason: "sender_not_allowed" } },
    ],
    [
      "a child session",
      { target_session_kind: "child" as const },
      {},
      { code: "not_resumable", details: { reason: "not_wakeable" } },
    ],
    [
      "a worker session",
      { target_session_kind: "worker" as const },
      {},
      { code: "not_resumable", details: { reason: "not_wakeable" } },
    ],
    [
      "a chain count over the set limit",
      { chain_count_limit: 3 },
      { chainCount: 4 },
      { code: "unsupported", details: { reason: "chain_count_limit" } },
    ],
  ] as const)(
    "#given %s #when it is taken in #then it is refused before the commit and no row exists",
    async (_name, extra, rec, refusal) => {
      const h = (harness = createGatewayHarness())
      const target = h.session("target")
      const answer = await target.store.intake(request(h, extra, rec))
      expect(answer).toMatchObject({ kind: "refused", ...refusal })
      expect(await target.store.list({ target_durable_id: "target" })).toEqual([])
    },
  )

  test("#given the chain limit #when the count is at the limit, or no limit is set #then the record is taken in", async () => {
    const h = (harness = createGatewayHarness())
    const target = h.session("target")
    expect((await target.store.intake(request(h, { chain_count_limit: 3 }, { chainCount: 3 }))).kind).toBe("queued")
    expect((await target.store.intake(request(h, {}, { deliveryId: "d-2", chainCount: 500 }))).kind).toBe("queued")
  })
})

describe("one engine ledger entry across the drain and the RPC path", () => {
  test("#given an intake row the drain admitted #when the same delivery arrives as the engine's RPC key #then the engine holds it once", async () => {
    const h = (harness = createGatewayHarness())
    const target = h.session("target")
    await target.store.intake(request(h))
    await target.drain.drain({ reason: "command" })
    await h.quiesce()
    const live = target.runtime.admitExternalMessage({
      delivery_id: "device:dev-a/d-1",
      text: record().text,
      sender: { kind: "agent", session_id: "sender-s" },
      display_text: record().displayText,
      deliverAs: "followUp",
    })
    expect(live.kind).toBe("already_admitted")
    expect(target.runtime.transcriptEntries("device:dev-a/d-1")).toBe(1)
  })

  test("#given the RPC path already wrote the delivery #when the same delivery is taken in and drained #then the row settles applied without a second entry", async () => {
    const h = (harness = createGatewayHarness())
    const target = h.session("target")
    const live = target.runtime.admitExternalMessage({
      delivery_id: "device:dev-a/d-1",
      text: record().text,
      sender: { kind: "agent", session_id: "sender-s" },
      display_text: record().displayText,
      deliverAs: "followUp",
    })
    expect(live.kind).toBe("started")
    await h.quiesce()
    target.runtime.endTurn()
    await h.quiesce()
    expect(target.runtime.transcriptEntries("device:dev-a/d-1")).toBe(1)

    await target.store.intake(request(h))
    await target.drain.drain({ reason: "command" })
    await h.quiesce()
    expect(target.runtime.enqueueCount("device:dev-a/d-1")).toBe(1)
    expect(target.runtime.transcriptEntries("device:dev-a/d-1")).toBe(1)
    const [row] = await target.store.list({ target_durable_id: "target" })
    expect(row?.state).toBe("applied")
  })
})

test("#given an intake row a session consumed #when that session replies to another session #then the reply continues the row's root and hop", async () => {
  const h = (harness = createGatewayHarness())
  const b = h.session("b")
  h.session("c")
  await b.store.intake(request(h, {}, { sessionId: "b", chainCount: 3 }))
  await b.drain.drain({ reason: "command" })
  await h.quiesce()
  const [intakeRow] = await b.store.list({ target_durable_id: "b" })
  const reply = await b.engine.deliver({
    sender: { kind: "session", durable_id: "b", cause_delivery_id: "device:dev-a/d-1" },
    target: "c",
    text: "answer",
  })
  expect(reply.kind).toBe("ok")
  const [replyRow] = await b.store.list({ target_durable_id: "c" })
  expect(replyRow?.hop).toBe(4)
  expect(replyRow?.root_id).toBe(intakeRow?.root_id ?? "missing")
})

test("#given a same-device delivery #when it is drained #then it has no ledger id and the engine gets the row id and the rendered text as before", async () => {
  const h = (harness = createGatewayHarness())
  const a = h.session("a")
  const b = h.session("b")
  const sent = await a.engine.deliver({ sender: { kind: "session", durable_id: "a" }, target: "b", text: "local" })
  if (sent.kind !== "ok") throw new Error("send refused")
  await h.quiesce()
  const [row] = await b.store.list({ target_durable_id: "b" })
  if (row === undefined) throw new Error("no row")
  expect(row).toMatchObject({ ledger_id: null, verbatim_text: null, verbatim_display_text: null })
  expect(b.runtime.enqueueCalls.map((call) => call.delivery_id)).toEqual([sent.delivery_id])
  expect(b.runtime.textOf(sent.delivery_id)).toBe(renderDeliveryText(row))
})

test("#given a store at the previous schema with a delivery #when the new build opens it #then the three columns are added empty and the old row still drains", async () => {
  const h = (harness = createGatewayHarness())
  const path = gatewayDatabasePath(h.agentDir)
  mkdirSync(dirname(path), { recursive: true })
  const previous = GATEWAY_MIGRATIONS.findIndex((step) => step.some((statement) => statement.includes("wait_kind"))) + 1
  const db = new Database(path)
  try {
    db.exec("PRAGMA journal_mode = WAL")
    for (const step of GATEWAY_MIGRATIONS.slice(0, previous)) for (const statement of step) db.exec(statement)
    db.exec(`PRAGMA user_version = ${previous}`)
    db.query(
      `INSERT INTO deliveries (delivery_id, target_durable_id, seq, sender, envelope, body, bytes, mode_requested, state, root_id, hop, created_at, updated_at, expires_at)
       VALUES ('old-1', 'b', 1, 'session:a', ?, 'before', 6, 'follow_up', 'queued', 'root-old', 1, ?, ?, ?)`,
    ).run(
      JSON.stringify({
        provenance: { workspace: "w", project: "p" },
        origin: { session: "a" },
        actor: "a",
        via: ["a"],
        root_id: "root-old",
        hop: 1,
        delivery_id: "old-1",
      }),
      h.clock.now,
      h.clock.now,
      h.clock.now + 60_000,
    )
    db.exec("INSERT INTO causal_roots VALUES ('root-old', 'session:a', 0, 9999999999999)")
  } finally {
    db.close()
  }
  const b = h.session("b")
  const [row] = await b.store.list({ target_durable_id: "b" })
  expect(row).toMatchObject({ delivery_id: "old-1", ledger_id: null, verbatim_text: null, verbatim_display_text: null })
  const check = new Database(path, { readonly: true })
  try {
    const columns = (check.query("PRAGMA table_info(deliveries)").all() as { name: string }[]).map(
      (column) => column.name,
    )
    expect(columns).toEqual(expect.arrayContaining(["ledger_id", "verbatim_text", "verbatim_display_text"]))
  } finally {
    check.close()
  }
  await b.drain.drain({ reason: "command" })
  await h.quiesce()
  expect(b.runtime.enqueueCalls.map((call) => call.delivery_id)).toEqual(["old-1"])
})
