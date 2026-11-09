import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";
import { mintNonce, serverProof, tcpEndpoint, writeToken } from "../../src/local-api/access.ts";
import { connectLocalApi, HANDSHAKE_TIMEOUT_MS, type HandshakeTimer } from "../../src/local-api/client.ts";
import { CAPABILITIES } from "../../src/local-api/protocol.ts";
import { connectLocal, type Transport } from "../../src/local-api/transport.ts";
import type { RawPeer } from "./conformance/raw-peer.ts";
import { rejectionOf } from "./conformance/rejection.ts";
import { defaultWorld } from "./conformance/world.ts";
import {
  cleanup,
  deviceKeys,
  freshStateDir,
  halfOpenServer,
  OMO,
  scriptServer,
  serveHandshake,
  startOwner,
  typeOf,
  testSecure,
} from "./support.ts";

afterEach(cleanup);

const welcomeWith = (peer: RawPeer, key: Uint8Array, hello: unknown): void =>
  peer.send({
    type: "welcome",
    v: 1,
    service_version: "1.4.0",
    owner: "service",
    server_proof: serverProof(
      key,
      String(Reflect.get(Object(hello), "client_nonce")),
      peer.endpoint,
    ),
    server_nonce: mintNonce(),
    capabilities: [...CAPABILITIES],
    state: defaultWorld().status,
  });

