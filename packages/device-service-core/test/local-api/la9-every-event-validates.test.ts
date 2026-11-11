import { afterEach, describe, expect, test } from "bun:test";
import type { LocalEvent } from "../../src/local-api/protocol.ts";
import { validateEvent } from "../../src/local-api/validate.ts";
import { PEER, SESSION_ID, defaultWorld } from "./conformance/world.ts";
import { eventExamples } from "./event-examples.ts";
import { cleanup, connectClient, nextEvent, ofKind, startOwner } from "./support.ts";

afterEach(cleanup);

const world = defaultWorld();
const row = world.listing.revisions[1]?.rows[0];
const examples = eventExamples;

const invalid: readonly (readonly [string, unknown])[] = [
  ["unknown kind", { type: "event", kind: "session.moved" }],
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
    await client.command(attach, { type: "abort" });
    await applied;
    await client.read(attach, { before_entry_id: "e-3" });
    for (const event of seen) expect(validateEvent(event)).toEqual(event);
    expect(new Set(seen.map((e) => e.kind)).size).toBeGreaterThanOrEqual(5);
  });
});
