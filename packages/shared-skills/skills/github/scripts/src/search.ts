import { op, s } from "../vendor/surface/index.ts";
import { limitField, reads } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { arr, at, bool, num, optStr, str } from "./read.ts";

const issueItem = (i: unknown) => ({
  repo: (optStr(i, "repository_url") ?? "").replace(/^.*\/repos\//, ""),
  number: num(i, "number"),
  title: str(i, "title"),
  state: str(i, "state"),
  isPr: at(i, "pull_request") !== undefined,
  merged: optStr(i, "pull_request", "merged_at") !== null,
  draft: bool(i, "draft"),
  author: optStr(i, "user", "login"),
  url: str(i, "html_url"),
  createdAt: optStr(i, "created_at"),
  updatedAt: optStr(i, "updated_at"),
});

export const searchRaw = async (
  gh: GitHub,
  q: string,
  limit: number,
): Promise<{ total: number | null; raw: readonly unknown[] }> => {
  const query = { q, sort: "updated", order: "desc" };
  if (limit > 100)
    return {
      total: null,
      raw: await gh.list("search/issues", limit, { query, key: "items" }),
    };
  const page = await gh.rest("GET", "search/issues", {
    query: { ...query, per_page: Math.max(1, limit) },
  });
  return {
    total: num(page, "total_count"),
    raw: arr(at(page, "items"), "items"),
  };
};

const searchItems = async (gh: GitHub, q: string, limit: number) => {
  const { total, raw } = await searchRaw(gh, q, limit);
  return { total, items: raw.map(issueItem) };
};

const scoped = (q: string, repo: string | undefined, extra: string) =>
  [q, repo === undefined ? "" : `repo:${repo}`, extra]
    .filter(Boolean)
    .join(" ");

export const searchOps = (gh: GitHub) => ({
  issues: op({
    description:
      "Search issues and pull requests with GitHub search syntax (is:open label:bug author:x ...). `type` narrows to issues or PRs. Replaces `gh search issues` / `gh search prs`.",
    input: s.object({
      query: s.string({ description: "GitHub issue search syntax." }),
      type: s.optional(s.enum(["issue", "pr", "any"])),
      repo: s.optional(s.string({ description: "owner/name to scope to." })),
      limit: limitField(30),
    }),
    annotations: reads,
    run: ({ query, type, repo, limit }) =>
      searchItems(
        gh,
        scoped(
          query,
          repo,
          type === "pr" ? "is:pr" : type === "issue" ? "is:issue" : "",
        ),
        limit ?? 30,
      ),
  }),
  code: op({
    description:
      "Search code (GitHub code search syntax) with matching fragments. Replaces `gh search code`.",
    input: s.object({
      query: s.string(),
      repo: s.optional(s.string()),
      limit: limitField(20),
    }),
    annotations: reads,
    run: async ({ query, repo, limit }) => {
      const raw = await gh.list("search/code", limit ?? 20, {
        query: { q: scoped(query, repo, "") },
        key: "items",
        accept: "application/vnd.github.text-match+json",
      });
      return raw.map((c) => ({
        repo: str(c, "repository", "full_name"),
        path: str(c, "path"),
        url: str(c, "html_url"),
        fragments: [at(c, "text_matches")].flat().flatMap((m) => {
          const f = optStr(m, "fragment");
          return f === null ? [] : [f];
        }),
      }));
    },
  }),
  repos: op({
    description: "Search repositories. Replaces `gh search repos`.",
    input: s.object({ query: s.string(), limit: limitField(20) }),
    annotations: reads,
    run: async ({ query, limit }) =>
      (
        await gh.list("search/repositories", limit ?? 20, {
          query: { q: query },
          key: "items",
        })
      ).map((r) => ({
        repo: str(r, "full_name"),
        description: optStr(r, "description"),
        stars: num(r, "stargazers_count"),
        url: str(r, "html_url"),
        pushedAt: optStr(r, "pushed_at"),
      })),
  }),
});
