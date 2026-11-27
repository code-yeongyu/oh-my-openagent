import { describe, expect, test } from "bun:test";
import { createClient } from "../sdk.ts";
import { authOps, orgOps, statusOp } from "../src/account.ts";
import { fakeDeps, fakeGitHub, json, on, TOKEN } from "./fake.ts";

const issue = (repo: string, number: number, pr = false) => ({
  repository_url: `https://api.github.com/repos/${repo}`,
  number,
  title: `t${number}`,
  state: "open",
  html_url: `https://github.com/${repo}/${pr ? "pull" : "issues"}/${number}`,
  updated_at: "2024-05-01T00:00:00Z",
});

const note = (repo: string, reason: string, comment: number | null) => ({
  reason,
  repository: { full_name: repo, owner: { login: repo.split("/")[0] } },
  subject: {
    title: `subject ${comment}`,
    url: `https://api.github.com/repos/${repo}/issues/7`,
    latest_comment_url:
      comment === null
        ? null
        : `https://api.github.com/repos/${repo}/issues/comments/${comment}`,
  },
});

const comment = (id: number, body: string) =>
  json({ body, html_url: `https://github.com/c/${id}` });

const event = (type: string, repo: string, payload: unknown) => ({
  type,
  repo: { name: repo },
  org: { login: repo.split("/")[0] },
  payload,
  created_at: "2024-05-02T00:00:00Z",
});

const statusRoutes = () => [
  on("GET", /^\/user$/, () => json({ login: "octo" })),
  on("GET", /^\/search\/issues/, (req) => {
    const q = new URL(req.url).searchParams.get("q") ?? "";
    const items = q.startsWith("review-requested")
      ? [issue("acme/api", 3, true)]
      : q.includes("is:pr")
        ? [issue("acme/api", 2, true)]
        : [issue("acme/api", 1)];
    return json({ total_count: items.length, items });
  }),
  on("GET", /^\/notifications/, () =>
    json([
      note("acme/api", "mention", 11),
      note("acme/api", "mention", 12),
      note("acme/api", "subscribed", 13),
      note("acme/secret", "mention", 14),
      note("other/lib", "mention", 15),
    ]),
  ),
  on("GET", /\/comments\/11$/, () => comment(11, "ping @Octo please look")),
  on("GET", /\/comments\/12$/, () => comment(12, "no mention here")),
  on("GET", /\/comments\/14$/, () => comment(14, "@octo hidden")),
  on("GET", /\/comments\/15$/, () => json({ message: "Not Found" }, 404)),
  on("GET", /^\/users\/octo\/received_events/, () =>
    json([
      event("IssuesEvent", "acme/api", {
        action: "opened",
        issue: { number: 4, title: "new bug", html_url: "https://i/4" },
      }),
      event("IssuesEvent", "acme/api", {
        action: "closed",
        issue: { number: 5, title: "closed", html_url: "https://i/5" },
      }),
      event("IssueCommentEvent", "acme/api", {
        action: "created",
        issue: { number: 6, title: "talk", html_url: "https://i/6" },
        comment: { body: "hello", html_url: "https://c/6" },
      }),
      event("WatchEvent", "acme/api", { action: "started" }),
      event("PullRequestEvent", "other/lib", {
        action: "opened",
        pull_request: { number: 8, title: "pr", html_url: "https://p/8" },
      }),
    ]),
  ),
];

