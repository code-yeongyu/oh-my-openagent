import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";
import { clientProof, tcpEndpoint } from "../../src/local-api/access.ts";
import { cleanup, helloFrom, OMO, rawConnect, startOwner } from "./support.ts";

afterEach(cleanup);

describe("LA4 a wrong client_proof is refused", () => {
  test("authenticate with a proof over another token is refused and the owner closes the connection", async () => {
    const owner = await startOwner();
    const peer = await rawConnect(owner.stateDir);
    peer.send(helloFrom(OMO));
    const welcome = await peer.next();
    const nonce = String(Reflect.get(Object(welcome), "server_nonce"));
    peer.send({
      id: "a",
      type: "authenticate",
      client_proof: clientProof(randomBytes(32), nonce, peer.endpoint),
    });
    peer.send({ id: "b", type: "status.get" });
    expect(await peer.next()).toMatchObject({
      id: "a",
      ok: false,
      error: { code: "client_proof_invalid" },
    });
    await peer.closed;
    expect(peer.received).toHaveLength(2);
    expect(owner.state.log).toEqual([]);
  });

  test("a proof over the client nonce instead of the server nonce is refused", async () => {
    const owner = await startOwner();
    const peer = await rawConnect(owner.stateDir);
    const hello = helloFrom(OMO);
    peer.send(hello);
    await peer.next();
    peer.send({
      id: "a",
      type: "authenticate",
      client_proof: clientProof(owner.token, hello.client_nonce, peer.endpoint),
    });
    expect(await peer.next()).toMatchObject({
      id: "a",
      ok: false,
      error: { code: "client_proof_invalid" },
    });
    await peer.closed;
  });

  test("a client_proof computed for port A is refused by the owner on port B (a forwarder through a squatted old port)", async () => {
    const owner = await startOwner();
    const peer = await rawConnect(owner.stateDir);
    peer.send(helloFrom(OMO));
    const nonce = String(Reflect.get(Object(await peer.next()), "server_nonce"));
    const portA = 49_152;
    const elsewhere = tcpEndpoint(peer.endpoint === tcpEndpoint(portA) ? portA + 1 : portA);
    peer.send({
      id: "a",
      type: "authenticate",
      client_proof: clientProof(owner.token, nonce, elsewhere),
    });
    expect(await peer.next()).toMatchObject({
      id: "a",
      ok: false,
      error: { code: "client_proof_invalid" },
    });
    await peer.closed;
    const control = await rawConnect(owner.stateDir);
    control.send(helloFrom(OMO));
    const fresh = String(Reflect.get(Object(await control.next()), "server_nonce"));
    control.send({
      id: "a",
      type: "authenticate",
      client_proof: clientProof(owner.token, fresh, control.endpoint),
    });
    expect(await control.next()).toMatchObject({ id: "a", ok: true });
  });
});
