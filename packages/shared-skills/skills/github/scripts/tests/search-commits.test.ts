import { describe, expect, test } from "bun:test";
import { commitSearchOp } from "../src/search-commits.ts";
import { fakeGitHub, json, on } from "./fake.ts";

const item = (sha: string) => ({
  sha,
  html_url: `https://github.com/acme/api/commit/${sha}`,
  commit: {
    message: "fix: thing",
    author: { name: "Octo Cat", email: "o@x", date: "2024-05-01T00:00:00Z" },
    committer: { name: "GitHub", email: "n@x", date: "2024-05-02T00:00:00Z" },
  },
  author: { login: "octo" },
  committer: null,
  repository: { full_name: "acme/api" },
});

const params = (url: string | undefined) => new URL(url ?? "").searchParams;

describe("commit search", () => {
  test("flags become quoted qualifiers, and the first page carries the total", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /^\/search\/commits/, () =>
        json({
          total_count: 42,
          incomplete_results: false,
          items: [item("a1")],
        }),
      ),
    ]);
    const out = await commitSearchOp(gh).invoke({
      query: "fix crash",
      author: "octo",
      authorName: "Octo Cat",
      authorDate: ">2024-01-01",
      hash: "a1",
      merge: false,
      repo: ["acme/api", "acme/web"],
      owner: ["acme"],
      visibility: ["public"],
      sort: "author-date",
      limit: 5,
    });
    const p = params(seen[0]?.url);
    expect(p.get("q")).toBe(
      'fix crash author:octo author-name:"Octo Cat" author-date:>2024-01-01 hash:a1 merge:false repo:acme/api repo:acme/web user:acme is:public',
    );
    expect(p.get("sort")).toBe("author-date");
    expect(p.get("order")).toBe("desc");
    expect(p.get("per_page")).toBe("5");
    expect(out).toEqual({
      total: 42,
      items: [
        {
          repo: "acme/api",
          sha: "a1",
          message: "fix: thing",
          author: "octo",
          authorName: "Octo Cat",
          authorDate: "2024-05-01T00:00:00Z",
          committer: null,
          committerDate: "2024-05-02T00:00:00Z",
          url: "https://github.com/acme/api/commit/a1",
        },
      ],
    });
  });

  test("order is dropped without sort, as gh does", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /^\/search\/commits/, () =>
        json({ total_count: 0, items: [] }),
      ),
    ]);
    await commitSearchOp(gh).invoke({ committer: "web-flow", order: "asc" });
    const p = params(seen[0]?.url);
    expect(p.get("q")).toBe("committer:web-flow");
    expect(p.has("order")).toBe(false);
    expect(p.has("sort")).toBe(false);
  });

  test("more than 100 results page through and report no total", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /^\/search\/commits\?.*page=2/, () =>
        json({ total_count: 150, items: [item("b2")] }),
      ),
      on("GET", /^\/search\/commits/, () =>
        json({ total_count: 150, items: [item("b1")] }, 200, {
          link: '<https://api.github.com/search/commits?q=x&per_page=100&page=2>; rel="next"',
        }),
      ),
    ]);
    const out = await commitSearchOp(gh).invoke({ query: "x", limit: 150 });
    expect(out.total).toBeNull();
    expect(out.items.map((i) => i.sha)).toEqual(["b1", "b2"]);
    expect(seen).toHaveLength(2);
  });

  test("a search with neither text nor qualifiers sends nothing", async () => {
    const { gh, seen } = fakeGitHub([]);
    const kind = await commitSearchOp(gh)
      .invoke({ limit: 3 })
      .then(
        () => "resolved",
        (e: unknown) => String(Reflect.get(Object(e), "kind")),
      );
    expect(kind).toBe("usage");
    expect(seen).toHaveLength(0);
  });
});
