// Listing and deleting GitHub Actions caches.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { irreversible, limitField, reads, repoField } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { arr, at, num, optStr, str } from "./read.ts";

const refField = s.optional(
  s.string({
    description: "refs/heads/<branch> or refs/pull/<number>/merge.",
  }),
);

const cache = (c: unknown) => ({
  id: num(c, "id"),
  key: str(c, "key"),
  ref: str(c, "ref"),
  sizeInBytes: num(c, "size_in_bytes"),
  createdAt: optStr(c, "created_at"),
  lastAccessedAt: optStr(c, "last_accessed_at"),
});

const listCaches = async (
  gh: GitHub,
  full: string,
  limit: number,
  query: Readonly<Record<string, string | undefined>>,
) =>
  (
    await gh.list(`repos/${full}/actions/caches`, limit, {
      query,
      key: "actions_caches",
    })
  ).map(cache);

export const cacheOps = (gh: GitHub) => ({
  list: op({
    description:
      "Actions caches with key, ref, size and access times, filterable by key prefix and ref. Replaces `gh cache list`.",
    input: s.object({
      repo: repoField,
      key: s.optional(s.string({ description: "Cache key prefix." })),
      ref: refField,
      sort: s.optional(
        s.enum(["created_at", "last_accessed_at", "size_in_bytes"]),
      ),
      order: s.optional(s.enum(["asc", "desc"])),
      limit: limitField(30),
    }),
    annotations: reads,
    run: async ({ repo, key, ref, sort, order, limit }) => {
      const r = await gh.repo(repo);
      return {
        repo: r.full,
        items: await listCaches(gh, r.full, limit ?? 30, {
          key,
          ref,
          sort,
          direction: order,
        }),
      };
    },
  }),
  delete: op({
    description:
      "Delete caches by id, by exact key (optionally only on one ref), or all of them (optionally only on one ref); returns how many were deleted. Replaces `gh cache delete`.",
    input: s.object({
      repo: repoField,
      id: s.optional(s.integer({ description: "Cache id." })),
      key: s.optional(s.string({ description: "Exact cache key." })),
      all: s.optional(s.boolean()),
      ref: refField,
    }),
    annotations: irreversible,
    run: async ({ repo, id, key, all, ref }) => {
      const modes = [id !== undefined, key !== undefined, all === true];
      if (
        modes.filter(Boolean).length !== 1 ||
        (id !== undefined && ref !== undefined)
      )
        throw new SurfaceError(
          "usage",
          "pass exactly one of id, key or all (ref only with key or all)",
          "find ids and keys with `cache list`",
        );
      const r = await gh.repo(repo);
      let ids: number[];
      if (id !== undefined) {
        await gh.rest("DELETE", `repos/${r.full}/actions/caches/${id}`);
        ids = [id];
      } else if (key !== undefined) {
        const x = await gh.rest("DELETE", `repos/${r.full}/actions/caches`, {
          query: { key, ref },
        });
        ids = arr(at(x, "actions_caches"), "actions_caches").map((c) =>
          num(c, "id"),
        );
      } else {
        ids = (await listCaches(gh, r.full, 100_000, { ref })).map((c) => c.id);
        for (const each of ids)
          await gh.rest("DELETE", `repos/${r.full}/actions/caches/${each}`);
      }
      return { repo: r.full, deleted: ids.length, ids };
    },
  }),
});
