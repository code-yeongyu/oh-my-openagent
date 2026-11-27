// Codespaces over REST: the user's own (user/codespaces), per repository, and org-admin views of members' codespaces.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import {
  enc,
  irreversible,
  limitField,
  reads,
  repoField,
  writes,
} from "./fields.ts";
import type { GitHub } from "./http.ts";
import { bool, optNum, optStr, str } from "./read.ts";

const nameField = s.string({
  description: "Codespace name (not its display name).",
});
const orgField = s.optional(
  s.string({ description: "Organization login; org admins only, with user." }),
);
const userField = s.optional(
  s.string({ description: "Member whose codespace it is; used with org." }),
);

export const codespaceSummary = (c: unknown) => ({
  name: str(c, "name"),
  displayName: optStr(c, "display_name"),
  state: str(c, "state"),
  owner: optStr(c, "owner", "login"),
  repo: str(c, "repository", "full_name"),
  branch: optStr(c, "git_status", "ref"),
  ahead: optNum(c, "git_status", "ahead"),
  behind: optNum(c, "git_status", "behind"),
  unpushedChanges: bool(c, "git_status", "has_unpushed_changes"),
  uncommittedChanges: bool(c, "git_status", "has_uncommitted_changes"),
  machine: optStr(c, "machine", "name"),
  location: str(c, "location"),
  devcontainerPath: optStr(c, "devcontainer_path"),
  idleTimeoutMinutes: optNum(c, "idle_timeout_minutes"),
  retentionExpiresAt: optStr(c, "retention_expires_at"),
  createdAt: str(c, "created_at"),
  lastUsedAt: str(c, "last_used_at"),
  webUrl: str(c, "web_url"),
});

// Without the `codespace` scope GitHub answers 403 or 404, which reads like a missing codespace.
const scoped = <T>(call: Promise<T>): Promise<T> =>
  call.catch((error: unknown) => {
    if (
      error instanceof SurfaceError &&
      (error.kind === "forbidden" || error.kind === "not_found")
    )
      throw new SurfaceError(
        error.kind,
        error.message,
        "the token needs the `codespace` scope (`gh auth refresh -s codespace`); otherwise check the codespace name",
      );
    throw error;
  });

const memberPath = (
  name: string,
  org: string | undefined,
  user: string | undefined,
): string => {
  if (org === undefined && user === undefined)
    return `user/codespaces/${enc(name)}`;
  if (org === undefined || user === undefined)
    throw new SurfaceError(
      "usage",
      "org and user go together",
      "pass both to act on a member's codespace as an org admin, or neither for your own",
    );
  return `orgs/${enc(org)}/members/${enc(user)}/codespaces/${enc(name)}`;
};

