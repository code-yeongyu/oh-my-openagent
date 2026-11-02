import { afterEach, describe, expect, test } from "bun:test";
import { mintNonce, serverProof, writeToken } from "../../src/local-api/access.ts";
import { connectLocalApi } from "../../src/local-api/client.ts";
import { CAPABILITIES } from "../../src/local-api/protocol.ts";
import { rejectionOf } from "./conformance/rejection.ts";
import { defaultWorld } from "./conformance/world.ts";
import {
  cleanup,
  freshStateDir,
  helloFrom,
  OMO,
  rawConnect,
  scriptServer,
  startOwner,
  typeOf,
  testSecure,
} from "./support.ts";

afterEach(cleanup);

describe("LA1 version refusal", () => {
  test("a hello with v 2 is refused 'version' and the owner closes the connection", async () => {
    const owner = await startOwner();
    const peer = await rawConnect(owner.stateDir);
    peer.send({ ...helloFrom(OMO), v: 2 });
    expect(await peer.next()).toEqual({ type: "refused", reason: "version" });
    await peer.closed;
    expect(owner.state.log).toEqual([]);
  });

  test("a client refuses a welcome of another version and sends nothing after its hello", async () => {
    const stateDir = freshStateDir();
    const token = await writeToken(stateDir, testSecure);
    const { received } = await scriptServer(stateDir, async (peer) => {
      const hello = await peer.next();
      peer.send({
        type: "welcome",
        v: 2,
        service_version: "9.0.0",
        owner: "service",
        server_proof: serverProof(
          token,
          String(Reflect.get(Object(hello), "client_nonce")),
          peer.endpoint,
        ),
        server_nonce: mintNonce(),
        capabilities: [...CAPABILITIES],
        state: defaultWorld().status,
      });
    });
    expect(await rejectionOf(connectLocalApi({ stateDir, client: OMO }))).toMatchObject({
      code: "refused",
      reason: "version",
    });
    expect((await received).map(typeOf)).toEqual(["hello"]);
  });
});
