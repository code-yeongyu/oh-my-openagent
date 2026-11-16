import { describe, expect, test } from "bun:test"
import type { LocalEvent, RequestType, ResponseData, Status } from "../../src/local-api/protocol.ts"
import {
  validateEvent,
  validateHello,
  validateRequest,
  validateResponse,
  validateSnapshotBlob,
  validateWelcome,
} from "../../src/local-api/validate.ts"
import { exactly } from "../../src/local-api/validate-fields.ts"
import { PEER, defaultWorld } from "./conformance/world.ts"
import { eventExamples } from "./event-examples.ts"

// LA21 (omo-relay-daemon#914): what the client READS from the service (welcome, refused, response, event, snapshot
// blob) ignores a field this version does not define, so a newer service that adds one keeps an installed client
// working; a required field that is missing is still refused. What a peer SENDS to be acted on (hello, request) keeps
// refusing unknown fields.
const world = defaultWorld()
const KEY = "RVBFUEVQRVBFUEVQRVBFUA"
const SHA = "ab".repeat(32)
const COMMAND_ID = "Y29tbWFuZC1pZC0wMDAwMQ"
const NEWER = { environments: [{ environment_id: "env-1", revoked: false, closed: false }] }
const deviceRow = world.devices[0]
if (deviceRow === undefined) throw new Error("the world lists a device")
const attachState = { attached: true, changedAt: "2026-11-09T12:00:00.000Z" }

// One answer per request type; a new request type without a row fails typecheck here.
const answers: { readonly [T in RequestType]: ResponseData[T] } = {
  authenticate: {},
  "status.get": world.status,
  "status.subscribe": {},
  "service.set_enabled": { enabled: true },
  "refresher.register": {},
  "device.adopt": { device: { id: PEER, name: "studio" } },
  "device.forget": {},
  "device.info": { device: { id: PEER, name: "studio" } },
  "endpoints.register": {},
  "endpoints.unregister": {},
  "devices.list": { devices: [deviceRow] },
  "sessions.list": { query_id: "q1" },
  "session.attach": { attach: "a1" },
  "session.detach": {},
  "session.command": { command_id: COMMAND_ID },
  "session.command_part": { received: 0 },
  "session.read": { query_id: "q2" },
  "enforcement.report": {},
  "owner.shutdown_for_upgrade": {},
  "session.endpoints": { endpoints: [KEY] },
  "session.locate": { device: PEER, key: KEY, session: `${PEER}.${KEY}` },
  "control.attach.get": attachState,
  "control.attach.set": attachState,
}
const answerRows = Object.entries(answers) as [RequestType, unknown][]
const response = (data: unknown) => ({ id: "r1", type: "response", ok: true, data })
const decode = (type: RequestType, data: unknown) => validateResponse(response(data), type)
const withExtra = (v: object, extra: object = NEWER): object => ({ ...v, ...extra })

const welcome = {
  type: "welcome",
  v: 1,
  service_version: "0.1.20",
  owner: "service",
  server_proof: "c".repeat(43),
  server_nonce: "d".repeat(43),
  capabilities: ["sessions"],
  state: world.status,
}
const errorReply = (error: unknown) => ({ id: "r1", type: "response", ok: false, error })
const forbidden = {
  code: "forbidden",
  reason: "outside the agent dir",
  action: null,
  path_refusal: { component: "/x", problem: "foreign_owner" },
} as const
const snapshot = {
  attach_id: 1,
  cursor: { marker_id: "m-1", last_entry_id: null },
  state: {},
  entries: [],
  history_truncated: false,
  oldest_entry_id: null,
}
const status = {
  ...world.status,
  detail: { code: "relay_unreachable", action: null },
  policy: {
    state: "active",
    generation: 1,
    this_device: "acked",
    homes_pending: 0,
    unacked: [{ device: PEER, label: "studio" }],
  },
  device: { id: PEER, name: "studio" },
} satisfies Status

