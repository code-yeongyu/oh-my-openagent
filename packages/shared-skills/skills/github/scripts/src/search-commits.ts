// Commit search across GitHub: free text plus the qualifiers `gh search commits` turns its flags into.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { limitField, reads } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { arr, at, num, optStr, str } from "./read.ts";

const quote = (v: string) => (/\s/.test(v) ? `"${v}"` : v);

const commitItem = (c: unknown) => ({
  repo: str(c, "repository", "full_name"),
  sha: str(c, "sha"),
  message: str(c, "commit", "message"),
  author: optStr(c, "author", "login"),
  authorName: optStr(c, "commit", "author", "name"),
  authorDate: optStr(c, "commit", "author", "date"),
  committer: optStr(c, "committer", "login"),
  committerDate: optStr(c, "commit", "committer", "date"),
  url: str(c, "html_url"),
});

const text = (description: string) => s.optional(s.string({ description }));
const date = text("Date or range: 2024-01-01, >2024-01-01, 2024-01..2024-03.");
const many = (description: string) =>
  s.optional(s.array(s.string(), { description }));

export const commitSearchOp = (gh: GitHub) =>
  op({
    description:
      "Search commits by message text and qualifiers (author, committer, dates, hash, merge, repo, owner, visibility), best match first unless `sort` is set. `total` is null when more than 100 results are requested. Replaces `gh search commits`.",
    input: s.object({
      query: text("Words to find in commit messages."),
      author: text("Author login."),
      authorEmail: s.optional(s.string()),
      authorName: s.optional(s.string()),
      authorDate: date,
      committer: text("Committer login."),
      committerEmail: s.optional(s.string()),
      committerName: s.optional(s.string()),
      committerDate: date,
      hash: s.optional(s.string()),
      parent: text("Parent commit hash."),
      tree: text("Tree hash."),
      merge: s.optional(
        s.boolean({
          description: "true for merge commits only, false to exclude them.",
        }),
      ),
      repo: many("owner/name repositories."),
      owner: many("Repository owners (users or organizations)."),
      visibility: s.optional(
        s.array(s.enum(["public", "private", "internal"])),
      ),
      sort: s.optional(s.enum(["author-date", "committer-date"])),
      order: s.optional(
        s.enum(["asc", "desc"], { description: "Applies only with sort." }),
      ),
      limit: limitField(30),
    }),
    annotations: reads,
    run: async (input) => {
      const single = {
        author: input.author,
        "author-email": input.authorEmail,
        "author-name": input.authorName,
        "author-date": input.authorDate,
        committer: input.committer,
        "committer-email": input.committerEmail,
        "committer-name": input.committerName,
        "committer-date": input.committerDate,
        hash: input.hash,
        parent: input.parent,
        tree: input.tree,
        merge: input.merge === undefined ? undefined : String(input.merge),
      };
      const q = [
        input.query ?? "",
        ...Object.entries(single).flatMap(([k, v]) =>
          v === undefined ? [] : [`${k}:${quote(v)}`],
        ),
        ...(input.repo ?? []).map((v) => `repo:${quote(v)}`),
        ...(input.owner ?? []).map((v) => `user:${quote(v)}`),
        ...(input.visibility ?? []).map((v) => `is:${v}`),
      ]
        .filter(Boolean)
        .join(" ");
      if (q === "")
        throw new SurfaceError(
          "usage",
          "empty commit search",
          "pass query text or at least one qualifier",
        );
      const limit = input.limit ?? 30;
      const query = {
        q,
        ...(input.sort === undefined
          ? {}
          : { sort: input.sort, order: input.order ?? "desc" }),
      };
      if (limit > 100)
        return {
          total: null,
          items: (
            await gh.list("search/commits", limit, { query, key: "items" })
          ).map(commitItem),
        };
      const page = await gh.rest("GET", "search/commits", {
        query: { ...query, per_page: Math.max(1, limit) },
      });
      return {
        total: num(page, "total_count"),
        items: arr(at(page, "items"), "items").map(commitItem),
      };
    },
  });
