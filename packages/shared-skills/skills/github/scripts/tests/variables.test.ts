import { describe, expect, test } from "bun:test";
import { variableOps } from "../src/variables.ts";
import { fakeGitHub, json, on } from "./fake.ts";

const v = { name: "REGION", value: "eu", created_at: "c", updated_at: "u" };
const empty = (status: number) => () => new Response(null, { status });

describe("variables", () => {
  test("list reads the repo's variables", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /\/repos\/acme\/widgets\/actions\/variables/, () =>
        json({ total_count: 1, variables: [v] }),
      ),
    ]);
    expect(await variableOps(gh).list.invoke({})).toEqual({
      repo: "acme/widgets",
      items: [
        {
          name: "REGION",
          value: "eu",
          createdAt: "c",
          updatedAt: "u",
          visibility: null,
        },
      ],
    });
    expect(seen).toHaveLength(1);
  });

  test("get reads one environment variable", async () => {
    const { gh } = fakeGitHub([
      on(
        "GET",
        /\/repos\/acme\/widgets\/environments\/prod\/variables\/REGION$/,
        () => json(v),
      ),
    ]);
    expect(
      await variableOps(gh).get.invoke({ name: "REGION", env: "prod" }),
    ).toEqual({
      repo: "acme/widgets",
      env: "prod",
      name: "REGION",
      value: "eu",
      createdAt: "c",
      updatedAt: "u",
      visibility: null,
    });
  });

  test("set updates an existing variable in place", async () => {
    const { gh, seen } = fakeGitHub([
      on(
        "PATCH",
        /\/repos\/acme\/widgets\/actions\/variables\/REGION$/,
        empty(204),
      ),
    ]);
    expect(
      await variableOps(gh).set.invoke({ name: "REGION", value: "us" }),
    ).toEqual({
      repo: "acme/widgets",
      name: "REGION",
      value: "us",
      created: false,
    });
    expect(seen.map((r) => r.method)).toEqual(["PATCH"]);
    expect(seen[0]?.body).toEqual({ name: "REGION", value: "us" });
  });

  test("set creates the variable when the update finds none", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /^\/repos\/acme\/api$/, () => json({ id: 5 })),
      on("PATCH", /\/orgs\/acme\/actions\/variables\/NEW$/, () =>
        json({ message: "Not Found" }, 404),
      ),
      on("POST", /\/orgs\/acme\/actions\/variables$/, empty(201)),
    ]);
    const res = await variableOps(gh).set.invoke({
      name: "NEW",
      value: "1",
      org: "acme",
      repos: ["api"],
    });
    expect(res).toEqual({
      org: "acme",
      name: "NEW",
      value: "1",
      created: true,
    });
    expect(seen.at(-1)?.body).toEqual({
      name: "NEW",
      value: "1",
      visibility: "selected",
      selected_repository_ids: [5],
    });
  });

  test("set does not create on an error other than not found", async () => {
    const { gh, seen } = fakeGitHub([
      on("PATCH", /variables\/X$/, () => json({ message: "Forbidden" }, 403)),
    ]);
    const kind = await variableOps(gh)
      .set.invoke({ name: "X", value: "1" })
      .then(
        () => "resolved",
        (e: unknown) => String(Reflect.get(Object(e), "kind")),
      );
    expect(kind).toBe("forbidden");
    expect(seen.map((r) => r.method)).toEqual(["PATCH"]);
  });

  test("visibility outside org scope is a usage error with no request", async () => {
    const { gh, seen } = fakeGitHub([]);
    const kind = await variableOps(gh)
      .set.invoke({ name: "X", value: "1", visibility: "all" })
      .then(
        () => "resolved",
        (e: unknown) => String(Reflect.get(Object(e), "kind")),
      );
    expect(kind).toBe("usage");
    expect(seen).toHaveLength(0);
  });

  test("delete removes an org variable", async () => {
    const { gh, seen } = fakeGitHub([
      on("DELETE", /\/orgs\/acme\/actions\/variables\/OLD$/, empty(204)),
    ]);
    expect(
      await variableOps(gh).delete.invoke({ name: "OLD", org: "acme" }),
    ).toEqual({
      org: "acme",
      name: "OLD",
      deleted: true,
    });
    expect(seen).toHaveLength(1);
  });
});