describe("LA21 a reply the client reads ignores fields this version does not define", () => {
  test("every response data with an extra field decodes to the data without it", () => {
    for (const [type, data] of answerRows)
      expect(decode(type, withExtra(data as object)) as unknown, type).toEqual({ id: "r1", ok: true, data })
  })

  test("the response envelope, an error body and its path refusal ignore an extra field", () => {
    expect(validateResponse({ ...response({}), trace: "t-1" }, "authenticate")).toEqual({
      id: "r1",
      ok: true,
      data: {},
    })
    const error = { ...forbidden, path_refusal: withExtra(forbidden.path_refusal) }
    expect(validateResponse(errorReply(withExtra(error)), "authenticate")).toEqual({
      id: "r1",
      ok: false,
      error: forbidden,
    })
  })

  test("nested reply shapes (status, detail, policy, device, device row, locate) ignore an extra field", () => {
    const nested = {
      ...status,
      detail: withExtra(status.detail),
      device: withExtra(status.device),
      policy: withExtra({ ...status.policy, unacked: [withExtra({ device: PEER, label: "studio" })] }),
    }
    expect(decode("status.get", withExtra(nested))).toEqual({ id: "r1", ok: true, data: status })
    expect(decode("devices.list", { devices: [withExtra(deviceRow)] })).toEqual({
      id: "r1",
      ok: true,
      data: { devices: [deviceRow] },
    })
    expect(decode("device.info", { device: withExtra({ id: PEER, name: "studio" }) })).toEqual({
      id: "r1",
      ok: true,
      data: { device: { id: PEER, name: "studio" } },
    })
  })

  test("welcome and refused ignore an extra field", () => {
    expect(validateWelcome(withExtra(welcome))).toEqual(validateWelcome(welcome))
    expect(validateWelcome({ type: "refused", reason: "version", hint: "upgrade" })).toEqual({
      type: "refused",
      reason: "version",
    })
  })

  test("every event kind with an extra field decodes to the event without it", () => {
    for (const event of Object.values(eventExamples)) expect(validateEvent(withExtra(event)), event.kind).toEqual(event)
  })

  test("nested event shapes (listing row, read entry, cursor, blob position, blob ref, located) ignore an extra field", () => {
    const rows = eventExamples["sessions.listing_rows"]
    expect(validateEvent({ ...rows, rows: rows.rows.map((r) => withExtra(r)) })).toEqual(rows)
    const read = eventExamples["session.read_result"]
    expect(validateEvent({ ...read, entries: read.entries.map((e) => withExtra(e)) })).toEqual(read)
    const open = eventExamples["session.blob_open"]
    expect(validateEvent({ ...open, position: withExtra(open.position) })).toEqual(open)
    const snap = eventExamples["session.snapshot"]
    expect(validateEvent({ ...snap, cursor: withExtra(snap.cursor) })).toEqual(snap)
    const head = { type: "event", kind: "session.command_event", device: PEER } as const
    const blob = { ...head, blob: { id: "b1", bytes: 3, sha256: SHA } }
    expect(validateEvent({ ...blob, blob: withExtra(blob.blob) })).toEqual(blob)
    const located = {
      ...head,
      command_id: COMMAND_ID,
      response: { success: true },
      located: { key: KEY, session: `${PEER}.${KEY}` },
    }
    expect(validateEvent({ ...located, located: withExtra(located.located) })).toEqual(located)
  })

  test("a snapshot blob payload ignores an extra field", () => {
    expect(validateSnapshotBlob(withExtra(snapshot))).toEqual(snapshot)
  })
})

describe("LA21 a reply the client reads still refuses a missing required field", () => {
  test("every response data without one of its fields is a protocol_violation", () => {
    for (const [type, data] of answerRows)
      for (const name of Object.keys(data as object)) {
        const { [name]: _dropped, ...rest } = data as Record<string, unknown>
        expect(() => decode(type, withExtra(rest)), `${type} without ${name}`).toThrow(`misses ${name}`)
      }
  })

  test("the envelope and every event kind without one of its fields are refused", () => {
    for (const name of ["id", "type", "ok"]) {
      const { [name]: _dropped, ...rest } = response({}) as Record<string, unknown>
      expect(() => validateResponse(rest, "authenticate"), name).toThrow("protocol_violation")
    }
    for (const event of Object.values(eventExamples) as LocalEvent[])
      for (const name of Object.keys(event).filter((key) => key !== "type" && key !== "kind")) {
        const { [name]: _dropped, ...rest } = event as Record<string, unknown>
        expect(() => validateEvent(withExtra(rest)), `${event.kind} without ${name}`).toThrow("protocol_violation")
      }
  })

  test("a field another variant defines stays refused: the reply's own rules do not loosen", () => {
    const misplaced: readonly (readonly [string, () => unknown])[] = [
      ["ok:true carrying error", () => validateResponse({ ...response({}), error: forbidden }, "authenticate")],
      ["ok:false carrying data", () => validateResponse({ ...errorReply(forbidden), data: {} }, "authenticate")],
      [
        "an inline read entry carrying sha256",
        () =>
          validateEvent({
            ...eventExamples["session.read_result"],
            entries: [{ kind: "entry", entry_id: "e-1", entry: {}, sha256: SHA }],
          }),
      ],
      [
        "a command event carrying a blob and a frame",
        () =>
          validateEvent({
            type: "event",
            kind: "session.command_event",
            device: PEER,
            blob: { id: "b1", bytes: 3, sha256: SHA },
            frame: {},
          }),
      ],
      [
        "a detached abort naming a fetch",
        () =>
          validateEvent({
            type: "event",
            kind: "session.blob_abort",
            attach: "a1",
            id: "b2",
            reason: "detached",
            query_id: "q2",
          }),
      ],
    ]
    for (const [name, run] of misplaced) expect(run, name).toThrow("protocol_violation")
  })
})

