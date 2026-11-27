import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { limitField, numberField, reads, repoField } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { arr, at, names, nodes, num, optNum, optStr, str } from "./read.ts";
import { searchRaw } from "./search.ts";

const VIEW = `query($owner:String!,$name:String!,$number:Int!,$comments:Int!){repository(owner:$owner,name:$name){issue(number:$number){
id number title url state stateReason body createdAt updatedAt closedAt author{login} milestone{title}
labels(first:50){nodes{name}} assignees(first:20){nodes{login}}
comments(last:$comments){totalCount nodes{databaseId author{login} body createdAt url}}}}}`;

export const labelNames = (x: unknown): string[] =>
  arr(x, "labels").map((l) => str(l, "name"));

export const issueFromRest = (i: unknown) => ({
  number: num(i, "number"),
  title: str(i, "title"),
  state: str(i, "state"),
  stateReason: optStr(i, "state_reason"),
  labels: labelNames(at(i, "labels")),
  author: optStr(i, "user", "login"),
  comments: optNum(i, "comments") ?? 0,
  url: str(i, "html_url"),
  createdAt: optStr(i, "created_at"),
  updatedAt: optStr(i, "updated_at"),
});

export const issueReadOps = (gh: GitHub) => ({
  view: op({
    description:
      "One issue with labels, assignees, milestone, state reason, body and optionally its last N comments (with ids for editing). Replaces `gh issue view --comments`.",
    input: s.object({
      repo: repoField,
      number: numberField,
      comments: s.optional(
        s.integer({
          description: "Latest comments to include (default 0, max 100).",
        }),
      ),
      body: s.optional(
        s.boolean({ description: "Include the issue body (default true)." }),
      ),
    }),
    annotations: reads,
    run: async ({ repo, number, comments, body }) => {
      const r = await gh.repo(repo);
      const data = await gh.graphql(VIEW, {
        owner: r.owner,
        name: r.name,
        number,
        comments: Math.min(comments ?? 0, 100),
      });
      const i = at(data, "repository", "issue");
      if (i === null || i === undefined)
        throw new SurfaceError(
          "not_found",
          `no issue #${number} in ${r.full}`,
          "a PR number is read with `pr view`",
        );
      return {
        repo: r.full,
        id: str(i, "id"),
        number: num(i, "number"),
        title: str(i, "title"),
        url: str(i, "url"),
        state: str(i, "state"),
        stateReason: optStr(i, "stateReason"),
        author: optStr(i, "author", "login"),
        createdAt: str(i, "createdAt"),
        updatedAt: str(i, "updatedAt"),
        closedAt: optStr(i, "closedAt"),
        milestone: optStr(i, "milestone", "title"),
        labels: names(i, "name", "labels"),
        assignees: names(i, "login", "assignees"),
        ...(body === false ? {} : { body: optStr(i, "body") ?? "" }),
        commentCount: optNum(i, "comments", "totalCount") ?? 0,
        comments: nodes(i, "comments").map((c) => ({
          id: optNum(c, "databaseId"),
          author: optStr(c, "author", "login"),
          at: str(c, "createdAt"),
          url: str(c, "url"),
          body: str(c, "body"),
        })),
      };
    },
  }),
  list: op({
    description:
      "List issues (pull requests excluded). `search` switches to GitHub search syntax for anything the filters cannot say. Replaces `gh issue list`.",
    input: s.object({
      repo: repoField,
      state: s.optional(s.enum(["open", "closed", "all"])),
      labels: s.optional(
        s.array(s.string(), { description: "All of these labels." }),
      ),
      assignee: s.optional(s.string()),
      author: s.optional(s.string()),
      since: s.optional(
        s.string({ description: "ISO time; only issues updated after it." }),
      ),
      search: s.optional(s.string()),
      limit: limitField(30),
    }),
    annotations: reads,
    run: async ({
      repo,
      state,
      labels,
      assignee,
      author,
      since,
      search,
      limit,
    }) => {
      const r = await gh.repo(repo);
      const max = limit ?? 30;
      if (search !== undefined) {
        const q = [
          `repo:${r.full}`,
          "is:issue",
          state === "all" ? "" : `is:${state ?? "open"}`,
          search,
        ]
          .filter(Boolean)
          .join(" ");
        return {
          repo: r.full,
          items: (await searchRaw(gh, q, max)).raw.map(issueFromRest),
        };
      }
      const items: ReturnType<typeof issueFromRest>[] = [];
      const query = {
        state: state ?? "open",
        labels: labels?.join(","),
        assignee,
        creator: author,
        since,
        sort: "updated",
      };
      for (let fetchLimit = max; items.length < max; fetchLimit *= 2) {
        const raw = await gh.list(`repos/${r.full}/issues`, fetchLimit, {
          query,
        });
        items.splice(
          0,
          items.length,
          ...raw
            .filter((i) => at(i, "pull_request") === undefined)
            .map(issueFromRest),
        );
        if (raw.length < fetchLimit) break;
      }
      return { repo: r.full, items: items.slice(0, max) };
    },
  }),
});