describe("LA3 a squatting server that cannot prove the token", () => {
  test("a wrong server_proof makes the client disconnect without sending device.adopt or anything else", async () => {
    const stateDir = freshStateDir();
    await writeToken(stateDir, testSecure);
    const { received } = await scriptServer(stateDir, async (peer) => {
      welcomeWith(peer, randomBytes(32), await peer.next());
    });
    const connecting = connectLocalApi({ stateDir, client: OMO });
    expect(await rejectionOf(connecting)).toMatchObject({ code: "server_proof_invalid" });
    expect((await received).map(typeOf)).toEqual(["hello"]);
  });

  test("control: the same server with the real token gets the client's authenticate and then device.adopt", async () => {
    const stateDir = freshStateDir();
    const token = await writeToken(stateDir, testSecure);
    const { received } = await scriptServer(stateDir, async (peer) => {
      welcomeWith(peer, token, await peer.next());
      const auth = await peer.next();
      peer.send({ id: Reflect.get(Object(auth), "id"), type: "response", ok: true, data: {} });
      const adopt = await peer.next();
      peer.send({
        id: Reflect.get(Object(adopt), "id"),
        type: "response",
        ok: true,
        data: { device: { id: "d", name: "n" } },
      });
    });
    const client = await connectLocalApi({ stateDir, client: OMO });
    const keys = deviceKeys();
    await client.request("device.adopt", {
      device: { id: "d", name: "n" },
      signing_private_key: keys.signing,
      sealing_private_key: keys.sealing,
    });
    client.close();
    expect((await received).map(typeOf)).toEqual(["hello", "authenticate", "device.adopt"]);
  });

  test("a server that accepts and never answers fails the handshake with handshake_timeout and is disconnected", async () => {
    const stateDir = freshStateDir();
    await writeToken(stateDir, testSecure);
    let heardHello = (): void => {};
    const hello = new Promise<void>((resolve) => {
      heardHello = resolve;
    });
    const { received } = await scriptServer(stateDir, async (peer) => {
      await peer.next();
      heardHello();
    });
    const armed: { readonly ms: number; readonly expire: () => void }[] = [];
    const timer: HandshakeTimer = (expire, ms) => {
      armed.push({ ms, expire });
      return () => {};
    };
    let settled = false;
    const connecting = connectLocalApi({ stateDir, client: OMO, handshakeTimer: timer });
    void connecting.then(
      () => (settled = true),
      () => (settled = true),
    );
    await hello;
    expect(settled).toBe(false);
    expect(armed.map((entry) => entry.ms)).toEqual([HANDSHAKE_TIMEOUT_MS]);
    expect(HANDSHAKE_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
    armed[0]?.expire();
    expect(await rejectionOf(connecting)).toMatchObject({ code: "handshake_timeout" });
    expect((await received).map(typeOf)).toEqual(["hello"]);
  });

  test("a handshake that completes cancels its timer", async () => {
    const stateDir = freshStateDir();
    const token = await writeToken(stateDir, testSecure);
    await scriptServer(stateDir, async (peer) => {
      welcomeWith(peer, token, await peer.next());
      const auth = await peer.next();
      peer.send({ id: Reflect.get(Object(auth), "id"), type: "response", ok: true, data: {} });
    });
    let cancelled = 0;
    const client = await connectLocalApi({
      stateDir,
      client: OMO,
      handshakeTimer: () => () => {
        cancelled += 1;
      },
    });
    client.close();
    expect(cancelled).toBe(1);
  });

  test("a client that reached the owner through another port (a forwarder) refuses its server_proof", async () => {
    const owner = await startOwner();
    const portA = 49_152;
    const transport = async (): Promise<Transport> => {
      const real = await connectLocal(owner.stateDir);
      const elsewhere = tcpEndpoint(real.endpoint === tcpEndpoint(portA) ? portA + 1 : portA);
      return { ...real, endpoint: elsewhere };
    };
    const connecting = connectLocalApi({ stateDir: owner.stateDir, client: OMO, transport });
    expect(await rejectionOf(connecting)).toMatchObject({ code: "server_proof_invalid" });
    expect(owner.state.log).toEqual([]);
  });

  test("a handshake timeout destroys the socket even when the endpoint never sends FIN", async () => {
    const stateDir = freshStateDir();
    await writeToken(stateDir, testSecure);
    let heardHello = (): void => {};
    const hello = new Promise<void>((resolve) => {
      heardHello = resolve;
    });
    await halfOpenServer(stateDir, async (peer) => {
      await peer.next();
      heardHello();
    });
    const transports: Transport[] = [];
    let expire = (): void => {};
    const connecting = connectLocalApi({
      stateDir,
      client: OMO,
      transport: async () => {
        const opened = await connectLocal(stateDir);
        transports.push(opened);
        return opened;
      },
      handshakeTimer: (fire) => {
        expire = fire;
        return () => {};
      },
    });
    await hello;
    const ended = new Promise<void>((resolve) => transports[0]?.onClose(resolve));
    expire();
    expect(await rejectionOf(connecting)).toMatchObject({ code: "handshake_timeout" });
    await ended;
  });

  const failedProofSteps: readonly (readonly [
    string,
    string,
    (peer: RawPeer, token: Uint8Array) => Promise<void>,
  ])[] = [
    [
      "a wrong server_proof",
      "server_proof_invalid",
      async (peer) => welcomeWith(peer, randomBytes(32), await peer.next()),
    ],
    [
      "a refusal",
      "refused",
      async (peer) => {
        await peer.next();
        peer.send({ type: "refused", reason: "version" });
      },
    ],
    [
      "a failed authenticate",
      "unauthenticated",
      async (peer, token) => {
        welcomeWith(peer, token, await peer.next());
        const auth = await peer.next();
        peer.send({
          id: Reflect.get(Object(auth), "id"),
          type: "response",
          ok: false,
          error: { code: "unauthenticated", reason: "no", action: null },
        });
      },
    ],
  ];
  test.each(failedProofSteps)(
    "a failed proof step (%s) destroys the socket even when the endpoint never sends FIN",
    async (name, code, answer) => {
      const stateDir = freshStateDir();
      const token = await writeToken(stateDir, testSecure);
      await halfOpenServer(stateDir, (peer) => answer(peer, token));
      const transports: Transport[] = [];
      const connecting = connectLocalApi({
        stateDir,
        client: OMO,
        transport: async () => {
          const opened = await connectLocal(stateDir);
          transports.push(opened);
          return opened;
        },
      });
      const failure = await rejectionOf(connecting);
      expect([name, failure]).toMatchObject([name, { code }]);
      // The endpoint never sends FIN, so only a client that destroyed its socket sees it close.
      await new Promise<void>((resolve) => transports[0]?.onClose(resolve));
    },
  );

  test("a protocol violation after the handshake destroys the socket even when the endpoint never sends FIN", async () => {
    const stateDir = freshStateDir();
    const token = await writeToken(stateDir, testSecure);
    await halfOpenServer(stateDir, async (peer) => {
      await serveHandshake(peer, token);
      peer.send({ type: "neither" });
    });
    const client = await connectLocalApi({ stateDir, client: OMO });
    await client.closed;
    expect(client.oversizedLines()).toBe(0);
  });
});
