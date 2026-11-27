import { describe, expect, test } from "bun:test";
import { repoAdminOps } from "../src/repo-admin.ts";
import { fakeGitHub, json, on } from "./fake.ts";
import { calls, kindOf, repoJson } from "./repo-fixture.ts";

describe("repo edit", () => {
  test("settings are patched in API names, then topics are read, merged and replaced", async () => {
    const { gh, seen } = fakeGitHub([
      on("PATCH", /^\/repos\/acme\/widgets$/, () =>
        json(
          repoJson({
            visibility: "private",
            private: true,
            topics: ["a", "b"],
            delete_branch_on_merge: true,
          }),
        ),
      ),
      on("GET", /^\/repos\/acme\/widgets\/topics$/, () =>
        json({ names: ["a", "b"] }),
      ),
      on("PUT", /^\/repos\/acme\/widgets\/topics$/, () =>
        json({ names: ["b", "c"] }),
      ),
    ]);
    const out = await repoAdminOps(gh).edit.invoke({
      visibility: "private",
      acceptVisibilityChangeConsequences: true,
      enableWiki: false,
      deleteBranchOnMerge: true,
      squashMergeCommitMessage: "pr-title-description",
      enableSecretScanning: true,
      addTopics: ["c"],
      removeTopics: ["a"],
    });
    expect(calls(seen)).toEqual([
      "PATCH /repos/acme/widgets",
      "GET /repos/acme/widgets/topics",
      "PUT /repos/acme/widgets/topics",
    ]);
    expect(seen[0]?.body).toEqual({
      visibility: "private",
      has_wiki: false,
      delete_branch_on_merge: true,
      squash_merge_commit_title: "PR_TITLE",
      squash_merge_commit_message: "PR_BODY",
      security_and_analysis: { secret_scanning: { status: "enabled" } },
    });
    expect(seen[2]?.body).toEqual({ names: ["b", "c"] });
    expect(out).toMatchObject({
      repo: "acme/widgets",
      visibility: "private",
      topics: ["b", "c"],
      deleteBranchOnMerge: true,
      allowSquashMerge: true,
      allowRebaseMerge: null,
    });
  });

  test("a topics-only change reads the repository instead of patching it", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /^\/repos\/acme\/widgets$/, () => json(repoJson())),
      on("GET", /^\/repos\/acme\/widgets\/topics$/, () => json({ names: [] })),
      on("PUT", /^\/repos\/acme\/widgets\/topics$/, () =>
        json({ names: ["x"] }),
      ),
    ]);
    expect(
      (await repoAdminOps(gh).edit.invoke({ addTopics: ["x"] })).topics,
    ).toEqual(["x"]);
    expect(seen.map((r) => r.method)).toEqual(["GET", "GET", "PUT"]);
  });

  test("visibility without the acknowledgement, or no change at all, sends nothing", async () => {
    const { gh, seen } = fakeGitHub([]);
    const edit = repoAdminOps(gh).edit;
    expect(await kindOf(edit.invoke({ visibility: "public" }))).toBe("usage");
    expect(
      await kindOf(
        edit.invoke({
          visibility: "public",
          acceptVisibilityChangeConsequences: false,
        }),
      ),
    ).toBe("usage");
    expect(await kindOf(edit.invoke({}))).toBe("usage");
    expect(seen).toHaveLength(0);
  });
});
