import { afterEach, describe, expect, test } from "bun:test";
import { clientProof } from "../../src/local-api/access.ts";
import { cleanup, deviceKeys, helloFrom, OMO, rawConnect, startOwner } from "./support.ts";

afterEach(cleanup);

describe("LA2 a request before the client proof is dropped", () => {
  test("device.adopt and status.get before authenticate are refused and never executed", async () => {
    const owner = await startOwner();
    const peer = await rawConnect(owner.stateDir);
    const keys = deviceKeys();
    peer.send(helloFrom(OMO));
    const welcome = await peer.next();
    peer.send({
      id: "1",
      type: "device.adopt",
      device: { id: "dev-self", name: "This Mac" },
      signing_private_key: keys.signing,
      sealing_private_key: keys.sealing,
    });
    peer.send({ id: "2", type: "status.get" });
    expect(await peer.next()).toMatchObject({
      id: "1",
      ok: false,
      error: { code: "unauthenticated" },
    });
    expect(await peer.next()).toMatchObject({
      id: "2",
      ok: false,
      error: { code: "unauthenticated" },
    });
    expect(owner.state.adoptions).toBe(0);
    expect(owner.state.log).toEqual([]);

    const nonce = String(Reflect.get(Object(welcome), "server_nonce"));
    peer.send({
      id: "3",
      type: "authenticate",
      client_proof: clientProof(owner.token, nonce, peer.endpoint),
    });
    expect(await peer.next()).toMatchObject({ id: "3", ok: true });
    peer.send({ id: "4", type: "status.get" });
    expect(await peer.next()).toMatchObject({ id: "4", ok: true, data: { state: "connected" } });
    expect(owner.state.log).toEqual(["status.get"]);
  });

  test("a first line that is not a hello is refused 'malformed' and the connection closes", async () => {
    const owner = await startOwner();
    const peer = await rawConnect(owner.stateDir);
    peer.send({ id: "1", type: "status.get" });
    expect(await peer.next()).toEqual({ type: "refused", reason: "malformed" });
    await peer.closed;
    expect(owner.state.log).toEqual([]);
  });
});
