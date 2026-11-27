import { describe, expect, test } from "bun:test";
import { repoAdminOps } from "../src/repo-admin.ts";
import { fakeGitHub, json, on } from "./fake.ts";
import { calls, kindOf, repoJson } from "./repo-fixture.ts";

const forkJson = () =>
  json(
    repoJson({
      fork: true,
      parent: { full_name: "up/widgets", default_branch: "trunk" },
    }),
  );

describe("repo sync", () => {
  test("without source, the default branch is merged from upstream", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /^\/repos\/acme\/widgets$/, forkJson),
      on("POST", /^\/repos\/acme\/widgets\/merge-upstream$/, () =>
        json({
          message: "ok",
          merge_type: "fast-forward",
          base_branch: "up:main",
        }),
      ),
    ]);
    expect(await repoAdminOps(gh).sync.invoke({})).toEqual({
      repo: "acme/widgets",
      branch: "main",
      source: "up/widgets",
      sha: null,
      mergeType: "fast-forward",
    });
    expect(seen[1]?.body).toEqual({ branch: "main" });
  });

  test("with source, the branch ref moves to the source head, fast-forward only", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /^\/repos\/other\/widgets$/, () =>
        json(repoJson({ full_name: "other/widgets", default_branch: "trunk" })),
      ),
      on("GET", /^\/repos\/other\/widgets\/git\/ref\/heads\/trunk$/, () =>
        json({ object: { sha: "abc" } }),
      ),
      on("PATCH", /^\/repos\/acme\/widgets\/git\/refs\/heads\/trunk$/, () =>
        json({ object: { sha: "abc" } }),
      ),
    ]);
    const out = await repoAdminOps(gh).sync.invoke({ source: "other/widgets" });
    expect(out).toEqual({
      repo: "acme/widgets",
      branch: "trunk",
      source: "other/widgets",
      sha: "abc",
      mergeType: "fast-forward",
    });
    expect(seen[2]?.body).toEqual({ sha: "abc", force: false });
  });

  test("a conflicting upstream merge with force resets the branch to the parent", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /^\/repos\/acme\/widgets$/, forkJson),
      on("POST", /\/merge-upstream$/, () =>
        json({ message: "merge conflict" }, 409),
      ),
      on("GET", /^\/repos\/up\/widgets\/git\/ref\/heads\/feature\/x$/, () =>
        json({ object: { sha: "def" } }),
      ),
      on(
        "PATCH",
        /^\/repos\/acme\/widgets\/git\/refs\/heads\/feature\/x$/,
        () => json({}),
      ),
    ]);
    const out = await repoAdminOps(gh).sync.invoke({
      branch: "feature/x",
      force: true,
    });
    expect(out).toMatchObject({
      source: "up/widgets",
      sha: "def",
      mergeType: "reset",
    });
    expect(calls(seen).at(-1)).toBe(
      "PATCH /repos/acme/widgets/git/refs/heads/feature/x",
    );
    expect(seen.at(-1)?.body).toEqual({ sha: "def", force: true });
  });

  test("a conflicting upstream merge without force fails and moves nothing", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /^\/repos\/acme\/widgets$/, forkJson),
      on("POST", /\/merge-upstream$/, () =>
        json({ message: "merge conflict" }, 409),
      ),
    ]);
    expect(await kindOf(repoAdminOps(gh).sync.invoke({}))).toBe("conflict");
    expect(seen.some((r) => r.method === "PATCH")).toBe(false);
  });
});
