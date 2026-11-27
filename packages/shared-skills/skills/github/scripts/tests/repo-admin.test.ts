import { describe, expect, test } from "bun:test";
import { at } from "../src/read.ts";
import { repoAdminOps } from "../src/repo-admin.ts";
import { fakeGitHub, json, on } from "./fake.ts";
import { calls, kindOf, repoJson } from "./repo-fixture.ts";

describe("repo lifecycle", () => {
  test("delete sends nothing unless confirm equals owner/name", async () => {
    const { gh, seen } = fakeGitHub([
      on(
        "DELETE",
        /^\/repos\/acme\/widgets$/,
        () => new Response(null, { status: 204 }),
      ),
    ]);
    const del = repoAdminOps(gh).delete;
    expect(await kindOf(del.invoke({ confirm: "widgets" }))).toBe("usage");
    expect(seen).toHaveLength(0);
    expect(await del.invoke({ confirm: "acme/widgets" })).toEqual({
      repo: "acme/widgets",
      deleted: true,
    });
    expect(calls(seen)).toEqual(["DELETE /repos/acme/widgets"]);
  });

  test("archive and unarchive patch the archived flag", async () => {
    const { gh, seen } = fakeGitHub([
      on("PATCH", /^\/repos\/acme\/widgets$/, (req) =>
        json(repoJson({ archived: at(req.body, "archived") })),
      ),
    ]);
    const ops = repoAdminOps(gh);
    expect(await ops.archive.invoke({})).toEqual({
      repo: "acme/widgets",
      archived: true,
    });
    expect(await ops.unarchive.invoke({})).toEqual({
      repo: "acme/widgets",
      archived: false,
    });
    expect(seen.map((r) => r.body)).toEqual([
      { archived: true },
      { archived: false },
    ]);
  });

  test("rename returns the new owner/name", async () => {
    const { gh, seen } = fakeGitHub([
      on("PATCH", /^\/repos\/acme\/widgets$/, () =>
        json(
          repoJson({
            full_name: "acme/gadgets",
            html_url: "https://github.com/acme/gadgets",
          }),
        ),
      ),
    ]);
    expect(
      await repoAdminOps(gh).rename.invoke({ newName: "gadgets" }),
    ).toEqual({
      repo: "acme/widgets",
      newRepo: "acme/gadgets",
      url: "https://github.com/acme/gadgets",
    });
    expect(seen[0]?.body).toEqual({ name: "gadgets" });
  });

  test("fork posts the organization, name and default-branch-only flag", async () => {
    const { gh, seen } = fakeGitHub([
      on("POST", /^\/repos\/up\/tool\/forks$/, () =>
        json(
          repoJson({
            full_name: "acme/tool2",
            html_url: "https://github.com/acme/tool2",
          }),
          202,
        ),
      ),
    ]);
    const out = await repoAdminOps(gh).fork.invoke({
      repo: "up/tool",
      org: "acme",
      forkName: "tool2",
      defaultBranchOnly: true,
    });
    expect(seen[0]?.body).toEqual({
      organization: "acme",
      name: "tool2",
      default_branch_only: true,
    });
    expect(out).toEqual({
      repo: "up/tool",
      fork: "acme/tool2",
      defaultBranch: "main",
      url: "https://github.com/acme/tool2",
    });
  });
});
