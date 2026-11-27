import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sodium, { ready } from "libsodium-wrappers";
import { secretOps } from "../src/secrets.ts";
import { fakeGitHub, json, on, type Seen } from "./fake.ts";

const VALUE = "s3cr3t-value-never-echoed";
let pair: { publicKey: Uint8Array; privateKey: Uint8Array };
let dir: string | undefined;

beforeAll(async () => {
  await ready;
  pair = sodium.crypto_box_keypair();
});
afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

const publicKey = () =>
  json({
    key_id: "kid-1",
    key: Buffer.from(pair.publicKey).toString("base64"),
  });
const opened = (req: Seen | undefined) =>
  new TextDecoder().decode(
    sodium.crypto_box_seal_open(
      Buffer.from(
        String(Reflect.get(Object(req?.body), "encrypted_value")),
        "base64",
      ),
      pair.publicKey,
      pair.privateKey,
    ),
  );
const kindOf = (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e: unknown) => String(Reflect.get(Object(e), "kind")),
  );
const path = (req: Seen | undefined) =>
  new URL(req?.url ?? "http://x/").pathname;

describe("secrets", () => {
  test("set seals the value with the repo's public key and never returns or sends it in clear", async () => {
    const { gh, seen } = fakeGitHub([
      on(
        "GET",
        /\/repos\/acme\/widgets\/actions\/secrets\/public-key$/,
        publicKey,
      ),
      on(
        "PUT",
        /\/repos\/acme\/widgets\/actions\/secrets\/API_KEY$/,
        () => new Response(null, { status: 201 }),
      ),
    ]);
    const res = await secretOps(gh).set.invoke({
      name: "API_KEY",
      value: VALUE,
    });
    expect(res).toEqual({
      repo: "acme/widgets",
      app: "actions",
      name: "API_KEY",
    });
    const put = seen[1];
    expect(Reflect.get(Object(put?.body), "key_id")).toBe("kid-1");
    expect(opened(put)).toBe(VALUE);
    expect(JSON.stringify(seen.map((r) => r.body))).not.toContain(VALUE);
    expect(JSON.stringify(res)).not.toContain(VALUE);
  });

  test("set reads the value's bytes from a file", async () => {
    dir = await mkdtemp(join(tmpdir(), "secret-"));
    const file = join(dir, "v.txt");
    await writeFile(file, "from-file\n");
    const { gh, seen } = fakeGitHub([
      on("GET", /\/dependabot\/secrets\/public-key$/, publicKey),
      on(
        "PUT",
        /\/repos\/acme\/widgets\/dependabot\/secrets\/T$/,
        () => new Response(null, { status: 204 }),
      ),
    ]);
    await secretOps(gh).set.invoke({ name: "T", file, app: "dependabot" });
    expect(opened(seen[1])).toBe("from-file\n");
  });

  test("an org secret limited to selected repos resolves their ids", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /^\/repos\/acme\/api$/, () => json({ id: 11 })),
      on("GET", /^\/repos\/other\/web$/, () => json({ id: 22 })),
      on("GET", /\/orgs\/acme\/actions\/secrets\/public-key$/, publicKey),
      on(
        "PUT",
        /\/orgs\/acme\/actions\/secrets\/TOKEN$/,
        () => new Response(null, { status: 201 }),
      ),
    ]);
    const res = await secretOps(gh).set.invoke({
      name: "TOKEN",
      org: "acme",
      value: VALUE,
      repos: ["api", "other/web"],
    });
    expect(res).toEqual({ org: "acme", app: "actions", name: "TOKEN" });
    const body = seen.at(-1)?.body;
    expect(Reflect.get(Object(body), "visibility")).toBe("selected");
    expect(Reflect.get(Object(body), "selected_repository_ids")).toEqual([
      11, 22,
    ]);
    expect(opened(seen.at(-1))).toBe(VALUE);
  });

  test("an org secret defaults to private visibility", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /public-key$/, publicKey),
      on(
        "PUT",
        /\/orgs\/acme\/codespaces\/secrets\/X$/,
        () => new Response(null, { status: 201 }),
      ),
    ]);
    await secretOps(gh).set.invoke({
      name: "X",
      org: "acme",
      app: "codespaces",
      value: VALUE,
    });
    expect(Reflect.get(Object(seen[1]?.body), "visibility")).toBe("private");
  });

  test("environment and user scopes use their own endpoints", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /public-key$/, publicKey),
      on("PUT", /./, () => new Response(null, { status: 201 })),
    ]);
    const ops = secretOps(gh);
    expect(
      await ops.set.invoke({ name: "A", env: "prod east", value: VALUE }),
    ).toEqual({
      repo: "acme/widgets",
      env: "prod east",
      app: "actions",
      name: "A",
    });
    expect(path(seen[1])).toBe(
      "/repos/acme/widgets/environments/prod%20east/secrets/A",
    );
    expect(
      await ops.set.invoke({ name: "B", user: true, value: VALUE }),
    ).toEqual({
      user: true,
      app: "codespaces",
      name: "B",
    });
    expect(path(seen[2])).toBe("/user/codespaces/secrets/public-key");
    expect(path(seen[3])).toBe("/user/codespaces/secrets/B");
  });

  test("bad input combinations fail as usage before any request", async () => {
    const { gh, seen } = fakeGitHub([]);
    const ops = secretOps(gh);
    const cases = [
      { name: "A" },
      { name: "A", value: VALUE, file: "/x" },
      { name: "A", value: VALUE, env: "e", org: "o" },
      { name: "A", value: VALUE, env: "e", app: "dependabot" as const },
      { name: "A", value: VALUE, user: true, app: "actions" as const },
      { name: "A", value: VALUE, visibility: "all" as const },
      {
        name: "A",
        value: VALUE,
        org: "o",
        visibility: "all" as const,
        repos: ["r"],
      },
      { name: "A", value: VALUE, user: true, repos: ["bare"] },
      { name: "A", file: "/definitely/not/here" },
    ];
    for (const input of cases)
      expect(await kindOf(ops.set.invoke(input))).toBe("usage");
    expect(seen).toHaveLength(0);
  });

  test("a malformed public key fails without leaking the value", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /public-key$/, () => json({ key_id: "k", key: "AAAA" })),
    ]);
    const error = await secretOps(gh)
      .set.invoke({ name: "A", value: VALUE })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(Reflect.get(Object(error), "kind")).toBe("invalid_response");
    expect(String(Reflect.get(Object(error), "message"))).not.toContain(VALUE);
    expect(seen).toHaveLength(1);
  });

  test("list returns names and timestamps for the chosen store", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /\/orgs\/acme\/dependabot\/secrets/, () =>
        json({
          total_count: 1,
          secrets: [
            {
              name: "NPM",
              created_at: "c",
              updated_at: "u",
              visibility: "all",
              selected_repositories_url: "x",
            },
          ],
        }),
      ),
    ]);
    const res = await secretOps(gh).list.invoke({
      org: "acme",
      app: "dependabot",
    });
    expect(res).toEqual({
      org: "acme",
      app: "dependabot",
      items: [
        { name: "NPM", createdAt: "c", updatedAt: "u", visibility: "all" },
      ],
    });
    expect(seen[0]?.method).toBe("GET");
  });

  test("delete removes the secret at its scope", async () => {
    const { gh, seen } = fakeGitHub([
      on(
        "DELETE",
        /\/repos\/acme\/widgets\/actions\/secrets\/OLD$/,
        () => new Response(null, { status: 204 }),
      ),
    ]);
    expect(await secretOps(gh).delete.invoke({ name: "OLD" })).toEqual({
      repo: "acme/widgets",
      app: "actions",
      name: "OLD",
      deleted: true,
    });
    expect(seen).toHaveLength(1);
  });
});
