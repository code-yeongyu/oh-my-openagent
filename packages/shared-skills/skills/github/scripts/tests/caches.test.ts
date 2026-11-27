import { describe, expect, test } from "bun:test";
import { cacheOps } from "../src/caches.ts";
import { fakeGitHub, json, on, type Seen } from "./fake.ts";

const entry = (id: number, ref = "refs/heads/main") => ({
  id,
  key: `deps-${id}`,
  ref,
  version: "v",
  size_in_bytes: 100 * id,
  created_at: "2026-11-01T00:00:00Z",
  last_accessed_at: "2026-11-02T00:00:00Z",
});
const pathOf = (req: Seen | undefined) =>
  req === undefined ? "" : new URL(req.url).pathname + new URL(req.url).search;
const gone = () => new Response(null, { status: 204 });
const kindOf = async (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e: unknown) => String(Reflect.get(Object(e), "kind")),
  );

describe("caches", () => {
  test("list passes key, ref, sort and order and trims each cache", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /\/actions\/caches\?/, () =>
        json({ total_count: 1, actions_caches: [entry(1)] }),
      ),
    ]);
    const out = await cacheOps(gh).list.invoke({
      key: "deps-",
      ref: "refs/heads/main",
      sort: "size_in_bytes",
      order: "asc",
      limit: 5,
    });
    expect(pathOf(seen[0])).toBe(
      "/repos/acme/widgets/actions/caches?key=deps-&ref=refs%2Fheads%2Fmain&sort=size_in_bytes&direction=asc&per_page=5",
    );
    expect(out).toEqual({
      repo: "acme/widgets",
      items: [
        {
          id: 1,
          key: "deps-1",
          ref: "refs/heads/main",
          sizeInBytes: 100,
          createdAt: "2026-11-01T00:00:00Z",
          lastAccessedAt: "2026-11-02T00:00:00Z",
        },
      ],
    });
  });

  test("delete by id, by key with ref, and all on a ref", async () => {
    const { gh, seen } = fakeGitHub([
      on("DELETE", /\/actions\/caches\/\d+$/, gone),
      on("DELETE", /\/actions\/caches\?key=/, () =>
        json({ total_count: 2, actions_caches: [entry(3), entry(4)] }),
      ),
      on("GET", /\/actions\/caches\?/, () =>
        json({
          actions_caches: [
            entry(5, "refs/pull/1/merge"),
            entry(6, "refs/pull/1/merge"),
          ],
        }),
      ),
    ]);
    const ops = cacheOps(gh);
    expect(await ops.delete.invoke({ id: 9 })).toEqual({
      repo: "acme/widgets",
      deleted: 1,
      ids: [9],
    });
    expect(
      await ops.delete.invoke({ key: "deps-x", ref: "refs/heads/main" }),
    ).toMatchObject({
      deleted: 2,
      ids: [3, 4],
    });
    expect(pathOf(seen[1])).toBe(
      "/repos/acme/widgets/actions/caches?key=deps-x&ref=refs%2Fheads%2Fmain",
    );
    const before = seen.length;
    expect(
      await ops.delete.invoke({ all: true, ref: "refs/pull/1/merge" }),
    ).toMatchObject({
      deleted: 2,
      ids: [5, 6],
    });
    expect(seen.slice(before).map((r) => `${r.method} ${pathOf(r)}`)).toEqual([
      "GET /repos/acme/widgets/actions/caches?ref=refs%2Fpull%2F1%2Fmerge&per_page=100",
      "DELETE /repos/acme/widgets/actions/caches/5",
      "DELETE /repos/acme/widgets/actions/caches/6",
    ]);
  });

  test("delete needs exactly one selector and refuses ref with id, sending nothing", async () => {
    const { gh, seen } = fakeGitHub([]);
    const ops = cacheOps(gh);
    for (const bad of [
      {},
      { id: 1, key: "k" },
      { id: 1, ref: "refs/heads/main" },
      { all: false },
    ])
      expect(await kindOf(ops.delete.invoke(bad))).toBe("usage");
    expect(seen).toHaveLength(0);
  });
});
