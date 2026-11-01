import { afterEach, describe, expect, test } from "bun:test";
import { readToken } from "../../src/local-api/access.ts";
import { connectLocalApi } from "../../src/local-api/client.ts";
import { rejectionOf } from "./conformance/rejection.ts";
import { defaultWorld } from "./conformance/world.ts";
import { cleanup, connectClient, freshStateDir, OMO, startOwner } from "./support.ts";

afterEach(cleanup);

describe("LA5 a stale token is re-read", () => {
  test("after the owner restarts with a new per-boot token, a client re-reads it and connects", async () => {
    const stateDir = freshStateDir();
    const first = await startOwner(defaultWorld(), stateDir);
    const before = await connectClient(first);
    before.close();
    const stale = readToken(stateDir);
    await first.stop();

    const second = await startOwner(defaultWorld(), stateDir);
    expect(Buffer.from(second.token).equals(Buffer.from(stale))).toBe(false);
    const after = await connectClient(second);
    expect(await after.request("status.get", {})).toMatchObject({ state: "connected" });
  });

  test("control: a client that keeps the previous token cannot verify the restarted owner", async () => {
    const stateDir = freshStateDir();
    const first = await startOwner(defaultWorld(), stateDir);
    const stale = readToken(stateDir);
    await first.stop();
    await startOwner(defaultWorld(), stateDir);
    const connecting = connectLocalApi({ stateDir, client: OMO, readToken: () => stale });
    expect(await rejectionOf(connecting)).toMatchObject({ code: "server_proof_invalid" });
  });
});
