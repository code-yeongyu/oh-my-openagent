import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { numberField, reads, repoField } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { at, bool, names, nodes, num, optNum, optStr, str } from "./read.ts";

const VIEW = `query($owner:String!,$name:String!,$number:Int!,$comments:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){
id number title url state isDraft merged mergedAt closedAt createdAt updatedAt body author{login}
headRefName headRefOid baseRefName headRepository{nameWithOwner} mergeable mergeStateStatus reviewDecision
additions deletions changedFiles labels(first:50){nodes{name}} assignees(first:20){nodes{login}}
reviewRequests(first:20){nodes{requestedReviewer{... on User{login} ... on Team{slug}}}}
latestReviews(first:20){nodes{author{login} state submittedAt}} closingIssuesReferences(first:20){nodes{number}}
commits(last:1){nodes{commit{statusCheckRollup{state}}}}
comments(last:$comments){totalCount nodes{author{login} body createdAt url}}}}}`;

export const pullViewOp = (gh: GitHub) =>
  op({
    description:
      "One pull request: state, draft/merged, mergeability, review decision, head SHA, labels, reviewers, linked issues, rollup check state, and optionally its last N comments. Replaces `gh pr view --json ...`.",
    input: s.object({
      repo: repoField,
      number: numberField,
      comments: s.optional(
        s.integer({
          description:
            "How many of the latest conversation comments to include (default 0, max 100).",
        }),
      ),
      body: s.optional(
        s.boolean({
          description: "Include the PR description (default true).",
        }),
      ),
    }),
    annotations: reads,
    run: async ({ repo, number, comments, body }) => {
      const r = await gh.repo(repo);
      const data = await gh.graphql(VIEW, {
        owner: r.owner,
        name: r.name,
        number,
        comments: Math.min(comments ?? 0, 100),
      });
      const p = at(data, "repository", "pullRequest");
      if (p === null || p === undefined)
        throw new SurfaceError(
          "not_found",
          `no pull request #${number} in ${r.full}`,
          "check the number",
        );
      return {
        repo: r.full,
        id: str(p, "id"),
        number: num(p, "number"),
        title: str(p, "title"),
        url: str(p, "url"),
        state: str(p, "state"),
        draft: bool(p, "isDraft"),
        merged: bool(p, "merged"),
        mergedAt: optStr(p, "mergedAt"),
        closedAt: optStr(p, "closedAt"),
        createdAt: str(p, "createdAt"),
        updatedAt: str(p, "updatedAt"),
        author: optStr(p, "author", "login"),
        head: str(p, "headRefName"),
        headSha: str(p, "headRefOid"),
        headRepo: optStr(p, "headRepository", "nameWithOwner"),
        base: str(p, "baseRefName"),
        mergeable: str(p, "mergeable"),
        mergeState: str(p, "mergeStateStatus"),
        reviewDecision: optStr(p, "reviewDecision"),
        checks: optStr(
          nodes(p, "commits")[0],
          "commit",
          "statusCheckRollup",
          "state",
        ),
        additions: num(p, "additions"),
        deletions: num(p, "deletions"),
        changedFiles: num(p, "changedFiles"),
        labels: names(p, "name", "labels"),
        assignees: names(p, "login", "assignees"),
        reviewRequests: nodes(p, "reviewRequests").flatMap((n) => {
          const who =
            optStr(n, "requestedReviewer", "login") ??
            optStr(n, "requestedReviewer", "slug");
          return who === null ? [] : [who];
        }),
        reviews: nodes(p, "latestReviews").map((n) => ({
          author: optStr(n, "author", "login"),
          state: str(n, "state"),
          at: optStr(n, "submittedAt"),
        })),
        closes: nodes(p, "closingIssuesReferences").map((n) =>
          num(n, "number"),
        ),
        ...(body === false ? {} : { body: optStr(p, "body") ?? "" }),
        commentCount: optNum(p, "comments", "totalCount") ?? 0,
        comments: nodes(p, "comments").map((n) => ({
          author: optStr(n, "author", "login"),
          at: str(n, "createdAt"),
          url: str(n, "url"),
          body: str(n, "body"),
        })),
      };
    },
  });
