import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, connectClient, nextEvent, ofKind, startOwner } from "./support.ts";

afterEach(cleanup);

describe("LA10 status.subscribe replays", () => {
  test("subscribing replays the current status, then pushes each change", async () => {
    const owner = await startOwner();
    const client = await connectClient(owner);
    const replay = nextEvent(client, ofKind("status.changed"));
    expect(await client.request("status.subscribe", {})).toEqual({});
    expect((await replay).status).toEqual(owner.state.status);

    const change = nextEvent(client, ofKind("status.changed"));
    await client.request("service.set_enabled", { enabled: false });
    expect((await change).status).toMatchObject({ state: "disabled", enabled: false });
  });

  test("a second subscriber gets the current status as its replay, not the first one", async () => {
    const owner = await startOwner();
    const first = await connectClient(owner);
    await first.request("service.set_enabled", { enabled: false });
    const second = await connectClient(owner);
    const replay = nextEvent(second, ofKind("status.changed"));
    await second.request("status.subscribe", {});
    expect((await replay).status).toMatchObject({ state: "disabled", enabled: false });
  });

  test("a client that did not subscribe receives no status events", async () => {
    const owner = await startOwner();
    const quiet = await connectClient(owner);
    const kinds: string[] = [];
    quiet.onEvent((event) => kinds.push(event.kind));
    const other = await connectClient(owner);
    const change = nextEvent(other, ofKind("status.changed"));
    await other.request("status.subscribe", {});
    await change;
    await quiet.request("service.set_enabled", { enabled: false });
    await quiet.request("status.get", {});
    expect(kinds).toEqual([]);
  });
});
