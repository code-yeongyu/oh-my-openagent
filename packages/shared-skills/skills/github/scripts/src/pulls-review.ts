// Reviews: submit one, read reviews and their line threads, reply in a thread, resolve it, dismiss a review.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { numberField, reads, repoField, writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { at, bool, nodes, num, optNum, optStr, str } from "./read.ts";

const REVIEWS = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){
reviewDecision
reviews(first:100){nodes{id author{login} state body submittedAt url}}
reviewThreads(first:100){nodes{id path line startLine isOutdated isResolved resolvedBy{login}
comments(first:50){nodes{id author{login} body createdAt url}}}}}}}`;

const threadIdField = s.string({
  description: "Review thread id from `pr reviews` (threads[].id).",
});

const comment = (c: unknown) => ({
  id: str(c, "id"),
  author: optStr(c, "author", "login"),
  body: str(c, "body"),
  createdAt: str(c, "createdAt"),
  url: str(c, "url"),
});

export const pullReviewOps = (gh: GitHub) => ({
  review: op({
    description:
      "Submit a review on a PR: approve, request changes or comment, optionally with comments on lines of the diff. `body` is required unless approving or sending line comments with a comment review. Replaces `gh pr review`.",
    input: s.object({
      repo: repoField,
      number: numberField,
      event: s.enum(["approve", "request_changes", "comment"]),
      body: s.optional(s.string()),
      comments: s.optional(
        s.array(
          s.object({
            path: s.string(),
            line: s.integer({
              description: "Line in the file (the last one of a range).",
            }),
            startLine: s.optional(s.integer()),
            side: s.optional(
              s.enum(["LEFT", "RIGHT"], {
                description: "RIGHT (default) is the new version.",
              }),
            ),
            body: s.string(),
          }),
        ),
      ),
    }),
    annotations: writes,
    run: async ({ repo, number, event, body, comments }) => {
      const lineComments = comments ?? [];
      const needsBody =
        event === "request_changes" ||
        (event === "comment" && lineComments.length === 0);
      if (needsBody && (body === undefined || body === ""))
        throw new SurfaceError(
          "usage",
          `a ${event} review needs a body`,
          "pass body",
        );
      const r = await gh.repo(repo);
      const v = await gh.rest(
        "POST",
        `repos/${r.full}/pulls/${number}/reviews`,
        {
          body: {
            event: event.toUpperCase(),
            ...(body === undefined ? {} : { body }),
            ...(lineComments.length === 0
              ? {}
              : {
                  comments: lineComments.map((c) => ({
                    path: c.path,
                    line: c.line,
                    side: c.side ?? "RIGHT",
                    body: c.body,
                    ...(c.startLine === undefined
                      ? {}
                      : { start_line: c.startLine }),
                  })),
                }),
          },
        },
      );
      return {
        repo: r.full,
        number,
        id: num(v, "id"),
        state: str(v, "state"),
        url: str(v, "html_url"),
      };
    },
  }),
  reviews: op({
    description:
      "A PR's reviews with their bodies, and its line-comment threads with path, line, resolved and outdated flags and every comment (first 100 reviews and threads). `unresolvedOnly` keeps the threads still open. Replaces `gh pr view --json reviews` plus the review threads gh does not show.",
    input: s.object({
      repo: repoField,
      number: numberField,
      unresolvedOnly: s.optional(s.boolean()),
    }),
    annotations: reads,
    run: async ({ repo, number, unresolvedOnly }) => {
      const r = await gh.repo(repo);
      const pr = at(
        await gh.graphql(REVIEWS, { owner: r.owner, name: r.name, number }),
        "repository",
        "pullRequest",
      );
      const threads = nodes(pr, "reviewThreads").map((t) => ({
        id: str(t, "id"),
        path: str(t, "path"),
        line: optNum(t, "line"),
        // GitHub reports a one-line thread with startLine equal to line; only a real range keeps it.
        startLine:
          optNum(t, "startLine") === optNum(t, "line")
            ? null
            : optNum(t, "startLine"),
        resolved: bool(t, "isResolved"),
        resolvedBy: optStr(t, "resolvedBy", "login"),
        outdated: bool(t, "isOutdated"),
        comments: nodes(t, "comments").map(comment),
      }));
      return {
        repo: r.full,
        number,
        reviewDecision: optStr(pr, "reviewDecision"),
        reviews: nodes(pr, "reviews").map((v) => ({
          id: str(v, "id"),
          author: optStr(v, "author", "login"),
          state: str(v, "state"),
          body: str(v, "body"),
          submittedAt: optStr(v, "submittedAt"),
          url: str(v, "url"),
        })),
        threads:
          unresolvedOnly === true
            ? threads.filter((t) => !t.resolved)
            : threads,
      };
    },
  }),
  replyToThread: op({
    description:
      "Reply inside a review thread (the line-comment conversation), for example to say what the fix was.",
    input: s.object({ threadId: threadIdField, body: s.string() }),
    annotations: writes,
    run: async ({ threadId, body }) => {
      const data = await gh.graphql(
        `mutation($id:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id,body:$body}){comment{id author{login} body createdAt url}}}`,
        { id: threadId, body },
      );
      return {
        threadId,
        ...comment(at(data, "addPullRequestReviewThreadReply", "comment")),
      };
    },
  }),
  resolveThread: op({
    description:
      "Mark a review thread resolved, or with undo reopen it. Resolve only after the reply or the fix it asks for is in.",
    input: s.object({
      threadId: threadIdField,
      undo: s.optional(s.boolean()),
    }),
    annotations: writes,
    run: async ({ threadId, undo }) => {
      const field =
        undo === true ? "unresolveReviewThread" : "resolveReviewThread";
      const data = await gh.graphql(
        `mutation($id:ID!){${field}(input:{threadId:$id}){thread{id isResolved}}}`,
        { id: threadId },
      );
      return { threadId, resolved: bool(data, field, "thread", "isResolved") };
    },
  }),
  dismissReview: op({
    description:
      "Dismiss an approving or change-requesting review with a message, so it no longer counts toward the review decision.",
    input: s.object({
      reviewId: s.string({
        description: "Review id from `pr reviews` (reviews[].id).",
      }),
      message: s.string(),
    }),
    annotations: writes,
    run: async ({ reviewId, message }) => {
      const data = await gh.graphql(
        `mutation($id:ID!,$message:String!){dismissPullRequestReview(input:{pullRequestReviewId:$id,message:$message}){pullRequestReview{id state}}}`,
        { id: reviewId, message },
      );
      return {
        reviewId,
        state: str(
          data,
          "dismissPullRequestReview",
          "pullRequestReview",
          "state",
        ),
      };
    },
  }),
});
