import { op, s } from "../vendor/surface/index.ts";
import { enc, limitField, reads, repoField } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { arr, at, bool, num, optNum, optStr, str } from "./read.ts";

const release = (x: unknown) => ({
  tag: str(x, "tag_name"),
  name: optStr(x, "name"),
  draft: bool(x, "draft"),
  prerelease: bool(x, "prerelease"),
  target: optStr(x, "target_commitish"),
  publishedAt: optStr(x, "published_at"),
  url: str(x, "html_url"),
});

export const repoOps = (gh: GitHub) => ({
  view: op({
    description:
      "Repository facts: default branch, visibility, archived, description, counts, topics. Replaces `gh repo view --json`.",
    input: s.object({ repo: repoField }),
    annotations: reads,
    run: async ({ repo }) => {
      const r = await gh.repo(repo);
      const x = await gh.rest("GET", `repos/${r.full}`);
      return {
        repo: str(x, "full_name"),
        description: optStr(x, "description"),
        defaultBranch: str(x, "default_branch"),
        visibility: optStr(x, "visibility"),
        private: bool(x, "private"),
        archived: bool(x, "archived"),
        fork: bool(x, "fork"),
        stars: optNum(x, "stargazers_count"),
        openIssues: optNum(x, "open_issues_count"),
        topics: arr(at(x, "topics") ?? [], "topics").filter(
          (t) => typeof t === "string",
        ),
        pushedAt: optStr(x, "pushed_at"),
        url: str(x, "html_url"),
      };
    },
  }),
});

export const releaseOps = (gh: GitHub) => ({
  list: op({
    description:
      "Releases, newest first, drafts included when the token can see them. Replaces `gh release list`.",
    input: s.object({ repo: repoField, limit: limitField(20) }),
    annotations: reads,
    run: async ({ repo, limit }) => {
      const r = await gh.repo(repo);
      return {
        repo: r.full,
        releases: (await gh.list(`repos/${r.full}/releases`, limit ?? 20)).map(
          release,
        ),
      };
    },
  }),
  view: op({
    description:
      "One release by tag (latest when omitted) with notes and assets. Replaces `gh release view`.",
    input: s.object({ repo: repoField, tag: s.optional(s.string()) }),
    annotations: reads,
    run: async ({ repo, tag }) => {
      const r = await gh.repo(repo);
      const x = await gh.rest(
        "GET",
        tag === undefined
          ? `repos/${r.full}/releases/latest`
          : `repos/${r.full}/releases/tags/${enc(tag)}`,
      );
      return {
        repo: r.full,
        ...release(x),
        body: optStr(x, "body") ?? "",
        assets: arr(at(x, "assets") ?? [], "assets").map((a) => ({
          name: str(a, "name"),
          size: num(a, "size"),
          downloads: num(a, "download_count"),
          url: str(a, "browser_download_url"),
        })),
      };
    },
  }),
});