describe("LA21 what a peer sends to be acted on keeps refusing unknown fields", () => {
  test("a request with an unknown field is invalid_request", () => {
    expect(validateRequest({ id: "r2", type: "session.endpoints", device: PEER, ...NEWER })).toEqual({
      ok: false,
      id: "r2",
      code: "invalid_request",
      reason: "request has an unknown field",
    })
  })

  test("a hello with an unknown field is refused malformed", () => {
    const hello = {
      type: "hello",
      v: 1,
      client: { name: "omo", version: "5.1.66" },
      client_nonce: "n".repeat(43),
    }
    expect(validateHello(hello).ok).toBe(true)
    expect(validateHello(withExtra(hello))).toEqual({ ok: false, reason: "malformed" })
  })
})

// Mixed versions on the endpoint lookup that broke every device command (omo-relay-daemon#914). The service contract
// (device-service 0.1.24): a client that does not ask gets exactly {endpoints}; `environments` is returned only when the
// request carries the optional `environments: true`, which a client may send only to service_version >= 0.1.24 because
// an older service refuses an unknown request field. This version does not send it. The 5.1.65 client decoded the
// reply with the strict field check (its bundle: `Qi(e,["endpoints"],[],"data")`, the `exactly` this package still
// uses for requests), so its rows run that check on the same data.
describe("LA21 mixed client and service versions on session.endpoints", () => {
  const unasked = { endpoints: [KEY] }
  const carryingAField = { endpoints: [KEY], ...NEWER }
  const strictClient = (data: unknown) => ({ endpoints: exactly(data, ["endpoints"], [], "data")["endpoints"] })
  const newClient = (data: unknown) => {
    const verdict = decode("session.endpoints", data)
    return verdict.ok ? verdict.data : verdict.error
  }
  const replies: readonly (readonly [string, (data: unknown) => unknown, unknown, unknown])[] = [
    [
      "5.1.65 client, 0.1.24 service, not asked: {endpoints} only, no break",
      strictClient,
      unasked,
      { endpoints: [KEY] },
    ],
    ["new client, 0.1.24 service, not asked: {endpoints}", newClient, unasked, { endpoints: [KEY] }],
    ["new client, pre-0.1.24 service: {endpoints}", newClient, unasked, { endpoints: [KEY] }],
    [
      "new client, a reply carrying a field it does not define: dropped",
      newClient,
      carryingAField,
      { endpoints: [KEY] },
    ],
    [
      "5.1.65 client, a reply carrying environments unasked (the build rolled 2026-11-09)",
      strictClient,
      carryingAField,
      "data has an unknown field",
    ],
  ]
  for (const [name, client, data, expected] of replies)
    test(name, () => {
      if (typeof expected === "string") expect(() => client(data)).toThrow(expected)
      else expect(client(data)).toEqual(expected)
    })

  test("pre-0.1.24 service refuses session.endpoints {device, environments: true}, so this version never sends it", () => {
    expect(validateRequest({ id: "r3", type: "session.endpoints", device: PEER, environments: true })).toEqual({
      ok: false,
      id: "r3",
      code: "invalid_request",
      reason: "request has an unknown field",
    })
  })
})
