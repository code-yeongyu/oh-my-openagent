import { chmodSync, existsSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { posixSecureFile } from "../../src/local-api/access.ts";
import { connectLocalApi } from "../../src/local-api/client.ts";
import { rejectionOf } from "./conformance/rejection.ts";
import { cleanup, connectClient, freshStateDir, OMO, startOwner } from "./support.ts";

afterEach(cleanup);

const posixOnly = test.skipIf(process.platform === "win32");

describe("LA6 an insecure state dir is refused", () => {
  posixOnly(
    "a state dir with group or world bits is refused before any connection is opened",
    async () => {
      const owner = await startOwner();
      chmodSync(owner.stateDir, 0o755);
      expect(await rejectionOf(connectClient(owner))).toMatchObject({ code: "insecure_state_dir" });
      expect(owner.connections()).toBe(0);
      chmodSync(owner.stateDir, 0o700);
      await connectClient(owner);
      expect(owner.connections()).toBe(1);
    },
  );

  posixOnly("a socket or token readable by others is refused", async () => {
    const owner = await startOwner();
    chmodSync(join(owner.stateDir, "service.sock"), 0o666);
    expect(await rejectionOf(connectClient(owner))).toMatchObject({ code: "insecure_state_dir" });
    chmodSync(join(owner.stateDir, "service.sock"), 0o600);
    chmodSync(join(owner.stateDir, "token"), 0o644);
    expect(await rejectionOf(connectClient(owner))).toMatchObject({ code: "insecure_state_dir" });
    expect(owner.connections()).toBe(0);
  });

  posixOnly("a state dir reached through a symlink is refused", async () => {
    const owner = await startOwner();
    const parent = freshStateDir();
    const link = join(parent, "link");
    symlinkSync(owner.stateDir, link);
    const connecting = connectLocalApi({ stateDir: link, client: OMO });
    expect(await rejectionOf(connecting)).toMatchObject({ code: "insecure_state_dir" });
    expect(owner.connections()).toBe(0);
  });

  posixOnly("a missing state dir is refused without creating it", async () => {
    const missing = join(freshStateDir(), "absent");
    expect(await rejectionOf(connectLocalApi({ stateDir: missing, client: OMO }))).toMatchObject({
      code: "insecure_state_dir",
    });
    expect(existsSync(missing)).toBe(false);
  });

  posixOnly(
    "securing a path that is a symlink refuses it without changing the target's mode",
    async () => {
      const target = freshStateDir();
      chmodSync(target, 0o755);
      const link = join(freshStateDir(), "link");
      symlinkSync(target, link);
      expect(await rejectionOf(posixSecureFile(link, "dir"))).toMatchObject({
        code: "insecure_state_dir",
      });
      expect(statSync(target).mode & 0o777).toBe(0o755);
    },
  );
});
