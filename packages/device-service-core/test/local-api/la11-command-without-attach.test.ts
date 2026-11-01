import { afterEach, describe, expect, test } from "bun:test";
import { rejectionOf } from "./conformance/rejection.ts";
import { PEER, SESSION_ID } from "./conformance/world.ts";
import { cleanup, connectClient, nextEvent, ofKind, startOwner } from "./support.ts";

afterEach(cleanup);

describe("LA11 session.command without an attach is refused", () => {
  test("a command naming an attach that was never issued is refused not_attached and binds nothing", async () => {
    const owner = await startOwner();
    const client = await connectClient(owner);
    const kinds: string[] = [];
    client.onEvent((event) => kinds.push(event.kind));
    const sending = client.request("session.command", {
      attach: "never-attached",
      command: { op: "abort" },
    });
    expect(await rejectionOf(sending)).toMatchObject({ code: "not_attached" });
    expect(owner.state.bindings.size).toBe(0);
    await client.request("status.get", {});
    expect(kinds).toEqual([]);
  });

  test("after session.detach the old attach no longer takes commands", async () => {
    const owner = await startOwner();
    const client = await connectClient(owner);
    const snapshot = nextEvent(client, ofKind("session.snapshot"));
    const { attach } = await client.request("session.attach", {
      device: PEER,
      session_id: SESSION_ID,
    });
    await snapshot;
    await client.request("session.detach", { attach });
    expect(await rejectionOf(client.command(attach, { op: "abort" }))).toMatchObject({
      code: "not_attached",
    });
    expect(owner.state.bindings.size).toBe(0);
  });

  test("another connection's attach is not usable", async () => {
    const owner = await startOwner();
    const holder = await connectClient(owner);
    const snapshot = nextEvent(holder, ofKind("session.snapshot"));
    const { attach } = await holder.request("session.attach", {
      device: PEER,
      session_id: SESSION_ID,
    });
    await snapshot;
    const stranger = await connectClient(owner);
    expect(await rejectionOf(stranger.command(attach, { op: "abort" }))).toMatchObject({
      code: "not_attached",
    });
  });
});
