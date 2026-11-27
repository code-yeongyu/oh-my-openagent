import { describe, expect, test } from "bun:test";
import { repoAdminOps } from "../src/repo-admin.ts";
import { fakeGitHub, json, on } from "./fake.ts";
import { calls, kindOf, repoJson } from "./repo-fixture.ts";

describe("repo create", () => {
  test("a user repository goes to user/repos with private and the init options", async () => {
    const { gh, seen } = fakeGitHub([
      on("POST", /^\/user\/repos$/, () =>
        json(
          repoJson({
            full_name: "me/new",
            private: true,
            visibility: "private",
          }),
          201,
        ),
      ),
    ]);
    const out = await repoAdminOps(gh).create.invoke({
      name: "new",
      visibility: "private",
      description: "d",
      addReadme: true,
      gitignore: "Node",
      license: "mit",
      disableWiki: true,
    });
    expect(calls(seen)).toEqual(["POST /user/repos"]);
    expect(seen[0]?.body).toEqual({
      name: "new",
      description: "d",
      private: true,
      auto_init: true,
      gitignore_template: "Node",
      license_template: "mit",
      has_wiki: false,
    });
    expect(out).toMatchObject({
      repo: "me/new",
      private: true,
      visibility: "private",
    });
  });

  test("an organization repository resolves the team and sends visibility", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /^\/users\/acme$/, () =>
        json({ login: "acme", type: "Organization" }),
      ),
      on("GET", /^\/orgs\/acme\/teams\/core$/, () => json({ id: 42 })),
      on("POST", /^\/orgs\/acme\/repos$/, () =>
        json(repoJson({ visibility: "internal" }), 201),
      ),
    ]);
    await repoAdminOps(gh).create.invoke({
      name: "widgets",
      owner: "acme",
      visibility: "internal",
      team: "core",
    });
    expect(calls(seen)).toEqual([
      "GET /users/acme",
      "GET /orgs/acme/teams/core",
      "POST /orgs/acme/repos",
    ]);
    expect(seen[2]?.body).toEqual({
      name: "widgets",
      visibility: "internal",
      team_id: 42,
    });
  });

  test("another user as owner is refused before any write", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /^\/users\/bob$/, () => json({ login: "bob", type: "User" })),
      on("GET", /^\/user$/, () => json({ login: "me" })),
    ]);
    expect(
      await kindOf(
        repoAdminOps(gh).create.invoke({
          name: "x",
          owner: "bob",
          visibility: "public",
        }),
      ),
    ).toBe("usage");
    expect(seen.every((r) => r.method === "GET")).toBe(true);
  });

  test("a template is generated, then made internal", async () => {
    const { gh, seen } = fakeGitHub([
      on("POST", /^\/repos\/acme\/tpl\/generate$/, () =>
        json(repoJson({ full_name: "acme/new" }), 201),
      ),
      on("PATCH", /^\/repos\/acme\/new$/, () =>
        json(
          repoJson({
            full_name: "acme/new",
            visibility: "internal",
            private: true,
          }),
        ),
      ),
    ]);
    const out = await repoAdminOps(gh).create.invoke({
      name: "new",
      owner: "acme",
      visibility: "internal",
      template: "acme/tpl",
      includeAllBranches: true,
    });
    expect(seen[0]?.body).toEqual({
      owner: "acme",
      name: "new",
      include_all_branches: true,
      private: true,
    });
    expect(seen[1]?.body).toEqual({ visibility: "internal" });
    expect(out.visibility).toBe("internal");
  });

  test("a template with init options sends nothing", async () => {
    const { gh, seen } = fakeGitHub([]);
    const create = repoAdminOps(gh).create;
    expect(
      await kindOf(
        create.invoke({
          name: "n",
          visibility: "public",
          template: "a/b",
          license: "mit",
        }),
      ),
    ).toBe("usage");
    expect(
      await kindOf(
        create.invoke({
          name: "n",
          visibility: "public",
          includeAllBranches: true,
        }),
      ),
    ).toBe("usage");
    expect(seen).toHaveLength(0);
  });
});
