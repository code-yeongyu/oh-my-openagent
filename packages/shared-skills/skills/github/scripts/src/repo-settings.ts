// A repository's settings as returned by create and edit, and the `repo edit` operation that changes them.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { repoField, writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { arr, at, bool, optNum, optStr, str } from "./read.ts";

const flag = (x: unknown, key: string): boolean | null => {
  const v = at(x, key);
  return typeof v === "boolean" ? v : null;
};

export const strings = (x: unknown, what: string): string[] =>
  arr(x, what).filter((t): t is string => typeof t === "string");

export const defined = (
  fields: Readonly<Record<string, unknown>>,
): Record<string, unknown> =>
  Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));

export const repoSettings = (x: unknown) => ({
  repo: str(x, "full_name"),
  description: optStr(x, "description"),
  homepage: optStr(x, "homepage"),
  defaultBranch: str(x, "default_branch"),
  visibility: optStr(x, "visibility"),
  private: bool(x, "private"),
  archived: bool(x, "archived"),
  fork: bool(x, "fork"),
  template: flag(x, "is_template"),
  stars: optNum(x, "stargazers_count"),
  openIssues: optNum(x, "open_issues_count"),
  topics: strings(at(x, "topics") ?? [], "topics"),
  pushedAt: optStr(x, "pushed_at"),
  url: str(x, "html_url"),
  hasIssues: flag(x, "has_issues"),
  hasWiki: flag(x, "has_wiki"),
  hasProjects: flag(x, "has_projects"),
  hasDiscussions: flag(x, "has_discussions"),
  allowForking: flag(x, "allow_forking"),
  allowSquashMerge: flag(x, "allow_squash_merge"),
  allowMergeCommit: flag(x, "allow_merge_commit"),
  allowRebaseMerge: flag(x, "allow_rebase_merge"),
  allowAutoMerge: flag(x, "allow_auto_merge"),
  allowUpdateBranch: flag(x, "allow_update_branch"),
  deleteBranchOnMerge: flag(x, "delete_branch_on_merge"),
});

// gh's --squash-merge-commit-message choices, as the title/message pair the API takes.
const SQUASH = {
  default: ["COMMIT_OR_PR_TITLE", "COMMIT_MESSAGES"],
  "pr-title": ["PR_TITLE", "BLANK"],
  "pr-title-commits": ["PR_TITLE", "COMMIT_MESSAGES"],
  "pr-title-description": ["PR_TITLE", "PR_BODY"],
} as const;

const toggle = (description: string) => s.optional(s.boolean({ description }));

const status = (v: boolean | undefined) =>
  v === undefined ? undefined : { status: v ? "enabled" : "disabled" };

export const editOp = (gh: GitHub) =>
  op({
    description:
      "Change repository settings and topics; booleans set the feature on (true) or off (false), omitted fields stay as they are. Returns the repository's settings afterwards. Replaces `gh repo edit`.",
    input: s.object({
      repo: repoField,
      description: s.optional(s.string()),
      homepage: s.optional(s.string()),
      visibility: s.optional(s.enum(["public", "private", "internal"])),
      acceptVisibilityChangeConsequences: toggle(
        "Must be true when visibility is given: a change can drop stars, watchers and forks.",
      ),
      defaultBranch: s.optional(s.string()),
      addTopics: s.optional(s.array(s.string())),
      removeTopics: s.optional(s.array(s.string())),
      enableIssues: toggle("Issues on or off."),
      enableWiki: toggle("Wiki on or off."),
      enableProjects: toggle("Projects on or off."),
      enableDiscussions: toggle("Discussions on or off."),
      allowSquashMerge: toggle("Squash merging of pull requests."),
      allowMergeCommit: toggle("Merge-commit merging of pull requests."),
      allowRebaseMerge: toggle("Rebase merging of pull requests."),
      deleteBranchOnMerge: toggle("Delete head branches after merge."),
      allowUpdateBranch: toggle(
        "Offer updating a pull request branch that is behind its base.",
      ),
      enableAutoMerge: toggle("Allow auto-merge on pull requests."),
      template: toggle("Make it a template repository."),
      allowForking: toggle("Allow forking (organization repositories)."),
      enableAdvancedSecurity: toggle("GitHub Advanced Security."),
      enableSecretScanning: toggle("Secret scanning."),
      enableSecretScanningPushProtection: toggle(
        "Secret scanning push protection (secret scanning must be on).",
      ),
      squashMergeCommitMessage: s.optional(
        s.enum([
          "default",
          "pr-title",
          "pr-title-commits",
          "pr-title-description",
        ]),
      ),
    }),
    annotations: writes,
    run: async (i) => {
      if (
        i.visibility !== undefined &&
        i.acceptVisibilityChangeConsequences !== true
      )
        throw new SurfaceError(
          "usage",
          "changing visibility needs acceptVisibilityChangeConsequences: true",
          "a visibility change can lose stars, watchers and forks; confirm it explicitly",
        );
      const r = await gh.repo(i.repo);
      const squash =
        i.squashMergeCommitMessage === undefined
          ? undefined
          : SQUASH[i.squashMergeCommitMessage];
      const security = defined({
        advanced_security: status(i.enableAdvancedSecurity),
        secret_scanning: status(i.enableSecretScanning),
        secret_scanning_push_protection: status(
          i.enableSecretScanningPushProtection,
        ),
      });
      const patch = defined({
        description: i.description,
        homepage: i.homepage,
        visibility: i.visibility,
        default_branch: i.defaultBranch,
        has_issues: i.enableIssues,
        has_wiki: i.enableWiki,
        has_projects: i.enableProjects,
        has_discussions: i.enableDiscussions,
        allow_squash_merge: i.allowSquashMerge,
        allow_merge_commit: i.allowMergeCommit,
        allow_rebase_merge: i.allowRebaseMerge,
        delete_branch_on_merge: i.deleteBranchOnMerge,
        allow_update_branch: i.allowUpdateBranch,
        allow_auto_merge: i.enableAutoMerge,
        is_template: i.template,
        allow_forking: i.allowForking,
        squash_merge_commit_title: squash?.[0],
        squash_merge_commit_message: squash?.[1],
        security_and_analysis:
          Object.keys(security).length > 0 ? security : undefined,
      });
      const topicsChange =
        (i.addTopics?.length ?? 0) + (i.removeTopics?.length ?? 0) > 0;
      if (Object.keys(patch).length === 0 && !topicsChange)
        throw new SurfaceError(
          "usage",
          "nothing to change",
          "pass at least one setting or topic",
        );
      const after =
        Object.keys(patch).length > 0
          ? await gh.rest("PATCH", `repos/${r.full}`, { body: patch })
          : await gh.rest("GET", `repos/${r.full}`);
      const settings = repoSettings(after);
      if (!topicsChange) return settings;
      const current = strings(
        at(await gh.rest("GET", `repos/${r.full}/topics`), "names"),
        "names",
      );
      const drop = new Set(i.removeTopics ?? []);
      const names = [...new Set([...current, ...(i.addTopics ?? [])])].filter(
        (t) => !drop.has(t),
      );
      const put = await gh.rest("PUT", `repos/${settings.repo}/topics`, {
        body: { names },
      });
      return { ...settings, topics: strings(at(put, "names"), "names") };
    },
  });
