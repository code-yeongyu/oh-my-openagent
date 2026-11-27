// Issue operations beyond create/edit/close: delete, locks, pins, transfer, linked branches and status.
import { op, s } from "../vendor/surface/index.ts";
import { lockOps } from "./conversation-lock.ts";
import {
  irreversible,
  limitField,
  numberField,
  reads,
  repoField,
  writes,
} from "./fields.ts";
import type { GitHub } from "./http.ts";
import { developOp } from "./issue-develop.ts";
import { at, bool, names, num, optStr, str } from "./read.ts";
import { byNumber, statusSearch } from "./status-search.ts";

const issueNodeId = async (gh: GitHub, full: string, number: number) =>
  str(await gh.rest("GET", `repos/${full}/issues/${number}`), "node_id");

const statusIssue = (i: unknown) => ({
  number: num(i, "number"),
  title: str(i, "title"),
  url: str(i, "url"),
  state: str(i, "state"),
  author: optStr(i, "author", "login"),
  updatedAt: str(i, "updatedAt"),
  labels: names(i, "name", "labels"),
});

const pinOp = (gh: GitHub, pin: boolean) => {
  const mutation = pin ? "pinIssue" : "unpinIssue";
  return op({
    description: pin
      ? "Pin an issue to the top of the repo's issue list (at most three are pinned). Replaces `gh issue pin`."
      : "Unpin an issue. Replaces `gh issue unpin`.",
    input: s.object({ repo: repoField, number: numberField }),
    annotations: { ...writes, idempotent: true },
    run: async ({ repo, number }) => {
      const r = await gh.repo(repo);
      const id = await issueNodeId(gh, r.full, number);
      const data = await gh.graphql(
        `mutation($id:ID!){${mutation}(input:{issueId:$id}){issue{isPinned}}}`,
        { id },
      );
      return {
        repo: r.full,
        number,
        pinned: bool(data, mutation, "issue", "isPinned"),
      };
    },
  });
};

export const issueExtraOps = (gh: GitHub) => ({
  delete: op({
    description:
      "Delete an issue permanently; needs admin rights and cannot be undone. Replaces `gh issue delete`.",
    input: s.object({ repo: repoField, number: numberField }),
    annotations: irreversible,
    run: async ({ repo, number }) => {
      const r = await gh.repo(repo);
      const id = await issueNodeId(gh, r.full, number);
      await gh.graphql(
        "mutation($id:ID!){deleteIssue(input:{issueId:$id}){clientMutationId}}",
        { id },
      );
      return { repo: r.full, number, deleted: true };
    },
  }),
  ...lockOps(gh, "issue"),
  pin: pinOp(gh, true),
  unpin: pinOp(gh, false),
  transfer: op({
    description:
      "Move an issue to another repository; it gets a new number there and the old url redirects. Returns the new repo, number and url. Replaces `gh issue transfer`.",
    input: s.object({
      repo: repoField,
      number: numberField,
      destination: s.string({ description: "owner/name to move it to." }),
      createLabelsIfMissing: s.optional(
        s.boolean({
          description: "Create the issue's labels in the destination.",
        }),
      ),
    }),
    annotations: writes,
    run: async ({ repo, number, destination, createLabelsIfMissing }) => {
      const r = await gh.repo(repo);
      const dest = await gh.repo(destination);
      const [issueId, repositoryId] = await Promise.all([
        issueNodeId(gh, r.full, number),
        gh.rest("GET", `repos/${dest.full}`).then((d) => str(d, "node_id")),
      ]);
      const data = await gh.graphql(
        `mutation($issue:ID!,$repo:ID!,$labels:Boolean){transferIssue(input:{issueId:$issue,repositoryId:$repo,createLabelsIfMissing:$labels}){issue{number url repository{nameWithOwner}}}}`,
        {
          issue: issueId,
          repo: repositoryId,
          ...(createLabelsIfMissing === undefined
            ? {}
            : { labels: createLabelsIfMissing }),
        },
      );
      const moved = at(data, "transferIssue", "issue");
      return {
        from: r.full,
        repo: str(moved, "repository", "nameWithOwner"),
        number: num(moved, "number"),
        url: str(moved, "url"),
      };
    },
  }),
  develop: developOp(gh),
  status: op({
    description:
      "Open issues in the repo assigned to, mentioning or opened by the authenticated user, each with the reasons it matched. Replaces `gh issue status`.",
    input: s.object({ repo: repoField, limit: limitField(30) }),
    annotations: reads,
    run: async ({ repo, limit }) => {
      const r = await gh.repo(repo);
      const scope = `repo:${r.full} is:issue is:open`;
      const { user, hits } = await statusSearch(gh, {
        groups: {
          assigned: `${scope} assignee:@me`,
          mentioned: `${scope} mentions:@me`,
          opened: `${scope} author:@me`,
        },
        select:
          "... on Issue{number title url state updatedAt author{login} labels(first:20){nodes{name}}}",
        limit: limit ?? 30,
      });
      return { repo: r.full, user, items: byNumber(hits, statusIssue) };
    },
  }),
});
