// Classic branch protection (repos/{o}/{n}/branches/{branch}/protection): view, set and delete.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { enc, irreversible, reads, repoField, writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { arr, at, bool, isObj, optNum, str } from "./read.ts";

const branchField = s.string({ description: "Branch name." });
const check = s.object({
  context: s.string(),
  appId: s.optional(
    s.integer({
      description:
        "Only this GitHub App may report the check (15368 = Actions).",
    }),
  ),
});

const enabled = (x: unknown, key: string): boolean => bool(x, key, "enabled");
const names = (x: unknown, key: string, field: string): string[] =>
  arr(at(x, key) ?? [], key).map((n) => str(n, field));

const trim = (x: unknown) => {
  const checks = at(x, "required_status_checks");
  const reviews = at(x, "required_pull_request_reviews");
  const restrictions = at(x, "restrictions");
  return {
    protected: true,
    requiredChecks: isObj(checks)
      ? {
          strict: bool(checks, "strict"),
          checks: arr(at(checks, "checks") ?? [], "checks").map((c) => ({
            context: str(c, "context"),
            appId: optNum(c, "app_id"),
          })),
        }
      : null,
    requiredApprovingReviewCount: isObj(reviews)
      ? (optNum(reviews, "required_approving_review_count") ?? 0)
      : null,
    dismissStaleReviews: isObj(reviews)
      ? bool(reviews, "dismiss_stale_reviews")
      : null,
    requireCodeOwnerReviews: isObj(reviews)
      ? bool(reviews, "require_code_owner_reviews")
      : null,
    enforceAdmins: enabled(x, "enforce_admins"),
    requiredLinearHistory: enabled(x, "required_linear_history"),
    allowForcePushes: enabled(x, "allow_force_pushes"),
    allowDeletions: enabled(x, "allow_deletions"),
    requiredConversationResolution: enabled(
      x,
      "required_conversation_resolution",
    ),
    restrictions: isObj(restrictions)
      ? {
          users: names(restrictions, "users", "login"),
          teams: names(restrictions, "teams", "slug"),
          apps: names(restrictions, "apps", "slug"),
        }
      : null,
  };
};

const notProtected = (error: unknown): boolean =>
  error instanceof SurfaceError &&
  error.kind === "not_found" &&
  /not protected/i.test(error.message);

export const branchProtectionOps = (gh: GitHub) => ({
  view: op({
    description:
      "A branch's classic protection settings, or `{ protected: false }` when it has none (rulesets are separate: see `ruleset check`). Needs admin access.",
    input: s.object({ repo: repoField, branch: branchField }),
    annotations: reads,
    run: async ({ repo, branch }) => {
      const r = await gh.repo(repo);
      try {
        const x = await gh.rest(
          "GET",
          `repos/${r.full}/branches/${enc(branch)}/protection`,
        );
        return { repo: r.full, branch, ...trim(x) };
      } catch (error) {
        if (notProtected(error))
          return { repo: r.full, branch, protected: false };
        throw error;
      }
    },
  }),
  set: op({
    description:
      "Replace a branch's classic protection with the given settings; anything not passed is turned off. Needs admin access.",
    input: s.object({
      repo: repoField,
      branch: branchField,
      requiredChecks: s.optional(
        s.object({
          strict: s.optional(
            s.boolean({ description: "Branch must be up to date first." }),
          ),
          checks: s.array(check),
        }),
      ),
      requiredApprovingReviewCount: s.optional(s.integer()),
      dismissStaleReviews: s.optional(s.boolean()),
      requireCodeOwnerReviews: s.optional(s.boolean()),
      enforceAdmins: s.optional(s.boolean()),
      requiredLinearHistory: s.optional(s.boolean()),
      allowForcePushes: s.optional(s.boolean()),
      allowDeletions: s.optional(s.boolean()),
      requiredConversationResolution: s.optional(s.boolean()),
      restrictions: s.optional(
        s.object(
          {
            users: s.array(s.string()),
            teams: s.array(s.string()),
            apps: s.optional(s.array(s.string())),
          },
          { description: "Who may push (org repositories only)." },
        ),
      ),
    }),
    annotations: writes,
    run: async ({ repo, branch, requiredChecks, restrictions, ...f }) => {
      const r = await gh.repo(repo);
      const wantsReviews =
        f.requiredApprovingReviewCount !== undefined ||
        f.dismissStaleReviews !== undefined ||
        f.requireCodeOwnerReviews !== undefined;
      const optional = {
        required_linear_history: f.requiredLinearHistory,
        allow_force_pushes: f.allowForcePushes,
        allow_deletions: f.allowDeletions,
        required_conversation_resolution: f.requiredConversationResolution,
      };
      const x = await gh.rest(
        "PUT",
        `repos/${r.full}/branches/${enc(branch)}/protection`,
        {
          body: {
            required_status_checks:
              requiredChecks === undefined
                ? null
                : {
                    strict: requiredChecks.strict ?? false,
                    checks: requiredChecks.checks.map((c) => ({
                      context: c.context,
                      ...(c.appId === undefined ? {} : { app_id: c.appId }),
                    })),
                  },
            enforce_admins: f.enforceAdmins ?? null,
            required_pull_request_reviews: wantsReviews
              ? {
                  required_approving_review_count:
                    f.requiredApprovingReviewCount ?? 1,
                  dismiss_stale_reviews: f.dismissStaleReviews ?? false,
                  require_code_owner_reviews:
                    f.requireCodeOwnerReviews ?? false,
                }
              : null,
            restrictions:
              restrictions === undefined
                ? null
                : {
                    users: restrictions.users,
                    teams: restrictions.teams,
                    apps: restrictions.apps ?? [],
                  },
            ...Object.fromEntries(
              Object.entries(optional).filter(([, v]) => v !== undefined),
            ),
          },
        },
      );
      return { repo: r.full, branch, ...trim(x) };
    },
  }),
  delete: op({
    description:
      "Remove a branch's classic protection entirely (rulesets stay). Needs admin access.",
    input: s.object({ repo: repoField, branch: branchField }),
    annotations: irreversible,
    run: async ({ repo, branch }) => {
      const r = await gh.repo(repo);
      await gh.rest(
        "DELETE",
        `repos/${r.full}/branches/${enc(branch)}/protection`,
      );
      return { repo: r.full, branch, protected: false };
    },
  }),
});
