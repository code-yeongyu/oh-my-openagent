import { afterEach, describe, expect, test } from "bun:test";
import { LOCAL_LINE_MAX } from "../../src/local-api/framing.ts";
import type { LocalEvent } from "../../src/local-api/protocol.ts";
import { PEER, SESSION_ID, defaultWorld, type World } from "./conformance/world.ts";
import {
  cleanup,
  connectClient,
  nextEvent,
  ofKind,
  rawConnect,
  rawHandshake,
  startOwner,
} from "./support.ts";

afterEach(cleanup);

const THREE_MIB = 3 * 1024 * 1024;

const worldWithLargeState = (): World => {
  const base = defaultWorld();
  const [session, ...rest] = base.sessions;
  if (session === undefined) throw new Error("the default world has a session");
  const transcript = Array.from(
    { length: THREE_MIB / 64 },
    (_, i) => `${String(i).padStart(10, "0")}${"z".repeat(54)}`,
  ).join("");
  return {
    ...base,
    sessions: [
      {
        ...session,
        snapshot: { ...session.snapshot, state: { ...session.snapshot.state, transcript } },
      },
      ...rest,
    ],
  };
};

describe("LA15 a 3 MiB state arrives as chunks and reassembles byte-identically", () => {
  test("every line on the wire is under LOCAL_LINE_MAX and the state blob is chunked", async () => {
    const world = worldWithLargeState();
    const owner = await startOwner(world);
    const peer = await rawConnect(owner.stateDir);
    await rawHandshake(peer, owner.token);
    peer.send({ id: "attach", type: "session.attach", device: PEER, session_id: SESSION_ID });
    const kinds: string[] = [];
    for (;;) {
      const message = await peer.next();
      kinds.push(
        String(Reflect.get(Object(message), "kind") ?? Reflect.get(Object(message), "type")),
      );
      if (kinds.at(-1) === "session.blob_done") break;
    }
    expect(kinds.slice(0, 3)).toEqual([
      "response",
      "session.snapshot_loading",
      "session.blob_open",
    ]);
    const chunks = kinds.filter((k) => k === "session.blob_chunk").length;
    console.log(
      `state lines=${peer.sizes.length} chunks=${chunks} max_line=${Math.max(...peer.sizes)}`,
    );
    expect(chunks).toBeGreaterThanOrEqual(12);
    for (const size of peer.sizes) expect(size).toBeLessThan(LOCAL_LINE_MAX);
  });

  test("the client emits snapshot_loading, the blob events, then a session.snapshot equal byte for byte", async () => {
    const world = worldWithLargeState();
    const owner = await startOwner(world);
    const client = await connectClient(owner);
    const kinds: LocalEvent["kind"][] = [];
    client.onEvent((event) => kinds.push(event.kind));
    const snapshot = nextEvent(client, ofKind("session.snapshot"));
    const { attach } = await client.request("session.attach", {
      device: PEER,
      session_id: SESSION_ID,
    });
    const event = await snapshot;
    const { type: _type, kind: _kind, attach: attached, ...body } = event;
    expect(attached).toBe(attach);
    expect(JSON.stringify(body)).toBe(JSON.stringify(world.sessions[0]?.snapshot));
    expect(kinds[0]).toBe("session.snapshot_loading");
    expect(kinds.indexOf("session.blob_done")).toBeLessThan(kinds.indexOf("session.snapshot"));
  });
});
