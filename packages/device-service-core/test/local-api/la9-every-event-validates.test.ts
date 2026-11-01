import { afterEach, describe, expect, test } from "bun:test";
import type { EventKind, LocalEvent } from "../../src/local-api/protocol.ts";
import { validateEvent } from "../../src/local-api/validate.ts";
import { PEER, SESSION_ID, defaultWorld } from "./conformance/world.ts";
import { cleanup, connectClient, nextEvent, ofKind, startOwner } from "./support.ts";

afterEach(cleanup);

const world = defaultWorld();
const row = world.listing.revisions[1]?.rows[0];
const sha = "ab".repeat(32);
// One example per event kind; a new kind without an example fails typecheck here.
const examples: { readonly [K in EventKind]: Extract<LocalEvent, { kind: K }> } = {
  "status.changed": { type: "event", kind: "status.changed", status: world.status },
  "sessions.round": {
    type: "event",
    kind: "sessions.round",
    query_id: "q1",
    state: "open",
    devices: { [PEER]: "pending" },
  },
  "sessions.listing_begin": {
    type: "event",
    kind: "sessions.listing_begin",
    query_id: "q1",
    revision: 1,
  },
  "sessions.listing_rows": {
    type: "event",
    kind: "sessions.listing_rows",
    query_id: "q1",
    revision: 1,
    rows: row === undefined ? [] : [row],
  },
  "sessions.listing_end": {
    type: "event",
    kind: "sessions.listing_end",
    query_id: "q1",
    revision: 1,
    incomplete: [PEER],
  },
  "session.snapshot": {
    type: "event",
    kind: "session.snapshot",
    attach: "a1",
    ...(world.sessions[0]?.snapshot ?? {
      attach_id: 1,
      cursor: { marker_id: "m", last_entry_id: null },
      state: {},
      entries: [],
      history_truncated: false,
      oldest_entry_id: null,
    }),
  },
  "session.snapshot_loading": {
    type: "event",
    kind: "session.snapshot_loading",
    attach: "a1",
    blob: "b1",
  },
  "session.records": {
    type: "event",
    kind: "session.records",
    attach: "a1",
    attach_id: 1,
    records: [{ type: "message_update" }],
  },
  "session.blob_open": {
    type: "event",
    kind: "session.blob_open",
    attach: "a1",
    id: "b1",
    bytes: 3,
    sha256: sha,
    of: "record",
    position: { attach_id: 1, seq: 4 },
  },
  "session.blob_chunk": {
    type: "event",
    kind: "session.blob_chunk",
    attach: "a1",
    id: "b1",
    off: 0,
    b: "YWJj",
  },
  "session.blob_done": { type: "event", kind: "session.blob_done", attach: "a1", id: "b1" },
  "session.blob_abort": {
    type: "event",
    kind: "session.blob_abort",
    attach: "a1",
    id: "b2",
    reason: "too_large",
    query_id: "q2",
    entry_id: "e-9",
  },
  "session.attach_pending": {
    type: "event",
    kind: "session.attach_pending",
    attach: "a1",
    reason: "stream_key_pending",
  },
  "session.detached": {
    type: "event",
    kind: "session.detached",
    attach: "a1",
    reason: "owner_transfer",
  },
  "session.command_state": {
    type: "event",
    kind: "session.command_state",
    command_id: "Y29tbWFuZC1pZC0wMDAwMQ",
    state: "uncertain",
    reason: "transport_expired",
    retryable: false,
  },
  "session.read_result": {
    type: "event",
    kind: "session.read_result",
    attach: "a1",
    query_id: "q2",
    entries: [{ kind: "entry_ref", entry_id: "e-9", bytes: 20, sha256: sha }],
    next_before: null,
  },
  "session.upload_abort": {
    type: "event",
    kind: "session.upload_abort",
    upload_id: "u1",
    reason: "parts_conflict",
  },
};

const invalid: readonly (readonly [string, unknown])[] = [
  ["unknown kind", { type: "event", kind: "session.moved" }],
  ["extra field", { ...examples["session.blob_done"], extra: 1 }],
  ["uncertain marked retryable", { ...examples["session.command_state"], retryable: true }],
  [
    "never_sent not retryable",
    {
      type: "event",
      kind: "session.command_state",
      command_id: "Y29tbWFuZC1pZC0wMDAwMQ",
      state: "not delivered: never_sent",
      retryable: false,
    },
  ],
  [
    "refusal without reason",
    {
      type: "event",
      kind: "session.command_state",
      command_id: "Y29tbWFuZC1pZC0wMDAwMQ",
      state: "engine_refused",
      retryable: false,
    },
  ],
  [
    "expired as a state",
    {
      type: "event",
      kind: "session.command_state",
      command_id: "Y29tbWFuZC1pZC0wMDAwMQ",
      state: "not delivered: expired",
      retryable: true,
    },
  ],
  [
    "command_id of 24 characters",
    { ...examples["session.command_state"], command_id: "cmd_0123456789abcdef0123" },
  ],
  [
    "too_large without its fetch",
    { type: "event", kind: "session.blob_abort", attach: "a1", id: "b2", reason: "too_large" },
  ],
  [
    "other abort naming a fetch",
    {
      type: "event",
      kind: "session.blob_abort",
      attach: "a1",
      id: "b2",
      reason: "detached",
      query_id: "q2",
      entry_id: "e",
    },
  ],
  ["record blob without seq", { ...examples["session.blob_open"], position: { attach_id: 1 } }],
  [
    "chunk over LOCAL_CHUNK_MAX",
    { ...examples["session.blob_chunk"], b: Buffer.alloc(262_145).toString("base64") },
  ],
  [
    "row in an unknown state",
    { ...examples["sessions.listing_rows"], rows: [{ ...row, state: "paused" }] },
  ],
  [
    "status in an unknown state",
    { type: "event", kind: "status.changed", status: { ...world.status, state: "forwarding" } },
  ],
];

describe("LA9 every event validates", () => {
  test("one example of every kind validates to itself", () => {
    for (const event of Object.values(examples)) expect(validateEvent(event)).toEqual(event);
  });

  test("malformed events are refused", () => {
    for (const [name, event] of invalid) expect(() => validateEvent(event), name).toThrow();
  });

  test("every event the fake owner pushes for a full attach, read and command validates in the client", async () => {
    const owner = await startOwner();
    const client = await connectClient(owner);
    const seen: LocalEvent[] = [];
    client.onEvent((event) => seen.push(event));
    const snapshot = nextEvent(client, ofKind("session.snapshot"));
    const attach = (
      await client.request("session.attach", { device: PEER, session_id: SESSION_ID })
    ).attach;
    await snapshot;
    const applied = nextEvent(
      client,
      (e): e is LocalEvent => e.kind === "session.command_state" && e.state === "engine_applied",
    );
    await client.command(attach, { op: "abort" });
    await applied;
    await client.read(attach, { before_entry_id: "e-3" });
    for (const event of seen) expect(validateEvent(event)).toEqual(event);
    expect(new Set(seen.map((e) => e.kind)).size).toBeGreaterThanOrEqual(5);
  });
});
