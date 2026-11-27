import { describe, expect, test } from "bun:test";
import { discussionOps } from "../src/discussions.ts";
import { categories, disc, graphql, sent } from "./discussion-fake.ts";
import { fakeGitHub } from "./fake.ts";

describe("discussionOps", () => {
  test("view returns the latest comments with reply counts, and a missing discussion is not_found", async () => {
    const comment = {
      id: "DC_1",
      databaseId: 11,
      url: "u",
      body: "hi",
      createdAt: "2026-01-03T00:00:00Z",
      isAnswer: true,
      upvoteCount: 2,
      author: { login: "a" },
      replies: { totalCount: 3 },
    };
    const { gh, seen } = fakeGitHub([
      graphql([
        [
          "latest:comments",
          (v) => ({
            repository: {
              discussion:
                v["number"] === 5
                  ? {
                      ...disc(5),
                      body: "b",
                      answer: { id: "DC_1", url: "au" },
                      latest: { nodes: [comment] },
                    }
                  : null,
            },
          }),
        ],
      ]),
    ]);
    const ops = discussionOps(gh);
    const out = await ops.view.invoke({ number: 5, comments: 500 });
    expect(sent(seen)[0]?.vars.comments).toBe(100);
    expect(out).toMatchObject({ number: 5, body: "b", answer: "au" });
    expect(out.latestComments).toEqual([
      {
        id: "DC_1",
        databaseId: 11,
        author: "a",
        createdAt: "2026-01-03T00:00:00Z",
        isAnswer: true,
        upvotes: 2,
        replies: 3,
        url: "u",
        body: "hi",
      },
    ]);
    const error = await ops.view.invoke({ number: 6 }).catch((e: unknown) => e);
    expect(Reflect.get(Object(error), "kind")).toBe("not_found");
  });

  test("create resolves the category and labels in one query, then creates and labels", async () => {
    const { gh, seen } = fakeGitHub([
      graphql([
        [
          "createDiscussion",
          () => ({
            createDiscussion: {
              discussion: { id: "D_9", number: 9, url: "u9" },
            },
          }),
        ],
        [
          "addLabelsToLabelable",
          () => ({ addLabelsToLabelable: { clientMutationId: null } }),
        ],
        [
          "discussionCategories",
          () => ({
            repository: { id: "R_1", ...categories, l0: { id: "L_bug" } },
          }),
        ],
      ]),
    ]);
    const out = await discussionOps(gh).create.invoke({
      title: "T",
      category: "Ideas",
      labels: ["bug"],
    });
    const calls = sent(seen);
    expect(calls[0]?.vars).toMatchObject({
      categories: true,
      byNumber: false,
      l0: "bug",
    });
    expect(calls[1]?.vars.input).toEqual({
      repositoryId: "R_1",
      categoryId: "C_ideas",
      title: "T",
      body: "",
    });
    expect(calls[2]?.vars).toEqual({ id: "D_9", labels: ["L_bug"] });
    expect(out).toEqual({
      repo: "acme/widgets",
      id: "D_9",
      number: 9,
      url: "u9",
      labels: ["bug"],
    });
  });

  test("create with an unknown category or label sends no mutation", async () => {
    const { gh, seen } = fakeGitHub([
      graphql([
        [
          "discussionCategories",
          () => ({ repository: { id: "R_1", ...categories, l0: null } }),
        ],
      ]),
    ]);
    const ops = discussionOps(gh);
    const kinds = await Promise.all([
      ops.create
        .invoke({ title: "T", category: "Nope" })
        .catch((e: unknown) => Reflect.get(Object(e), "kind")),
      ops.create
        .invoke({ title: "T", category: "q-a", labels: ["ghost"] })
        .catch((e: unknown) => Reflect.get(Object(e), "kind")),
    ]);
    expect(kinds).toEqual(["not_found", "not_found"]);
    expect(sent(seen).every((c) => !c.query.startsWith("mutation"))).toBe(true);
  });

  test("edit updates fields and labels then reads the discussion back; an empty edit sends nothing", async () => {
    const { gh, seen } = fakeGitHub([
      graphql([
        [
          "updateDiscussion",
          () => ({ updateDiscussion: { discussion: { id: "D_3" } } }),
        ],
        [
          "removeLabelsFromLabelable",
          () => ({ removeLabelsFromLabelable: { clientMutationId: null } }),
        ],
        [
          "discussionCategories",
          () => ({
            repository: {
              id: "R_1",
              discussion: { id: "D_3" },
              ...categories,
              l0: { id: "L_old" },
            },
          }),
        ],
        ["discussion(number", () => ({ repository: { discussion: disc(3) } })],
      ]),
    ]);
    const ops = discussionOps(gh);
    const empty = await ops.edit
      .invoke({ number: 3 })
      .catch((e: unknown) => Reflect.get(Object(e), "kind"));
    expect(empty).toBe("usage");
    expect(seen).toHaveLength(0);
    const out = await ops.edit.invoke({
      number: 3,
      title: "New",
      category: "ideas",
      removeLabels: ["old"],
    });
    const calls = sent(seen);
    expect(calls[0]?.vars).toMatchObject({
      number: 3,
      byNumber: true,
      categories: true,
      l0: "old",
    });
    expect(calls[1]?.vars.input).toEqual({
      discussionId: "D_3",
      title: "New",
      categoryId: "C_ideas",
    });
    expect(calls[2]?.query).toContain("removeLabelsFromLabelable");
    expect(calls[2]?.vars).toEqual({ id: "D_3", labels: ["L_old"] });
    expect(out).toMatchObject({ repo: "acme/widgets", number: 3, title: "t3" });
  });

  test("comment adds a threaded reply, edits by id without a lookup, and needs a number otherwise", async () => {
    const { gh, seen } = fakeGitHub([
      graphql([
        [
          "addDiscussionComment",
          () => ({
            addDiscussionComment: { comment: { id: "DC_new", url: "cu" } },
          }),
        ],
        [
          "updateDiscussionComment",
          () => ({
            updateDiscussionComment: { comment: { id: "DC_old", url: "ou" } },
          }),
        ],
        [
          "discussion(number",
          () => ({ repository: { id: "R_1", discussion: { id: "D_4" } } }),
        ],
      ]),
    ]);
    const ops = discussionOps(gh);
    expect(
      await ops.comment.invoke({ number: 4, body: "x", replyTo: "DC_top" }),
    ).toEqual({
      repo: "acme/widgets",
      id: "DC_new",
      url: "cu",
    });
    expect(sent(seen)[1]?.vars.input).toEqual({
      discussionId: "D_4",
      body: "x",
      replyToId: "DC_top",
    });
    expect(await ops.comment.invoke({ body: "y", editId: "DC_old" })).toEqual({
      id: "DC_old",
      url: "ou",
    });
    expect(sent(seen)[2]?.vars.input).toEqual({
      commentId: "DC_old",
      body: "y",
    });
    const kind = await ops.comment
      .invoke({ body: "z" })
      .catch((e: unknown) => Reflect.get(Object(e), "kind"));
    expect(kind).toBe("usage");
    expect(seen).toHaveLength(3);
  });
});
