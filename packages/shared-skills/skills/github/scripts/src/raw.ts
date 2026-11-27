import { op, s } from "../vendor/surface/index.ts";
import { reads } from "./fields.ts";
import type { GitHub, Method } from "./http.ts";
import { at, isObj, num } from "./read.ts";

const bucket = (x: unknown) => ({
  limit: num(x, "limit"),
  remaining: num(x, "remaining"),
  used: num(x, "used"),
  resetsAt: new Date(num(x, "reset") * 1000).toISOString(),
});

export const rawOps = (gh: GitHub) => ({
  rest: op({
    description:
      "Any REST call for what the typed operations do not cover. Path is relative to api.github.com (repos/o/n/...). `paginate` follows Link headers up to limit; `key` names the list inside a wrapped page (workflow_runs, items). Replaces `gh api`.",
    input: s.object({
      path: s.string(),
      method: s.optional(s.enum(["GET", "POST", "PATCH", "PUT", "DELETE"])),
      query: s.optional(s.record(s.string())),
      body: s.optional(s.unknown({ description: "JSON request body." })),
      accept: s.optional(s.string()),
      paginate: s.optional(s.boolean()),
      key: s.optional(s.string()),
      limit: s.optional(
        s.integer({ description: "Max items when paginating (default 1000)." }),
      ),
    }),
    annotations: { destructive: true, openWorld: true },
    run: async ({
      path,
      method,
      query,
      body,
      accept,
      paginate,
      key,
      limit,
    }) => {
      const verb: Method = method ?? "GET";
      const req = {
        ...(query === undefined ? {} : { query }),
        ...(body === undefined ? {} : { body }),
        ...(accept === undefined ? {} : { accept }),
      };
      if (paginate === true && verb === "GET")
        return gh.list(path, limit ?? 1000, {
          ...req,
          ...(key === undefined ? {} : { key }),
        });
      return gh.rest(verb, path, req);
    },
  }),
  graphql: op({
    description:
      "Any GraphQL query or mutation; returns `data`. Errors come back as kinds (not_found, forbidden, graphql). Replaces `gh api graphql`.",
    input: s.object({
      query: s.string(),
      variables: s.optional(s.record(s.unknown())),
    }),
    annotations: { destructive: true, openWorld: true },
    run: ({ query, variables }) => gh.graphql(query, variables ?? {}),
  }),
  rate: op({
    description:
      "Remaining quota for core REST, GraphQL and search, with reset times. Replaces `gh api rate_limit`.",
    input: s.object({}),
    annotations: reads,
    run: async () => {
      const res = at(await gh.rest("GET", "rate_limit"), "resources");
      return Object.fromEntries(
        ["core", "graphql", "search", "code_search"].flatMap((k) =>
          isObj(at(res, k)) ? [[k, bucket(at(res, k))]] : [],
        ),
      );
    },
  }),
});
