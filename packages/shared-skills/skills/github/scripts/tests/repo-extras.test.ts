import { describe, expect, test } from "bun:test";
import { repoExtraOps } from "../src/repo-extras.ts";
import { fakeGitHub, json, on } from "./fake.ts";
import { calls } from "./repo-fixture.ts";

const link = {
  id: 5,
  key_prefix: "T-",
  url_template: "https://t.example/<num>",
  is_alphanumeric: false,
};
const key = {
  id: 9,
  title: "ci",
  key: "ssh-ed25519 AAAA",
  read_only: true,
  created_at: "2026-01-01T00:00:00Z",
};
const gone = () => new Response(null, { status: 204 });

describe("repo autolink", () => {
  test("list, view, create and delete hit the autolinks endpoints", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /\/autolinks$/, () => json([link])),
      on("GET", /\/autolinks\/5$/, () => json(link)),
      on("POST", /\/autolinks$/, () => json(link, 201)),
      on("DELETE", /\/autolinks\/5$/, gone),
    ]);
    const ops = repoExtraOps(gh).autolink;
    const mapped = {
      id: 5,
      keyPrefix: "T-",
      urlTemplate: "https://t.example/<num>",
      alphanumeric: false,
    };
    expect(await ops.list.invoke({})).toEqual({
      repo: "acme/widgets",
      items: [mapped],
    });
    expect(await ops.view.invoke({ id: 5 })).toEqual({
      repo: "acme/widgets",
      ...mapped,
    });
    await ops.create.invoke({
      keyPrefix: "T-",
      urlTemplate: "https://t.example/<num>",
      numeric: true,
    });
    expect(seen[2]?.body).toEqual({
      key_prefix: "T-",
      url_template: "https://t.example/<num>",
      is_alphanumeric: false,
    });
    expect(await ops.delete.invoke({ id: 5 })).toEqual({
      repo: "acme/widgets",
      id: 5,
      deleted: true,
    });
    expect(calls(seen)).toEqual([
      "GET /repos/acme/widgets/autolinks",
      "GET /repos/acme/widgets/autolinks/5",
      "POST /repos/acme/widgets/autolinks",
      "DELETE /repos/acme/widgets/autolinks/5",
    ]);
  });
});

describe("repo deployKey", () => {
  test("list pages the keys; add is read-only unless allowWrite; delete removes by id", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /\/keys\?per_page=100$/, () => json([key])),
      on("POST", /\/keys$/, () => json({ ...key, read_only: false }, 201)),
      on("DELETE", /\/keys\/9$/, gone),
    ]);
    const ops = repoExtraOps(gh).deployKey;
    const mapped = {
      id: 9,
      title: "ci",
      key: "ssh-ed25519 AAAA",
      readOnly: true,
      createdAt: "2026-01-01T00:00:00Z",
    };
    expect(await ops.list.invoke({})).toEqual({
      repo: "acme/widgets",
      items: [mapped],
    });
    const added = await ops.add.invoke({
      key: "ssh-ed25519 AAAA\n",
      title: "ci",
      allowWrite: true,
    });
    expect(seen[1]?.body).toEqual({
      key: "ssh-ed25519 AAAA",
      read_only: false,
      title: "ci",
    });
    expect(added.readOnly).toBe(false);
    await ops.add.invoke({ key: "ssh-ed25519 BBBB" });
    expect(seen[2]?.body).toEqual({ key: "ssh-ed25519 BBBB", read_only: true });
    expect(await ops.delete.invoke({ id: 9 })).toEqual({
      repo: "acme/widgets",
      id: 9,
      deleted: true,
    });
    expect(calls(seen).at(-1)).toBe("DELETE /repos/acme/widgets/keys/9");
  });
});

describe("gitignore and license catalogs", () => {
  test("gitignore list and view", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /^\/gitignore\/templates$/, () => json(["Go", "Node"])),
      on("GET", /^\/gitignore\/templates\/Node$/, () =>
        json({ name: "Node", source: "node_modules\n" }),
      ),
    ]);
    const ops = repoExtraOps(gh).gitignore;
    expect(await ops.list.invoke({})).toEqual({ items: ["Go", "Node"] });
    expect(await ops.view.invoke({ name: "Node" })).toEqual({
      name: "Node",
      source: "node_modules\n",
    });
    expect(seen).toHaveLength(2);
  });

  test("license list, and view by SPDX id lowercased to the key", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /^\/licenses$/, () =>
        json([{ key: "mit", name: "MIT License", spdx_id: "MIT" }]),
      ),
      on("GET", /^\/licenses\/apache-2\.0$/, () =>
        json({
          key: "apache-2.0",
          name: "Apache License 2.0",
          spdx_id: "Apache-2.0",
          description: "d",
          implementation: "i",
          permissions: ["commercial-use"],
          conditions: ["include-copyright"],
          limitations: ["liability"],
          body: "Apache License",
          html_url: "http://choosealicense.com/licenses/apache-2.0/",
        }),
      ),
    ]);
    const ops = repoExtraOps(gh).license;
    expect(await ops.list.invoke({})).toEqual({
      items: [{ key: "mit", name: "MIT License", spdxId: "MIT" }],
    });
    expect(await ops.view.invoke({ license: "Apache-2.0" })).toEqual({
      key: "apache-2.0",
      name: "Apache License 2.0",
      spdxId: "Apache-2.0",
      description: "d",
      implementation: "i",
      permissions: ["commercial-use"],
      conditions: ["include-copyright"],
      limitations: ["liability"],
      body: "Apache License",
      url: "http://choosealicense.com/licenses/apache-2.0/",
    });
    expect(calls(seen)).toEqual(["GET /licenses", "GET /licenses/apache-2.0"]);
  });
});
