import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { rejectionOf } from "./conformance/rejection.ts";
import {
  cleanup,
  connectClient,
  desktop,
  helloFrom,
  INSTALLER,
  OMO,
  rawConnect,
  startOwner,
} from "./support.ts";

afterEach(cleanup);

const SRC = join(import.meta.dir, "..", "..", "src", "local-api");
const DOCS = join(import.meta.dir, "..", "..", "docs", "local-api.md");

describe("LA18 owner.shutdown_for_upgrade only from an installer after its proof; the vocabulary gate", () => {
  test("a desktop or omo client is refused forbidden; an installer before its proof is refused unauthenticated", async () => {
    const owner = await startOwner();
    const app = await connectClient(owner, desktop("/home/user/.config/omo"));
    const cli = await connectClient(owner, OMO);
    for (const client of [app, cli])
      expect(
        await rejectionOf(
          client.request("owner.shutdown_for_upgrade", { target_version: "1.5.0" }),
        ),
      ).toMatchObject({ code: "forbidden" });
    const peer = await rawConnect(owner.stateDir);
    peer.send(helloFrom(INSTALLER));
    await peer.next();
    peer.send({ id: "x", type: "owner.shutdown_for_upgrade", target_version: "1.5.0" });
    expect(await peer.next()).toMatchObject({
      id: "x",
      ok: false,
      error: { code: "unauthenticated" },
    });
    expect(await cli.request("status.get", {})).toMatchObject({ state: "connected" });
  });

  test("an installer after its proof stops the owner: every client is closed and the endpoint stops listening", async () => {
    const owner = await startOwner();
    const app = await connectClient(owner, desktop("/home/user/.config/omo"));
    const installer = await connectClient(owner, INSTALLER);
    expect(
      await installer.request("owner.shutdown_for_upgrade", { target_version: "1.5.0" }),
    ).toEqual({});
    await installer.closed;
    await app.closed;
    expect(await rejectionOf(connectClient(owner))).toBeInstanceOf(Error);
  });

  test("docs/local-api.md names every message type of protocol.ts", () => {
    const protocol = readFileSync(join(SRC, "protocol.ts"), "utf8");
    const types = [
      ...new Set([...protocol.matchAll(/type: "([a-z._]*)"/g)].map((m) => m[1] ?? "")),
    ];
    const docs = readFileSync(DOCS, "utf8");
    expect(types.length).toBeGreaterThanOrEqual(24);
    expect(types.filter((t) => !docs.includes(`\`${t}\``))).toEqual([]);
  });
});
