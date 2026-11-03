import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { defaultWorld } from "./conformance/world.ts";
import { cleanup, connectClient, rawConnect, rawHandshake, startOwner } from "./support.ts";

afterEach(cleanup);

describe("LA13 service.set_enabled persisted shape", () => {
  test("set_enabled false answers {enabled:false}, persists exactly that shape and survives a restart", async () => {
    const owner = await startOwner();
    const client = await connectClient(owner);
    expect(await client.request("service.set_enabled", { enabled: false })).toEqual({
      enabled: false,
    });
    expect(JSON.parse(readFileSync(join(owner.stateDir, "config.json"), "utf8"))).toEqual({
      enabled: false,
    });
    expect(await client.request("status.get", {})).toMatchObject({
      state: "disabled",
      enabled: false,
    });
    client.close();
    await owner.stop();

    const restarted = await startOwner(defaultWorld(), owner.stateDir);
    const again = await connectClient(restarted);
    expect(await again.request("status.get", {})).toMatchObject({
      state: "disabled",
      enabled: false,
    });
    expect(await again.request("service.set_enabled", { enabled: true })).toEqual({
      enabled: true,
    });
    expect(await again.request("status.get", {})).toMatchObject({
      state: "connected",
      enabled: true,
    });
  });

  test("a non-boolean, missing or extra field is refused invalid_request and changes nothing", async () => {
    const owner = await startOwner();
    const peer = await rawConnect(owner.stateDir);
    await rawHandshake(peer, owner.token);
    const bad = [
      { id: "1", type: "service.set_enabled", enabled: "false" },
      { id: "2", type: "service.set_enabled" },
      { id: "3", type: "service.set_enabled", enabled: false, scope: "all" },
    ];
    for (const request of bad) {
      peer.send(request);
      expect(await peer.next()).toMatchObject({
        id: request.id,
        ok: false,
        error: { code: "invalid_request" },
      });
    }
    expect(owner.state.status.enabled).toBe(true);
    expect(owner.state.log).toEqual([]);
  });
});
