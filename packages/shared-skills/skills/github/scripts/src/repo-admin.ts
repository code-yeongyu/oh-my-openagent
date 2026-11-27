// Repository lifecycle on GitHub: create, edit, delete, archive, rename, fork, list, sync and URLs.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { irreversible, repoField, writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { bool, str } from "./read.ts";
import { createOp } from "./repo-create.ts";
import { listOp } from "./repo-list.ts";
import { defined, editOp } from "./repo-settings.ts";
import { syncOp } from "./repo-sync.ts";
import { urlOp } from "./repo-url.ts";

const usage = (message: string, hint: string) =>
  new SurfaceError("usage", message, hint);

const archiveOp = (gh: GitHub, archived: boolean, description: string) =>
  op({
    description,
    input: s.object({ repo: repoField }),
    annotations: writes,
    run: async ({ repo }) => {
      const r = await gh.repo(repo);
      const x = await gh.rest("PATCH", `repos/${r.full}`, {
        body: { archived },
      });
      return { repo: str(x, "full_name"), archived: bool(x, "archived") };
    },
  });

export const repoAdminOps = (gh: GitHub) => ({
  create: createOp(gh),
  edit: editOp(gh),
  delete: op({
    description:
      "Delete a repository permanently, with its issues, pull requests and wiki. `confirm` must equal its owner/name. Needs the token's delete_repo scope. Replaces `gh repo delete --yes`.",
    input: s.object({
      repo: repoField,
      confirm: s.string({
        description: "The repository's owner/name, typed out to confirm.",
      }),
    }),
    annotations: irreversible,
    run: async ({ repo, confirm }) => {
      const r = await gh.repo(repo);
      if (confirm !== r.full)
        throw usage(
          `confirm must be ${r.full}`,
          "pass the exact owner/name of the repository to delete",
        );
      await gh.rest("DELETE", `repos/${r.full}`);
      return { repo: r.full, deleted: true };
    },
  }),
  archive: archiveOp(
    gh,
    true,
    "Archive a repository: it becomes read-only until unarchived. Replaces `gh repo archive --yes`.",
  ),
  unarchive: archiveOp(
    gh,
    false,
    "Unarchive a repository so it accepts pushes, issues and pull requests again. Replaces `gh repo unarchive --yes`.",
  ),
  rename: op({
    description:
      "Rename a repository; GitHub redirects the old name. Returns the new owner/name. Replaces `gh repo rename --yes`.",
    input: s.object({ repo: repoField, newName: s.string() }),
    annotations: writes,
    run: async ({ repo, newName }) => {
      const r = await gh.repo(repo);
      const x = await gh.rest("PATCH", `repos/${r.full}`, {
        body: { name: newName },
      });
      return {
        repo: r.full,
        newRepo: str(x, "full_name"),
        url: str(x, "html_url"),
      };
    },
  }),
  fork: op({
    description:
      "Fork a repository to your account or an organization. GitHub creates the fork asynchronously, so its contents can take a moment to appear. API-side only: no clone or git remote. Replaces `gh repo fork`.",
    input: s.object({
      repo: repoField,
      org: s.optional(
        s.string({ description: "Organization to own the fork." }),
      ),
      forkName: s.optional(s.string()),
      defaultBranchOnly: s.optional(s.boolean()),
    }),
    annotations: writes,
    run: async ({ repo, org, forkName, defaultBranchOnly }) => {
      const r = await gh.repo(repo);
      const x = await gh.rest("POST", `repos/${r.full}/forks`, {
        body: defined({
          organization: org,
          name: forkName,
          default_branch_only: defaultBranchOnly,
        }),
      });
      return {
        repo: r.full,
        fork: str(x, "full_name"),
        defaultBranch: str(x, "default_branch"),
        url: str(x, "html_url"),
      };
    },
  }),
  list: listOp(gh),
  sync: syncOp(gh),
  url: urlOp(gh),
});
