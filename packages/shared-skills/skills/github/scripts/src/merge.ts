import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { enc, irreversible, numberField, repoField } from "./fields.ts";
import type { GitHub, Repo } from "./http.ts";
import { pullNodeId } from "./pulls-read.ts";
import { at, optStr, str } from "./read.ts";

const METHOD = { merge: "MERGE", squash: "SQUASH", rebase: "REBASE" } as const;

export const deleteHead = async (
  gh: GitHub,
  r: Repo,
  head: string,
  headRepo: string | null,
): Promise<boolean> => {
  if (headRepo !== r.full) return false;
  await gh.rest(
    "DELETE",
    `repos/${r.full}/git/refs/heads/${head.split("/").map(enc).join("/")}`,
  );
  return true;
};

export const mergeOp = (gh: GitHub) =>
  op({
    description:
      "Merge a PR now, or enable auto-merge. Pass matchHeadSha so the merge refuses if the head moved since you verified it (kind conflict). Replaces `gh pr merge --match-head-commit`.",
    input: s.object({
      repo: repoField,
      number: numberField,
      method: s.optional(
        s.enum(["merge", "squash", "rebase"], {
          description: "Default merge (a merge commit).",
        }),
      ),
      matchHeadSha: s.optional(
        s.string({
          description: "Expected head commit SHA; strongly recommended.",
        }),
      ),
      subject: s.optional(s.string()),
      body: s.optional(s.string()),
      auto: s.optional(
        s.boolean({ description: "Enable auto-merge instead of merging now." }),
      ),
      deleteBranch: s.optional(
        s.boolean({
          description:
            "Delete the head branch after a merge (same-repo heads only).",
        }),
      ),
    }),
    annotations: irreversible,
    run: async ({
      repo,
      number,
      method,
      matchHeadSha,
      subject,
      body,
      auto,
      deleteBranch,
    }) => {
      const r = await gh.repo(repo);
      const how = method ?? "merge";
      if (auto === true) {
        const pr = await pullNodeId(gh, r.full, number);
        await gh.graphql(
          "mutation($id:ID!,$m:PullRequestMergeMethod!,$oid:GitObjectID){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:$m,expectedHeadOid:$oid}){clientMutationId}}",
          { id: pr.id, m: METHOD[how], oid: matchHeadSha ?? null },
        );
        return {
          repo: r.full,
          number,
          merged: false,
          autoMerge: true,
          sha: null,
          branchDeleted: false,
        };
      }
      const pr =
        deleteBranch === true
          ? await pullNodeId(gh, r.full, number)
          : undefined;
      const res = await gh.rest(
        "PUT",
        `repos/${r.full}/pulls/${number}/merge`,
        {
          body: {
            merge_method: how,
            ...(matchHeadSha === undefined ? {} : { sha: matchHeadSha }),
            ...(subject === undefined ? {} : { commit_title: subject }),
            ...(body === undefined ? {} : { commit_message: body }),
          },
        },
      );
      if (at(res, "merged") !== true)
        throw new SurfaceError(
          "conflict",
          optStr(res, "message") ?? "not merged",
          "read `pr view` mergeState and checks",
        );
      const branchDeleted =
        pr === undefined
          ? false
          : await deleteHead(gh, r, pr.head, pr.headRepo);
      return {
        repo: r.full,
        number,
        merged: true,
        autoMerge: false,
        sha: str(res, "sha"),
        branchDeleted,
      };
    },
  });
