// Pull request operations beyond create/edit/merge: locks, branch updates, reverts, status and checkout.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { lockOps } from "./conversation-lock.ts";
import { limitField, numberField, reads, repoField, writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { checkoutOp } from "./pr-checkout.ts";
import { pullNodeId } from "./pulls-read.ts";
import { at, bool, nodes, num, optStr, str } from "./read.ts";
import { byNumber, statusSearch } from "./status-search.ts";

const PULL = `fragment P on PullRequest{number title url state isDraft headRefName author{login} updatedAt reviewDecision
mergeable @include(if:$conflicts) mergeStateStatus @include(if:$conflicts) commits(last:1){nodes{commit{statusCheckRollup{state}}}}}`;

const statusPull = (conflicts: boolean) => (p: unknown) => ({
  number: num(p, "number"),
  title: str(p, "title"),
  url: str(p, "url"),
  state: str(p, "state"),
  draft: bool(p, "isDraft"),
  head: str(p, "headRefName"),
  author: optStr(p, "author", "login"),
  updatedAt: str(p, "updatedAt"),
  checks: optStr(
    nodes(p, "commits")[0],
    "commit",
    "statusCheckRollup",
    "state",
  ),
  reviewDecision: optStr(p, "reviewDecision"),
  ...(conflicts
    ? {
        mergeable: optStr(p, "mergeable"),
        mergeState: optStr(p, "mergeStateStatus"),
      }
    : {}),
});

export const pullExtraOps = (gh: GitHub) => ({
  ...lockOps(gh, "pr"),
  updateBranch: op({
    description:
      "Bring a PR branch up to date with its base by merging the base in, or with rebase by rebasing onto it; GitHub applies it asynchronously. With expectedHeadSha a moved head is refused. Replaces `gh pr update-branch`.",
    input: s.object({
      repo: repoField,
      number: numberField,
      rebase: s.optional(s.boolean()),
      expectedHeadSha: s.optional(
        s.string({ description: "Refuse unless the PR head is this commit." }),
      ),
    }),
    annotations: writes,
    run: async ({ repo, number, rebase, expectedHeadSha }) => {
      const r = await gh.repo(repo);
      const pr = await pullNodeId(gh, r.full, number);
      const method = rebase === true ? "REBASE" : "MERGE";
      await gh
        .graphql(
          `mutation($id:ID!,$method:PullRequestBranchUpdateMethod!,$sha:GitObjectID){updatePullRequestBranch(input:{pullRequestId:$id,updateMethod:$method,expectedHeadOid:$sha}){pullRequest{number}}}`,
          {
            id: pr.id,
            method,
            ...(expectedHeadSha === undefined ? {} : { sha: expectedHeadSha }),
          },
        )
        .catch((error: unknown) => {
          // GitHub reports a moved head as a plain GraphQL error; callers branch on `conflict`.
          if (
            error instanceof SurfaceError &&
            error.message.includes("head sha didn't match")
          )
            throw new SurfaceError(
              "conflict",
              error.message,
              "the PR head moved; re-read pr view and pass the new head",
            );
          throw error;
        });
      return { repo: r.full, number, method: method.toLowerCase() };
    },
  }),
  revert: op({
    description:
      "Open a pull request that reverts a merged PR; returns the new PR's number and url. Replaces `gh pr revert`.",
    input: s.object({
      repo: repoField,
      number: numberField,
      title: s.optional(s.string()),
      body: s.optional(s.string()),
      draft: s.optional(s.boolean()),
    }),
    annotations: writes,
    run: async ({ repo, number, title, body, draft }) => {
      const r = await gh.repo(repo);
      const pr = await pullNodeId(gh, r.full, number);
      const data = await gh.graphql(
        `mutation($id:ID!,$title:String,$body:String,$draft:Boolean){revertPullRequest(input:{pullRequestId:$id,title:$title,body:$body,draft:$draft}){revertPullRequest{number url}}}`,
        Object.fromEntries(
          Object.entries({ id: pr.id, title, body, draft }).filter(
            ([, v]) => v !== undefined,
          ),
        ),
      );
      const revert = at(data, "revertPullRequest", "revertPullRequest");
      return {
        repo: r.full,
        reverted: number,
        number: num(revert, "number"),
        url: str(revert, "url"),
      };
    },
  }),
  status: op({
    description:
      "Open PRs in the repo created by the authenticated user or requesting their review, plus the newest PR for `branch` when given, each with checks rollup state, review decision, mergeability with `conflicts`, and the reasons it matched. Replaces `gh pr status`.",
    input: s.object({
      repo: repoField,
      branch: s.optional(
        s.string({
          description:
            "Head branch whose PR to include (the SDK does not read the local checkout).",
        }),
      ),
      conflicts: s.optional(s.boolean()),
      limit: limitField(30),
    }),
    annotations: reads,
    run: async ({ repo, branch, conflicts, limit }) => {
      const r = await gh.repo(repo);
      const scope = `repo:${r.full} is:pr is:open`;
      const { data, user, hits } = await statusSearch(gh, {
        groups: {
          created: `${scope} author:@me`,
          reviewRequested: `${scope} review-requested:@me`,
        },
        select: "...P",
        limit: limit ?? 30,
        declare:
          ",$conflicts:Boolean!,$owner:String!,$name:String!,$branch:String!,$hasBranch:Boolean!",
        extra:
          "branch:repository(owner:$owner,name:$name) @include(if:$hasBranch){pullRequests(headRefName:$branch,first:1,orderBy:{field:CREATED_AT,direction:DESC}){nodes{...P}}}",
        fragments: PULL,
        variables: {
          conflicts: conflicts === true,
          owner: r.owner,
          name: r.name,
          branch: branch ?? "",
          hasBranch: branch !== undefined,
        },
      });
      const branchHits = nodes(data, "branch", "pullRequests").map((node) => ({
        reason: "branch",
        node,
      }));
      return {
        repo: r.full,
        user,
        items: byNumber(
          [...branchHits, ...hits],
          statusPull(conflicts === true),
        ),
      };
    },
  }),
  checkout: checkoutOp(gh),
});
