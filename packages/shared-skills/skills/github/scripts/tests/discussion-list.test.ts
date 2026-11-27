import { describe, expect, test } from "bun:test";
import { discussionOps } from "../src/discussions.ts";
import { categories, graphql, page, sent } from "./discussion-fake.ts";
import { fakeGitHub } from "./fake.ts";

describe("discussionOps.list", () => {
  test("list defaults to open discussions by update time and pages until the limit", async () => {
    const { gh, seen } = fakeGitHub([
      graphql([
        [
          "discussions(",
          (v) =>
            v["after"] === null
              ? { repository: { discussions: page(1, 100, "c1") } }
              : { repository: { discussions: page(101, 50, "c2") } },
        ],
      ]),
    ]);
    const out = await discussionOps(gh).list.invoke({ limit: 150 });
    const calls = sent(seen);
    expect(calls.map((c) => [c.vars.first, c.vars.after])).toEqual([
      [100, null],
      [50, "c1"],
    ]);
    expect(calls[0]?.vars.states).toEqual(["OPEN"]);
    expect(calls[0]?.vars.orderBy).toEqual({
      field: "UPDATED_AT",
      direction: "DESC",
    });
    expect(out.items).toHaveLength(150);
    expect(out.endCursor).toBe("c2");
    expect(out.items[0]).toMatchObject({
      number: 1,
      category: "Q&A",
      answered: true,
      labels: ["bug"],
      comments: 4,
    });
  });

  test("author, label and category filters go through search with the category's real name", async () => {
    const { gh, seen } = fakeGitHub([
      graphql([
        [
          "discussionCategories",
          () => ({ repository: { id: "R_1", ...categories } }),
        ],
        ["search(", () => ({ search: page(7, 1, null) })],
      ]),
    ]);
    const out = await discussionOps(gh).list.invoke({
      state: "all",
      author: "octo",
      labels: ["good first"],
      category: "q-a",
      answered: false,
      sort: "created",
      order: "asc",
    });
    expect(sent(seen)[1]?.vars.q).toBe(
      'repo:acme/widgets author:octo label:"good first" category:"Q&A" is:unanswered sort:created-asc',
    );
    expect(out).toMatchObject({
      repo: "acme/widgets",
      endCursor: null,
      items: [{ number: 7 }],
    });
  });
});
