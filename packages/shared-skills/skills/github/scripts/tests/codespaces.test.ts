import { describe, expect, test } from "bun:test";
import { codespaceOps } from "../src/codespaces.ts";
import { fakeGitHub, json, on } from "./fake.ts";

const space = (name: string, repo = "acme/widgets") => ({
  name,
  display_name: `${name} display`,
  state: "Available",
  owner: { login: "octo" },
  repository: { full_name: repo },
  git_status: {
    ref: "main",
    ahead: 1,
    behind: 0,
    has_unpushed_changes: true,
    has_uncommitted_changes: false,
  },
  machine: { name: "standardLinux32gb" },
  location: "WestUs2",
  devcontainer_path: null,
  idle_timeout_minutes: 30,
  retention_expires_at: null,
  created_at: "2026-01-01T00:00:00Z",
  last_used_at: "2026-01-02T00:00:00Z",
  web_url: `https://${name}.github.dev`,
});

const kind = (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e: unknown) => String(Reflect.get(Object(e), "kind")),
  );
const pathOf = (url: string) => new URL(url).pathname + new URL(url).search;

describe("codespaceOps", () => {
  test("list picks the user, repository or org endpoint and reads the wrapped page", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /^\/user\/codespaces/, () =>
        json({ total_count: 1, codespaces: [space("a")] }),
      ),
      on("GET", /^\/repos\/acme\/widgets\/codespaces/, () =>
        json({ total_count: 1, codespaces: [space("b")] }),
      ),
      on("GET", /^\/orgs\/acme\/members\/bob\/codespaces/, () =>
        json({
          total_count: 2,
          codespaces: [space("c"), space("d", "acme/other")],
        }),
      ),
    ]);
    const ops = codespaceOps(gh);
    const mine = await ops.list.invoke({});
    expect(mine).toEqual({
      items: [
        expect.objectContaining({
          name: "a",
          branch: "main",
          unpushedChanges: true,
          machine: "standardLinux32gb",
        }),
      ],
    });
    expect(
      await ops.list.invoke({ repo: "acme/widgets", limit: 5 }),
    ).toMatchObject({ repo: "acme/widgets", items: [{ name: "b" }] });
    const member = await ops.list.invoke({
      org: "acme",
      user: "bob",
      repo: "acme/widgets",
    });
    expect(member).toMatchObject({
      org: "acme",
      user: "bob",
      items: [{ name: "c" }],
    });
    expect(member.items).toHaveLength(1);
    expect(seen.map((s) => pathOf(s.url))).toEqual([
      "/user/codespaces?per_page=30",
      "/repos/acme/widgets/codespaces?per_page=5",
      "/orgs/acme/members/bob/codespaces?per_page=30",
    ]);
    expect(await kind(ops.list.invoke({ user: "bob" }))).toBe("usage");
    expect(seen).toHaveLength(3);
  });

  test("a 403 or 404 names the codespace scope in its hint", async () => {
    const { gh } = fakeGitHub([
      on("GET", /^\/user\/codespaces\/gone$/, () =>
        json({ message: "Not Found" }, 404),
      ),
      on("GET", /^\/user\/codespaces\?/, () =>
        json({ message: "Must have admin rights" }, 403),
      ),
    ]);
    const ops = codespaceOps(gh);
    for (const call of [
      ops.view.invoke({ name: "gone" }),
      ops.list.invoke({}),
    ]) {
      const error = await call.catch((e: unknown) => e);
      expect(["not_found", "forbidden"]).toContain(
        String(Reflect.get(Object(error), "kind")),
      );
      expect(String(Reflect.get(Object(error), "hint"))).toContain(
        "`codespace` scope",
      );
    }
  });

  test("view reads one codespace by name", async () => {
    const { gh } = fakeGitHub([
      on("GET", /^\/user\/codespaces\/a%20b$/, () => json(space("a b"))),
    ]);
    expect(await codespaceOps(gh).view.invoke({ name: "a b" })).toMatchObject({
      name: "a b",
      state: "Available",
      repo: "acme/widgets",
    });
  });

  test("create sends only the given fields under the API's names", async () => {
    const { gh, seen } = fakeGitHub([
      on("POST", /^\/repos\/acme\/widgets\/codespaces$/, () =>
        json({ ...space("new"), state: "Queued" }, 202),
      ),
    ]);
    const out = await codespaceOps(gh).create.invoke({
      branch: "dev",
      machine: "basicLinux32gb",
      idleTimeoutMinutes: 10,
      retentionPeriodMinutes: 60,
      displayName: "mine",
      devcontainerPath: ".devcontainer/x/devcontainer.json",
      defaultPermissions: true,
    });
    expect(seen[0]?.body).toEqual({
      ref: "dev",
      machine: "basicLinux32gb",
      idle_timeout_minutes: 10,
      retention_period_minutes: 60,
      display_name: "mine",
      devcontainer_path: ".devcontainer/x/devcontainer.json",
      multi_repo_permissions_opt_out: true,
    });
    expect(out).toMatchObject({ name: "new", state: "Queued" });
  });

  test("delete and stop act on your own codespace or a member's, and org needs user", async () => {
    const { gh, seen } = fakeGitHub([
      on(
        "DELETE",
        /^\/user\/codespaces\/x$/,
        () => new Response(null, { status: 202 }),
      ),
      on("POST", /^\/orgs\/acme\/members\/bob\/codespaces\/x\/stop$/, () =>
        json({ ...space("x"), state: "ShuttingDown" }),
      ),
    ]);
    const ops = codespaceOps(gh);
    expect(await ops.delete.invoke({ name: "x" })).toEqual({
      name: "x",
      deleted: true,
    });
    expect(
      await ops.stop.invoke({ name: "x", org: "acme", user: "bob" }),
    ).toMatchObject({ state: "ShuttingDown" });
    expect(await kind(ops.delete.invoke({ name: "x", org: "acme" }))).toBe(
      "usage",
    );
    expect(seen.map((s) => `${s.method} ${pathOf(s.url)}`)).toEqual([
      "DELETE /user/codespaces/x",
      "POST /orgs/acme/members/bob/codespaces/x/stop",
    ]);
  });

  test("edit patches display name and machine, and refuses an empty edit", async () => {
    const { gh, seen } = fakeGitHub([
      on("PATCH", /^\/user\/codespaces\/x$/, () =>
        json({ ...space("x"), display_name: "renamed" }),
      ),
    ]);
    const ops = codespaceOps(gh);
    expect(await kind(ops.edit.invoke({ name: "x" }))).toBe("usage");
    expect(seen).toHaveLength(0);
    expect(
      await ops.edit.invoke({ name: "x", displayName: "renamed" }),
    ).toMatchObject({ displayName: "renamed" });
    expect(seen[0]?.body).toEqual({ display_name: "renamed" });
  });
});
