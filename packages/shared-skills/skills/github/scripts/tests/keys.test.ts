import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gpgKeyOps, sshKeyOps } from "../src/keys.ts";
import { fakeGitHub, json, on } from "./fake.ts";

const SSH = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample user@host";
const ARMOR =
  "-----BEGIN PGP PUBLIC KEY BLOCK-----\nabc\n-----END PGP PUBLIC KEY BLOCK-----";
const gpg = {
  id: 3,
  key_id: "ABCDEF0123456789",
  name: "laptop",
  emails: [{ email: "a@b.c", verified: true }],
  can_sign: true,
  created_at: "c",
  expires_at: null,
  raw_key: "ignored",
};
const kindOf = (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e: unknown) => String(Reflect.get(Object(e), "kind")),
  );
let dir: string | undefined;
afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("ssh keys", () => {
  test("list merges authentication and signing keys with their type", async () => {
    const { gh } = fakeGitHub([
      on("GET", /^\/user\/keys/, () =>
        json([
          { id: 1, key: SSH, title: "a", created_at: "c", verified: true },
        ]),
      ),
      on("GET", /^\/user\/ssh_signing_keys/, () =>
        json([{ id: 9, key: SSH, title: "s", created_at: "d" }]),
      ),
    ]);
    expect(await sshKeyOps(gh).list.invoke({})).toEqual({
      items: [
        { id: 1, type: "authentication", title: "a", key: SSH, createdAt: "c" },
        { id: 9, type: "signing", title: "s", key: SSH, createdAt: "d" },
      ],
    });
  });

  test("add posts a signing key read from a file, trimmed", async () => {
    dir = await mkdtemp(join(tmpdir(), "sshkey-"));
    const file = join(dir, "id.pub");
    await writeFile(file, `${SSH}\n`);
    const { gh, seen } = fakeGitHub([
      on("POST", /^\/user\/ssh_signing_keys$/, () =>
        json({ id: 9, key: SSH, title: "sig", created_at: "d" }, 201),
      ),
    ]);
    const res = await sshKeyOps(gh).add.invoke({
      file,
      title: "sig",
      type: "signing",
    });
    expect(seen[0]?.body).toEqual({ key: SSH, title: "sig" });
    expect(res).toEqual({
      id: 9,
      type: "signing",
      title: "sig",
      key: SSH,
      createdAt: "d",
    });
  });

  test("add defaults to an authentication key and needs exactly one of key and file", async () => {
    const { gh, seen } = fakeGitHub([
      on("POST", /^\/user\/keys$/, () =>
        json({ id: 2, key: SSH, title: null, created_at: "c" }, 201),
      ),
    ]);
    const ops = sshKeyOps(gh);
    expect((await ops.add.invoke({ key: SSH })).type).toBe("authentication");
    expect(seen[0]?.body).toEqual({ key: SSH });
    expect(await kindOf(ops.add.invoke({}))).toBe("usage");
    expect(await kindOf(ops.add.invoke({ key: SSH, file: "/x" }))).toBe(
      "usage",
    );
    expect(seen).toHaveLength(1);
  });

  test("delete targets the list of the given type", async () => {
    const { gh, seen } = fakeGitHub([
      on(
        "DELETE",
        /^\/user\/(keys|ssh_signing_keys)\/\d+$/,
        () => new Response(null, { status: 204 }),
      ),
    ]);
    const ops = sshKeyOps(gh);
    expect(await ops.delete.invoke({ id: 1 })).toEqual({
      id: 1,
      type: "authentication",
      deleted: true,
    });
    await ops.delete.invoke({ id: 9, type: "signing" });
    expect(seen.map((r) => new URL(r.url).pathname)).toEqual([
      "/user/keys/1",
      "/user/ssh_signing_keys/9",
    ]);
  });
});

describe("gpg keys", () => {
  const trimmed = {
    id: 3,
    keyId: "ABCDEF0123456789",
    name: "laptop",
    emails: [{ email: "a@b.c", verified: true }],
    canSign: true,
    createdAt: "c",
    expiresAt: null,
  };

  test("list trims each key", async () => {
    const { gh } = fakeGitHub([
      on("GET", /^\/user\/gpg_keys/, () => json([gpg])),
    ]);
    expect(await gpgKeyOps(gh).list.invoke({})).toEqual({ items: [trimmed] });
  });

  test("add sends the armored key and the title as name", async () => {
    const { gh, seen } = fakeGitHub([
      on("POST", /^\/user\/gpg_keys$/, () => json(gpg, 201)),
    ]);
    expect(
      await gpgKeyOps(gh).add.invoke({ key: ARMOR, title: "laptop" }),
    ).toEqual(trimmed);
    expect(seen[0]?.body).toEqual({
      armored_public_key: ARMOR,
      name: "laptop",
    });
  });

  test("add from a missing file is a usage error with no request", async () => {
    const { gh, seen } = fakeGitHub([]);
    expect(
      await kindOf(gpgKeyOps(gh).add.invoke({ file: "/no/such/key.asc" })),
    ).toBe("usage");
    expect(seen).toHaveLength(0);
  });

  test("delete removes a key by id", async () => {
    const { gh, seen } = fakeGitHub([
      on(
        "DELETE",
        /^\/user\/gpg_keys\/3$/,
        () => new Response(null, { status: 204 }),
      ),
    ]);
    expect(await gpgKeyOps(gh).delete.invoke({ id: 3 })).toEqual({
      id: 3,
      deleted: true,
    });
    expect(seen).toHaveLength(1);
  });
});

describe("a token without the key scope", () => {
  test("the 404 GitHub answers becomes forbidden and names the scope", async () => {
    const { gh } = fakeGitHub([
      on("GET", /^\/user\/(keys|gpg_keys)/, () =>
        json({ message: "Not Found" }, 404),
      ),
    ]);
    const failure = async (p: Promise<unknown>) =>
      p.then(
        () => undefined,
        (e: unknown) => ({
          kind: Reflect.get(Object(e), "kind"),
          scoped: String(Reflect.get(Object(e), "hint")).includes("read:"),
        }),
      );
    expect(await failure(sshKeyOps(gh).list.invoke({}))).toEqual({
      kind: "forbidden",
      scoped: true,
    });
    expect(await failure(gpgKeyOps(gh).list.invoke({}))).toEqual({
      kind: "forbidden",
      scoped: true,
    });
  });
});