describe("status", () => {
  test("assembles every section, scoped by org and exclude", async () => {
    const { gh, seen } = fakeGitHub(statusRoutes());
    const out = await statusOp(gh).invoke({
      org: "acme",
      exclude: ["acme/secret"],
    });
    const queries = seen
      .filter((r) => r.url.includes("/search/issues"))
      .map((r) => new URL(r.url).searchParams.get("q") ?? "");
    expect(queries.toSorted((a, b) => a.localeCompare(b))).toEqual([
      "assignee:@me is:issue state:open archived:false org:acme -repo:acme/secret",
      "assignee:@me is:pr state:open archived:false org:acme -repo:acme/secret",
      "review-requested:@me is:pr state:open archived:false org:acme -repo:acme/secret",
    ]);
    const notes = seen.find((r) => r.url.includes("/notifications"));
    expect(new URL(notes?.url ?? "").searchParams.get("participating")).toBe(
      "true",
    );
    expect(out.login).toBe("octo");
    expect(out.assignedIssues).toEqual([
      {
        repo: "acme/api",
        number: 1,
        title: "t1",
        url: "https://github.com/acme/api/issues/1",
        updatedAt: "2024-05-01T00:00:00Z",
      },
    ]);
    expect(out.assignedPrs.map((i) => i.number)).toEqual([2]);
    expect(out.reviewRequests.map((i) => i.number)).toEqual([3]);
    expect(out.mentions).toEqual([
      {
        repo: "acme/api",
        number: 7,
        title: "subject 11",
        url: "https://github.com/c/11",
        preview: "ping @Octo please look",
      },
    ]);
    expect(seen.some((r) => r.url.endsWith("/comments/14"))).toBe(false);
    expect(out.activity.map((a) => [a.number, a.reason, a.url])).toEqual([
      [4, "new issue", "https://i/4"],
      [6, "comment", "https://c/6"],
    ]);
  });

  test("a deleted mentioning comment is skipped, other failures surface", async () => {
    const { gh } = fakeGitHub(statusRoutes());
    const out = await statusOp(gh).invoke({});
    expect(out.mentions.map((m) => m.url)).toEqual([
      "https://github.com/c/11",
      "https://github.com/c/14",
    ]);
    expect(out.activity.map((a) => a.number)).toEqual([4, 6, 8]);

    const broken = fakeGitHub([
      on("GET", /\/comments\/11$/, () => json({ message: "boom" }, 500)),
      ...statusRoutes(),
    ]);
    const kind = await statusOp(broken.gh)
      .invoke({})
      .then(
        () => "resolved",
        (e: unknown) => String(Reflect.get(Object(e), "kind")),
      );
    expect(kind).toBe("server");
  });
});

describe("org and auth", () => {
  test("org list returns the logins of the user's organizations", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /^\/user\/orgs/, () =>
        json([{ login: "acme" }, { login: "b" }]),
      ),
    ]);
    expect(await orgOps(gh).list.invoke({ limit: 5 })).toEqual({
      items: ["acme", "b"],
    });
    expect(new URL(seen[0]?.url ?? "").searchParams.get("per_page")).toBe("5");
  });

  const authRoutes = (scopes: Record<string, string>) => [
    on("GET", /^\/user$/, () =>
      json({ login: "octo", name: "Octo Cat" }, 200, scopes),
    ),
  ];

  test("auth status reports login, scopes and the token source, never the token", async () => {
    const { gh } = fakeGitHub(
      authRoutes({ "x-oauth-scopes": "repo, read:org,gist" }),
    );
    const out = await authOps(gh, { GH_TOKEN: TOKEN }).status.invoke({});
    expect(out).toEqual({
      host: "github.com",
      login: "octo",
      name: "Octo Cat",
      scopes: ["repo", "read:org", "gist"],
      tokenSource: "GH_TOKEN",
    });
    expect(JSON.stringify(out)).not.toContain(TOKEN.slice(4, 12));
  });

  test("token source follows the transport's precedence; no scope header means null", async () => {
    const { gh } = fakeGitHub(authRoutes({}));
    const source = async (env: Record<string, string>) =>
      (await authOps(gh, env).status.invoke({})).tokenSource;
    expect(await source({ GITHUB_TOKEN: TOKEN })).toBe("GITHUB_TOKEN");
    expect(await source({ GH_TOKEN: "", GITHUB_TOKEN: TOKEN })).toBe("gh");
    expect(await source({})).toBe("gh");
    expect((await authOps(gh, {}).status.invoke({})).scopes).toBeNull();
  });

  test("a token provider passed to createClient is reported as injected, whatever the environment holds", async () => {
    const { deps } = fakeDeps(authRoutes({}));
    const status = await createClient(deps).auth.status({});
    expect(status.tokenSource).toBe("injected");
  });
});
