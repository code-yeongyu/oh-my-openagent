import { describe, expect, test } from "bun:test";
import { at } from "../src/read.ts";
import { repoAdminOps } from "../src/repo-admin.ts";
import { fakeGitHub, json, on, type Seen } from "./fake.ts";
import { kindOf } from "./repo-fixture.ts";

const node = (name: string) => ({
  nameWithOwner: name,
  description: null,
  visibility: "PRIVATE",
  isFork: false,
  isArchived: false,
  isTemplate: false,
  primaryLanguage: { name: "Go" },
  repositoryTopics: { nodes: [{ topic: { name: "cli" } }] },
  stargazerCount: 3,
  defaultBranchRef: { name: "main" },
  pushedAt: "2026-01-01T00:00:00Z",
  url: `https://github.com/${name}`,
});
const page = (names: readonly string[], next: string | null) => ({
  nodes: names.map(node),
  pageInfo: { hasNextPage: next !== null, endCursor: next },
});
const query = (req: Seen | undefined) => String(at(req?.body, "query"));
const vars = (req: Seen | undefined) => at(req?.body, "variables");

describe("repo list", () => {
  test("without owner, the viewer's repositories are paged with server-side filters", async () => {
    const { gh, seen } = fakeGitHub([
      on("POST", /^\/graphql$/, (req) => {
        if (query(req).includes("viewer"))
          return json({ data: { viewer: { login: "me" } } });
        const after = at(req.body, "variables", "after");
        return json({
          data: {
            repositoryOwner: {
              repositories:
                after === null
                  ? page(["me/a", "me/b"], "c1")
                  : page(["me/c", "me/d"], "c2"),
            },
          },
        });
      }),
    ]);
    const out = await repoAdminOps(gh).list.invoke({
      visibility: "private",
      fork: false,
      limit: 3,
    });
    expect(out.owner).toBe("me");
    expect(out.items.map((i) => i.repo)).toEqual(["me/a", "me/b", "me/c"]);
    expect(out.items[0]).toEqual({
      repo: "me/a",
      description: null,
      visibility: "private",
      fork: false,
      archived: false,
      template: false,
      language: "Go",
      topics: ["cli"],
      stars: 3,
      defaultBranch: "main",
      pushedAt: "2026-01-01T00:00:00Z",
      url: "https://github.com/me/a",
    });
    expect(vars(seen[1])).toEqual({
      login: "me",
      visibility: "PRIVATE",
      isFork: false,
      isArchived: null,
      first: 3,
      after: null,
    });
    expect(at(vars(seen[2]), "first")).toBe(1);
    expect(at(vars(seen[2]), "after")).toBe("c1");
    expect(seen).toHaveLength(3);
  });

  test("language or topic filters go through repository search", async () => {
    const { gh, seen } = fakeGitHub([
      on("POST", /^\/graphql$/, () =>
        json({ data: { search: page(["acme/x"], null) } }),
      ),
    ]);
    const out = await repoAdminOps(gh).list.invoke({
      owner: "acme",
      fork: true,
      archived: false,
      language: "Go",
      topics: ["cli", "dev tools"],
    });
    expect(out).toMatchObject({ owner: "acme", items: [{ repo: "acme/x" }] });
    expect(query(seen[0])).toContain("search(");
    expect(at(vars(seen[0]), "q")).toBe(
      'user:acme fork:only archived:false language:Go topic:cli topic:"dev tools" sort:updated',
    );
  });

  test("an unknown owner is not_found", async () => {
    const { gh } = fakeGitHub([
      on("POST", /^\/graphql$/, () =>
        json({ data: { repositoryOwner: null } }),
      ),
    ]);
    expect(await kindOf(repoAdminOps(gh).list.invoke({ owner: "ghost" }))).toBe(
      "not_found",
    );
  });
});
