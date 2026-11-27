import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { enc, numberField, repoField, writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { issueFromRest, labelNames } from "./issues.ts";
import { num, str } from "./read.ts";

export const editLabels = async (
  gh: GitHub,
  full: string,
  number: number,
  add: readonly string[],
  remove: readonly string[],
): Promise<string[] | undefined> => {
  let current: string[] | undefined;
  if (add.length > 0)
    current = labelNames(
      await gh.rest("POST", `repos/${full}/issues/${number}/labels`, {
        body: { labels: add },
      }),
    );
  for (const name of remove) {
    try {
      current = labelNames(
        await gh.rest(
          "DELETE",
          `repos/${full}/issues/${number}/labels/${enc(name)}`,
        ),
      );
    } catch (error) {
      if (!(error instanceof SurfaceError && error.kind === "not_found"))
        throw error;
    }
  }
  return current;
};

export const commentOp = (gh: GitHub, description: string) =>
  op({
    description,
    input: s.object({
      repo: repoField,
      number: numberField,
      body: s.string(),
      editId: s.optional(
        s.integer({
          description: "Existing comment id to replace instead of adding.",
        }),
      ),
    }),
    annotations: writes,
    run: async ({ repo, number, body, editId }) => {
      const r = await gh.repo(repo);
      const c =
        editId === undefined
          ? await gh.rest("POST", `repos/${r.full}/issues/${number}/comments`, {
              body: { body },
            })
          : await gh.rest(
              "PATCH",
              `repos/${r.full}/issues/comments/${editId}`,
              { body: { body } },
            );
      return { id: num(c, "id"), url: str(c, "html_url") };
    },
  });

export const issueWriteOps = (gh: GitHub) => ({
  create: op({
    description: "Open an issue. Replaces `gh issue create`.",
    input: s.object({
      repo: repoField,
      title: s.string(),
      body: s.optional(s.string()),
      labels: s.optional(s.array(s.string())),
      assignees: s.optional(s.array(s.string())),
    }),
    annotations: writes,
    run: async ({ repo, title, body, labels, assignees }) => {
      const r = await gh.repo(repo);
      const i = await gh.rest("POST", `repos/${r.full}/issues`, {
        body: {
          title,
          body: body ?? "",
          labels: labels ?? [],
          assignees: assignees ?? [],
        },
      });
      return {
        repo: r.full,
        number: num(i, "number"),
        url: str(i, "html_url"),
      };
    },
  }),
  edit: op({
    description:
      "Change an issue's title, body or state; add or remove labels and assignees. Replaces `gh issue edit` / `gh issue reopen`.",
    input: s.object({
      repo: repoField,
      number: numberField,
      title: s.optional(s.string()),
      body: s.optional(s.string()),
      state: s.optional(s.enum(["open", "closed"])),
      addLabels: s.optional(s.array(s.string())),
      removeLabels: s.optional(s.array(s.string())),
      addAssignees: s.optional(s.array(s.string())),
      removeAssignees: s.optional(s.array(s.string())),
    }),
    annotations: writes,
    run: async ({
      repo,
      number,
      title,
      body,
      state,
      addLabels,
      removeLabels,
      addAssignees,
      removeAssignees,
    }) => {
      const r = await gh.repo(repo);
      const patch = Object.fromEntries(
        Object.entries({ title, body, state }).filter(
          ([, v]) => v !== undefined,
        ),
      );
      if (Object.keys(patch).length > 0)
        await gh.rest("PATCH", `repos/${r.full}/issues/${number}`, {
          body: patch,
        });
      await editLabels(gh, r.full, number, addLabels ?? [], removeLabels ?? []);
      if (addAssignees?.length)
        await gh.rest("POST", `repos/${r.full}/issues/${number}/assignees`, {
          body: { assignees: addAssignees },
        });
      if (removeAssignees?.length)
        await gh.rest("DELETE", `repos/${r.full}/issues/${number}/assignees`, {
          body: { assignees: removeAssignees },
        });
      return {
        repo: r.full,
        ...issueFromRest(
          await gh.rest("GET", `repos/${r.full}/issues/${number}`),
        ),
      };
    },
  }),
  comment: commentOp(
    gh,
    "Comment on an issue (or PR conversation), or edit an existing comment by id. Replaces `gh issue comment [--edit-last]`.",
  ),
  close: op({
    description:
      "Close an issue as completed or not_planned, optionally commenting first (e.g. naming the merged PR and SHA). Replaces `gh issue close --comment`.",
    input: s.object({
      repo: repoField,
      number: numberField,
      reason: s.optional(s.enum(["completed", "not_planned"])),
      comment: s.optional(s.string()),
    }),
    annotations: writes,
    run: async ({ repo, number, reason, comment }) => {
      const r = await gh.repo(repo);
      if (comment !== undefined)
        await gh.rest("POST", `repos/${r.full}/issues/${number}/comments`, {
          body: { body: comment },
        });
      const i = await gh.rest("PATCH", `repos/${r.full}/issues/${number}`, {
        body: { state: "closed", state_reason: reason ?? "completed" },
      });
      return { repo: r.full, ...issueFromRest(i) };
    },
  }),
});
