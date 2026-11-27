// Gists of the authenticated user: list and view here, writes in gists-write.ts.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { enc, limitField, reads } from "./fields.ts";
import { fileList, gistField, gistId, gistSummary } from "./gist-shape.ts";
import { gistWriteOps } from "./gists-write.ts";
import type { GitHub } from "./http.ts";
import { arr, at, bool, nodes, num, optStr, str } from "./read.ts";

const LIST = `query($n: Int!, $after: String, $privacy: GistPrivacy!, $content: Boolean!) {
  viewer { gists(first: $n, after: $after, privacy: $privacy, orderBy: { field: CREATED_AT, direction: DESC }) {
    nodes { name description isPublic updatedAt url files(limit: 300) { name text @include(if: $content) } }
    pageInfo { hasNextPage endCursor }
  } }
}`;

export const gistOps = (gh: GitHub) => ({
  list: op({
    description:
      "Your gists, newest first, optionally only public or secret ones and only those whose description or file names match a regex. Replaces `gh gist list`.",
    input: s.object({
      visibility: s.optional(s.enum(["all", "public", "secret"])),
      filter: s.optional(
        s.string({
          description: "Regex matched against the description and file names.",
        }),
      ),
      includeContent: s.optional(
        s.boolean({ description: "Also match the filter against file text." }),
      ),
      limit: limitField(10),
    }),
    annotations: reads,
    run: async ({ visibility, filter, includeContent, limit }) => {
      const max = limit ?? 10;
      const pattern = filter === undefined ? undefined : new RegExp(filter);
      const content = pattern !== undefined && includeContent === true;
      const items = [];
      let after: string | null = null;
      do {
        const page: unknown = at(
          await gh.graphql(LIST, {
            n: pattern === undefined ? Math.min(100, max) : 100,
            after,
            privacy: (visibility ?? "all").toUpperCase(),
            content,
          }),
          "viewer",
          "gists",
        );
        for (const g of nodes(page)) {
          const files = arr(at(g, "files") ?? [], "files");
          const fields = [
            optStr(g, "description") ?? "",
            ...files.map((f) => str(f, "name")),
            ...(content ? files.map((f) => optStr(f, "text") ?? "") : []),
          ];
          if (pattern !== undefined && !fields.some((t) => pattern.test(t)))
            continue;
          items.push({
            id: str(g, "name"),
            description: optStr(g, "description"),
            public: bool(g, "isPublic"),
            files: files.map((f) => str(f, "name")),
            updatedAt: str(g, "updatedAt"),
            url: str(g, "url"),
          });
          if (items.length >= max) break;
        }
        after =
          at(page, "pageInfo", "hasNextPage") === true
            ? optStr(page, "pageInfo", "endCursor")
            : null;
      } while (after !== null && items.length < max);
      return { items };
    },
  }),
  view: op({
    description:
      "A gist's description, visibility and files with name, size and full content (a file over 1 MB is fetched from its raw URL; one over 10 MB needs `gist clone`). Replaces `gh gist view`.",
    input: s.object({
      id: gistField,
      filename: s.optional(s.string({ description: "Return only this file." })),
      files: s.optional(
        s.boolean({ description: "Return file names and sizes only." }),
      ),
    }),
    annotations: reads,
    run: async ({ id, filename, files }) => {
      const g = await gh.rest("GET", `gists/${enc(gistId(id))}`);
      const all = fileList(g).filter(
        (f) => filename === undefined || str(f, "filename") === filename,
      );
      if (filename !== undefined && all.length === 0)
        throw new SurfaceError(
          "not_found",
          `gist has no file named ${filename}`,
          "list its files with `files: true`",
        );
      const content = async (f: unknown): Promise<string> =>
        bool(f, "truncated")
          ? new TextDecoder().decode(await gh.content(str(f, "raw_url")))
          : (optStr(f, "content") ?? "");
      return {
        ...gistSummary(g),
        files: await Promise.all(
          all.map(async (f) => ({
            name: str(f, "filename"),
            size: num(f, "size"),
            ...(files === true
              ? {}
              : { content: await content(f), rawUrl: str(f, "raw_url") }),
          })),
        ),
      };
    },
  }),
  ...gistWriteOps(gh),
});