export const codespaceOps = (gh: GitHub) => ({
  list: op({
    description:
      "Your codespaces, optionally only one repository's; org admins can list an organization's or one member's. Replaces `gh codespace list`.",
    input: s.object({
      repo: s.optional(
        s.string({ description: "Only codespaces of owner/name." }),
      ),
      org: orgField,
      user: userField,
      limit: limitField(30),
    }),
    annotations: reads,
    run: async ({ repo, org, user, limit }) => {
      if (user !== undefined && org === undefined)
        throw new SurfaceError(
          "usage",
          "user needs org",
          "pass the organization login too",
        );
      const r = repo === undefined ? undefined : await gh.repo(repo);
      const path =
        org !== undefined
          ? user === undefined
            ? `orgs/${enc(org)}/codespaces`
            : `orgs/${enc(org)}/members/${enc(user)}/codespaces`
          : r === undefined
            ? "user/codespaces"
            : `repos/${r.full}/codespaces`;
      const all = (
        await scoped(gh.list(path, limit ?? 30, { key: "codespaces" }))
      ).map(codespaceSummary);
      return {
        ...(r === undefined ? {} : { repo: r.full }),
        ...(org === undefined ? {} : { org }),
        ...(user === undefined ? {} : { user }),
        items:
          org !== undefined && r !== undefined
            ? all.filter((c) => c.repo === r.full)
            : all,
      };
    },
  }),
  view: op({
    description:
      "One of your codespaces by name: state, branch with ahead/behind and unpushed changes, machine, timeouts. Replaces `gh codespace view`.",
    input: s.object({ name: nameField }),
    annotations: reads,
    run: async ({ name }) =>
      codespaceSummary(
        await scoped(gh.rest("GET", `user/codespaces/${enc(name)}`)),
      ),
  }),
  create: op({
    description:
      "Create a codespace for a repository branch; it may still be provisioning (state Queued or Provisioning) when this returns. Replaces `gh codespace create`.",
    input: s.object({
      repo: repoField,
      branch: s.optional(
        s.string({ description: "Default branch when omitted." }),
      ),
      machine: s.optional(
        s.string({ description: "Machine type name, e.g. standardLinux32gb." }),
      ),
      location: s.optional(
        s.string({
          description: "EastUs, SouthEastAsia, WestEurope or WestUs2.",
        }),
      ),
      devcontainerPath: s.optional(s.string()),
      idleTimeoutMinutes: s.optional(s.integer()),
      retentionPeriodMinutes: s.optional(
        s.integer({
          description: "Minutes after stopping before auto-delete (max 43200).",
        }),
      ),
      displayName: s.optional(
        s.string({ description: "48 characters or less." }),
      ),
      defaultPermissions: s.optional(
        s.boolean({
          description:
            "Skip extra repository permissions the devcontainer requests.",
        }),
      ),
    }),
    annotations: writes,
    run: async (input) => {
      const r = await gh.repo(input.repo);
      const body = Object.fromEntries(
        Object.entries({
          ref: input.branch,
          machine: input.machine,
          location: input.location,
          devcontainer_path: input.devcontainerPath,
          idle_timeout_minutes: input.idleTimeoutMinutes,
          retention_period_minutes: input.retentionPeriodMinutes,
          display_name: input.displayName,
          multi_repo_permissions_opt_out: input.defaultPermissions,
        }).filter(([, v]) => v !== undefined),
      );
      return codespaceSummary(
        await scoped(gh.rest("POST", `repos/${r.full}/codespaces`, { body })),
      );
    },
  }),
  delete: op({
    description:
      "Delete a codespace (yours, or a member's as org admin). Irreversible: uncommitted and unpushed changes in it are lost, so check unpushedChanges with view first. Replaces `gh codespace delete`.",
    input: s.object({ name: nameField, org: orgField, user: userField }),
    annotations: irreversible,
    run: async ({ name, org, user }) => {
      await scoped(gh.rest("DELETE", memberPath(name, org, user)));
      return { name, deleted: true };
    },
  }),
  edit: op({
    description:
      "Rename a codespace or change its machine type (a machine change applies at the next start). Replaces `gh codespace edit`.",
    input: s.object({
      name: nameField,
      displayName: s.optional(s.string()),
      machine: s.optional(s.string()),
    }),
    annotations: writes,
    run: async ({ name, displayName, machine }) => {
      if (displayName === undefined && machine === undefined)
        throw new SurfaceError(
          "usage",
          "nothing to change",
          "pass displayName or machine",
        );
      const body = Object.fromEntries(
        Object.entries({ display_name: displayName, machine }).filter(
          ([, v]) => v !== undefined,
        ),
      );
      return codespaceSummary(
        await scoped(
          gh.rest("PATCH", `user/codespaces/${enc(name)}`, { body }),
        ),
      );
    },
  }),
  stop: op({
    description:
      "Stop a running codespace (yours, or a member's as org admin); its files are kept. Replaces `gh codespace stop`.",
    input: s.object({ name: nameField, org: orgField, user: userField }),
    annotations: writes,
    run: async ({ name, org, user }) =>
      codespaceSummary(
        await scoped(gh.rest("POST", `${memberPath(name, org, user)}/stop`)),
      ),
  }),
});
