import { op, s } from "../vendor/surface/index.ts";
import { irreversible, numberField, repoField, writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { commentOp, editLabels } from "./issues-write.ts";
import { deleteHead, mergeOp } from "./merge.ts";
import { pullNodeId } from "./pulls-read.ts";
import { at, bool, num, optStr, str } from "./read.ts";

const created = (p: unknown) => ({
  number: num(p, "number"),
  url: str(p, "html_url"),
  state: str(p, "state"),
  draft: bool(p, "draft"),
});

export const pullWriteOps = (gh: GitHub) => ({
  create: op({
    description:
      "Open a pull request. `base` defaults to the repo's default branch. Replaces `gh pr create`.",
    input: s.object({
      repo: repoField,
      title: s.string(),
      head: s.string({
        description: "Branch with the changes (owner:branch for a fork).",
      }),
      base: s.optional(s.string()),
      body: s.optional(s.string()),
      draft: s.optional(s.boolean()),
      labels: s.optional(s.array(s.string())),
      reviewers: s.optional(s.array(s.string())),
    }),
    annotations: writes,
    run: async ({
      repo,
      title,
      head,
      base,
      body,
      draft,
      labels,
      reviewers,
    }) => {
      const r = await gh.repo(repo);
      const target =
        base ?? str(await gh.rest("GET", `repos/${r.full}`), "default_branch");
      const p = await gh.rest("POST", `repos/${r.full}/pulls`, {
        body: {
          title,
          head,
          base: target,
          body: body ?? "",
          draft: draft ?? false,
        },
      });
      const number = num(p, "number");
      if (labels?.length) await editLabels(gh, r.full, number, labels, []);
      if (reviewers?.length)
        await gh.rest(
          "POST",
          `repos/${r.full}/pulls/${number}/requested_reviewers`,
          { body: { reviewers } },
        );
      return { repo: r.full, ...created(p), base: target };
    },
  }),
  edit: op({
    description:
      "Change a PR's title, body, base or open/closed state; add or remove labels; request reviewers. Replaces `gh pr edit` / `gh pr reopen`.",
    input: s.object({
      repo: repoField,
      number: numberField,
      title: s.optional(s.string()),
      body: s.optional(s.string()),
      base: s.optional(s.string()),
      state: s.optional(s.enum(["open", "closed"])),
      addLabels: s.optional(s.array(s.string())),
      removeLabels: s.optional(s.array(s.string())),
      addReviewers: s.optional(s.array(s.string())),
    }),
    annotations: writes,
    run: async ({
      repo,
      number,
      title,
      body,
      base,
      state,
      addLabels,
      removeLabels,
      addReviewers,
    }) => {
      const r = await gh.repo(repo);
      const patch = Object.fromEntries(
        Object.entries({ title, body, base, state }).filter(
          ([, v]) => v !== undefined,
        ),
      );
      const p =
        Object.keys(patch).length > 0
          ? await gh.rest("PATCH", `repos/${r.full}/pulls/${number}`, {
              body: patch,
            })
          : await gh.rest("GET", `repos/${r.full}/pulls/${number}`);
      const labels = await editLabels(
        gh,
        r.full,
        number,
        addLabels ?? [],
        removeLabels ?? [],
      );
      if (addReviewers?.length)
        await gh.rest(
          "POST",
          `repos/${r.full}/pulls/${number}/requested_reviewers`,
          { body: { reviewers: addReviewers } },
        );
      return {
        repo: r.full,
        ...created(p),
        ...(labels === undefined ? {} : { labels }),
      };
    },
  }),
  comment: commentOp(
    gh,
    "Add a conversation comment to a PR, or edit one of yours by id. Replaces `gh pr comment`.",
  ),
  merge: mergeOp(gh),
  ready: op({
    description:
      "Mark a draft PR ready for review, or with undo turn it back into a draft. Replaces `gh pr ready [--undo]`.",
    input: s.object({
      repo: repoField,
      number: numberField,
      undo: s.optional(s.boolean()),
    }),
    annotations: { ...writes, idempotent: true },
    run: async ({ repo, number, undo }) => {
      const r = await gh.repo(repo);
      const pr = await pullNodeId(gh, r.full, number);
      const mutation =
        undo === true
          ? "convertPullRequestToDraft"
          : "markPullRequestReadyForReview";
      const data = await gh.graphql(
        `mutation($id:ID!){${mutation}(input:{pullRequestId:$id}){pullRequest{isDraft}}}`,
        { id: pr.id },
      );
      return {
        repo: r.full,
        number,
        draft: at(data, mutation, "pullRequest", "isDraft") === true,
      };
    },
  }),
  close: op({
    description:
      "Close a PR without merging, optionally leaving a comment first and deleting its same-repo head branch. Replaces `gh pr close`.",
    input: s.object({
      repo: repoField,
      number: numberField,
      comment: s.optional(s.string()),
      deleteBranch: s.optional(s.boolean()),
    }),
    annotations: irreversible,
    run: async ({ repo, number, comment, deleteBranch }) => {
      const r = await gh.repo(repo);
      if (comment !== undefined)
        await gh.rest("POST", `repos/${r.full}/issues/${number}/comments`, {
          body: { body: comment },
        });
      const p = await gh.rest("PATCH", `repos/${r.full}/pulls/${number}`, {
        body: { state: "closed" },
      });
      const branchDeleted =
        deleteBranch === true
          ? await deleteHead(
              gh,
              r,
              str(p, "head", "ref"),
              optStr(p, "head", "repo", "full_name"),
            )
          : false;
      return { repo: r.full, ...created(p), branchDeleted };
    },
  }),
});
