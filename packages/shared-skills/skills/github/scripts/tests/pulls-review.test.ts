import { describe, expect, test } from "bun:test";
import { pullReviewOps } from "../src/pulls-review.ts";
import { fakeGitHub, json, on, type Seen } from "./fake.ts";

const thread = (id: string, resolved: boolean, startLine = 12) => ({
  id,
  path: "src/a.ts",
  line: 12,
  startLine,
  isOutdated: false,
  isResolved: resolved,
  resolvedBy: resolved ? { login: "octo" } : null,
  comments: {
    nodes: [
      {
        id: `${id}-c1`,
        author: { login: "reviewer" },
        body: "rename this",
        createdAt: "2026-11-26T00:00:00Z",
        url: "u",
      },
    ],
  },
});

const variables = (req: Seen | undefined) =>
  Reflect.get(Object(req?.body), "variables");
const query = (req: Seen | undefined) =>
  String(Reflect.get(Object(req?.body), "query"));

describe("review feedback", () => {
  test("reviews returns bodies and threads, and unresolvedOnly drops the resolved ones", async () => {
    const { gh, seen } = fakeGitHub([
      on("POST", /\/graphql$/, () =>
        json({
          data: {
            repository: {
              pullRequest: {
                reviewDecision: "CHANGES_REQUESTED",
                reviews: {
                  nodes: [
                    {
                      id: "R1",
                      author: { login: "reviewer" },
                      state: "CHANGES_REQUESTED",
                      body: "two things",
                      submittedAt: "2026-11-26T00:00:00Z",
                      url: "ru",
                    },
                  ],
                },
                reviewThreads: {
                  nodes: [thread("T1", false), thread("T2", true, 9)],
                },
              },
            },
          },
        }),
      ),
    ]);
    const ops = pullReviewOps(gh);
    const all = await ops.reviews.invoke({ number: 7 });
    expect(variables(seen[0])).toEqual({
      owner: "acme",
      name: "widgets",
      number: 7,
    });
    expect(all.reviewDecision).toBe("CHANGES_REQUESTED");
    expect(all.reviews).toEqual([
      {
        id: "R1",
        author: "reviewer",
        state: "CHANGES_REQUESTED",
        body: "two things",
        submittedAt: "2026-11-26T00:00:00Z",
        url: "ru",
      },
    ]);
    expect(
      all.threads.map((t) => [t.id, t.resolved, t.resolvedBy, t.startLine]),
    ).toEqual([
      ["T1", false, null, null],
      ["T2", true, "octo", 9],
    ]);
    expect(all.threads[0]?.comments[0]).toMatchObject({
      id: "T1-c1",
      author: "reviewer",
      body: "rename this",
    });
    const open = await ops.reviews.invoke({ number: 7, unresolvedOnly: true });
    expect(open.threads.map((t) => t.id)).toEqual(["T1"]);
  });

  test("replyToThread, resolveThread and its undo, and dismissReview each send their own mutation", async () => {
    const { gh, seen } = fakeGitHub([
      on("POST", /\/graphql$/, (req) => {
        const q = query(req);
        if (q.includes("addPullRequestReviewThreadReply"))
          return json({
            data: {
              addPullRequestReviewThreadReply: {
                comment: {
                  id: "C9",
                  author: { login: "me" },
                  body: "fixed in abc123",
                  createdAt: "t",
                  url: "cu",
                },
              },
            },
          });
        if (q.includes("unresolveReviewThread"))
          return json({
            data: {
              unresolveReviewThread: {
                thread: { id: "T1", isResolved: false },
              },
            },
          });
        if (q.includes("resolveReviewThread"))
          return json({
            data: {
              resolveReviewThread: { thread: { id: "T1", isResolved: true } },
            },
          });
        return json({
          data: {
            dismissPullRequestReview: {
              pullRequestReview: { id: "R1", state: "DISMISSED" },
            },
          },
        });
      }),
    ]);
    const ops = pullReviewOps(gh);
    expect(
      await ops.replyToThread.invoke({
        threadId: "T1",
        body: "fixed in abc123",
      }),
    ).toMatchObject({ threadId: "T1", id: "C9", body: "fixed in abc123" });
    expect(variables(seen[0])).toEqual({ id: "T1", body: "fixed in abc123" });
    expect(await ops.resolveThread.invoke({ threadId: "T1" })).toEqual({
      threadId: "T1",
      resolved: true,
    });
    expect(
      await ops.resolveThread.invoke({ threadId: "T1", undo: true }),
    ).toEqual({ threadId: "T1", resolved: false });
    expect(
      await ops.dismissReview.invoke({ reviewId: "R1", message: "stale" }),
    ).toEqual({ reviewId: "R1", state: "DISMISSED" });
    expect(variables(seen[3])).toEqual({ id: "R1", message: "stale" });
  });

  test("a comment review may carry only line comments, sent in GitHub's field names", async () => {
    const { gh, seen } = fakeGitHub([
      on("POST", /\/pulls\/7\/reviews$/, () =>
        json({ id: 5, state: "COMMENTED", html_url: "u" }),
      ),
    ]);
    const ops = pullReviewOps(gh);
    await ops.review.invoke({
      number: 7,
      event: "comment",
      comments: [
        { path: "src/a.ts", line: 12, body: "rename this" },
        { path: "src/b.ts", line: 9, startLine: 4, side: "LEFT", body: "why" },
      ],
    });
    expect(seen[0]?.body).toEqual({
      event: "COMMENT",
      comments: [
        { path: "src/a.ts", line: 12, side: "RIGHT", body: "rename this" },
        { path: "src/b.ts", line: 9, side: "LEFT", body: "why", start_line: 4 },
      ],
    });
    const refused = await ops.review
      .invoke({
        number: 7,
        event: "request_changes",
        comments: [{ path: "src/a.ts", line: 1, body: "x" }],
      })
      .then(
        () => "resolved",
        (e: unknown) => String(Reflect.get(Object(e), "kind")),
      );
    expect(refused).toBe("usage");
    expect(seen).toHaveLength(1);
  });
});
