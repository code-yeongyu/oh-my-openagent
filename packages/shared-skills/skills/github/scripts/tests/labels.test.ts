import { describe, expect, test } from "bun:test";
import { labelOps } from "../src/labels.ts";
import { fakeGitHub, json, on } from "./fake.ts";

const kindOf = async (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e: unknown) => String(Reflect.get(Object(e), "kind")),
  );

const rest = (name: string, color = "ededed", description = "") => ({
  id: 1,
  name,
  color,
  description,
  default: false,
});

const gqlLabel = (name: string) => ({
  name,
  color: "d73a4a",
  description: null,
  isDefault: name === "bug",
  createdAt: "2024-01-01T00:00:00Z",
  url: `https://github.com/acme/widgets/labels/${name}`,
});

describe("labels", () => {
  test("list pages through GraphQL with search, sort and order until the limit", async () => {
    const pages = [
      {
        nodes: [gqlLabel("bug"), gqlLabel("bugfix")],
        pageInfo: { hasNextPage: true, endCursor: "c1" },
      },
      {
        nodes: [gqlLabel("debug")],
        pageInfo: { hasNextPage: true, endCursor: "c2" },
      },
    ];
    let call = 0;
    const { gh, seen } = fakeGitHub([
      on("POST", /\/graphql$/, () =>
        json({ data: { repository: { labels: pages[call++] } } }),
      ),
    ]);
    const out = await labelOps(gh).list.invoke({
      search: "bug",
      sort: "name",
      order: "desc",
      limit: 3,
    });
    expect(seen.map((r) => Reflect.get(Object(r.body), "variables"))).toEqual([
      {
        owner: "acme",
        name: "widgets",
        first: 3,
        after: null,
        query: "bug",
        field: "NAME",
        direction: "DESC",
      },
      {
        owner: "acme",
        name: "widgets",
        first: 1,
        after: "c1",
        query: "bug",
        field: "NAME",
        direction: "DESC",
      },
    ]);
    expect(out.repo).toBe("acme/widgets");
    expect(out.items.map((l) => l.name)).toEqual(["bug", "bugfix", "debug"]);
    expect(out.items[0]).toEqual(gqlLabel("bug"));
  });

  test("create posts the label with the color stripped of '#'", async () => {
    const { gh, seen } = fakeGitHub([
      on("POST", /\/repos\/acme\/widgets\/labels$/, () =>
        json(rest("bug", "d73a4a", "broken"), 201),
      ),
    ]);
    const out = await labelOps(gh).create.invoke({
      name: "bug",
      color: "#d73a4a",
      description: "broken",
    });
    expect(seen[0]?.body).toEqual({
      name: "bug",
      color: "d73a4a",
      description: "broken",
    });
    expect(out).toMatchObject({ action: "created", name: "bug", id: 1 });
  });

  test("create with force updates an existing label; without force the conflict surfaces", async () => {
    const exists = () =>
      json(
        {
          message: "Validation Failed",
          errors: [
            { resource: "Label", code: "already_exists", field: "name" },
          ],
        },
        422,
      );
    const routes = [
      on("POST", /\/labels$/, exists),
      on("PATCH", /\/labels\/good%20first$/, () =>
        json(rest("good first", "00ff00")),
      ),
    ];
    const forced = fakeGitHub(routes);
    const out = await labelOps(forced.gh).create.invoke({
      name: "good first",
      color: "00ff00",
      force: true,
    });
    expect(forced.seen.map((r) => r.method)).toEqual(["POST", "PATCH"]);
    expect(forced.seen[1]?.body).toEqual({ color: "00ff00" });
    expect(out).toMatchObject({ action: "updated", color: "00ff00" });

    const plain = fakeGitHub(routes);
    expect(
      await kindOf(labelOps(plain.gh).create.invoke({ name: "good first" })),
    ).toBe("invalid");
    expect(plain.seen.map((r) => r.method)).toEqual(["POST"]);
  });

  test("create with force does not swallow other validation failures", async () => {
    const { gh, seen } = fakeGitHub([
      on("POST", /\/labels$/, () =>
        json(
          {
            message: "Validation Failed",
            errors: [{ resource: "Label", code: "invalid", field: "color" }],
          },
          422,
        ),
      ),
    ]);
    expect(
      await kindOf(
        labelOps(gh).create.invoke({ name: "x", color: "zz", force: true }),
      ),
    ).toBe("invalid");
    expect(seen).toHaveLength(1);
  });

  test("edit renames and recolors; an empty edit sends nothing", async () => {
    const { gh, seen } = fakeGitHub([
      on("PATCH", /\/labels\/bug$/, () => json(rest("defect", "000000"))),
    ]);
    const ops = labelOps(gh);
    const out = await ops.edit.invoke({
      name: "bug",
      newName: "defect",
      color: "#000000",
    });
    expect(seen[0]?.body).toEqual({ new_name: "defect", color: "000000" });
    expect(out).toMatchObject({ repo: "acme/widgets", name: "defect" });
    expect(await kindOf(ops.edit.invoke({ name: "bug" }))).toBe("usage");
    expect(seen).toHaveLength(1);
  });

  test("delete sends DELETE to the encoded label name", async () => {
    const { gh, seen } = fakeGitHub([
      on(
        "DELETE",
        /\/labels\/needs%20triage$/,
        () => new Response(null, { status: 204 }),
      ),
    ]);
    expect(await labelOps(gh).delete.invoke({ name: "needs triage" })).toEqual({
      repo: "acme/widgets",
      name: "needs triage",
      deleted: true,
    });
    expect(seen).toHaveLength(1);
  });

  const cloneRoutes = () => [
    on("GET", /\/repos\/acme\/template\/labels/, () =>
      json([rest("bug", "d73a4a", "broken"), rest("docs", "0075ca")]),
    ),
    on("GET", /\/repos\/acme\/widgets\/labels/, () => json([rest("BUG")])),
    on("POST", /\/repos\/acme\/widgets\/labels$/, () =>
      json(rest("docs"), 201),
    ),
    on("PATCH", /\/repos\/acme\/widgets\/labels\/BUG$/, () =>
      json(rest("bug")),
    ),
  ];

  test("clone creates missing labels and skips existing names case-insensitively", async () => {
    const { gh, seen } = fakeGitHub(cloneRoutes());
    const out = await labelOps(gh).clone.invoke({ source: "acme/template" });
    expect(out).toEqual({
      repo: "acme/widgets",
      source: "acme/template",
      created: ["docs"],
      updated: [],
      skipped: ["bug"],
    });
    const writes = seen.filter((r) => r.method !== "GET");
    expect(writes.map((r) => [r.method, r.body])).toEqual([
      ["POST", { name: "docs", color: "0075ca", description: "" }],
    ]);
  });

  test("clone with force overwrites an existing label with the source's fields", async () => {
    const { gh, seen } = fakeGitHub(cloneRoutes());
    const out = await labelOps(gh).clone.invoke({
      source: "acme/template",
      force: true,
    });
    expect(out.updated).toEqual(["bug"]);
    expect(out.skipped).toEqual([]);
    const patch = seen.find((r) => r.method === "PATCH");
    expect(patch?.body).toEqual({
      new_name: "bug",
      color: "d73a4a",
      description: "broken",
    });
  });
});
