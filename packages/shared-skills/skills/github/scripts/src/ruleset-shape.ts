// How a ruleset is scoped (repository or org), its input fields, and how GitHub's ruleset JSON is trimmed.
import { s } from "../vendor/surface/index.ts";
import { enc } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { arr, at, isObj, num, optNum, optStr, str } from "./read.ts";

export const repoOrg = {
  repo: s.optional(
    s.string({
      description:
        "owner/name (a github.com URL works too). Defaults to the git origin of the current directory; ignored with org.",
    }),
  ),
  org: s.optional(
    s.string({ description: "Organization, for an org-level ruleset." }),
  ),
};
export const idField = s.integer({ description: "Ruleset id." });
const rule = s.object({
  type: s.string(),
  parameters: s.optional(s.record(s.unknown())),
});
const bypassActor = s.object({
  actorId: s.optional(
    s.integer({ description: "Omit for OrganizationAdmin / DeployKey." }),
  ),
  actorType: s.enum([
    "Integration",
    "OrganizationAdmin",
    "RepositoryRole",
    "Team",
    "DeployKey",
  ]),
  bypassMode: s.optional(s.enum(["always", "pull_request", "exempt"])),
});
export const fields = {
  target: s.enum(["branch", "tag", "push"]),
  enforcement: s.enum(["active", "disabled", "evaluate"]),
  include: s.optional(
    s.array(s.string(), {
      description:
        'Ref name patterns, e.g. "~DEFAULT_BRANCH", "refs/heads/main", "~ALL".',
    }),
  ),
  exclude: s.optional(s.array(s.string())),
  conditions: s.optional(
    s.record(s.unknown(), {
      description:
        "Other GitHub condition objects set beside ref_name, e.g. repository_name for an org ruleset.",
    }),
  ),
  bypassActors: s.optional(s.array(bypassActor)),
  rules: s.optional(
    s.array(rule, {
      description:
        "GitHub rule objects ({ type, parameters }), sent unchanged.",
    }),
  ),
};

type Scope = {
  readonly path: string;
  readonly out: { readonly repo: string } | { readonly org: string };
};

export const scopeOf = async (
  gh: GitHub,
  repo: string | undefined,
  org: string | undefined,
): Promise<Scope> => {
  if (org !== undefined) return { path: `orgs/${enc(org)}`, out: { org } };
  const r = await gh.repo(repo);
  return { path: `repos/${r.full}`, out: { repo: r.full } };
};

export const summary = (x: unknown) => ({
  id: num(x, "id"),
  name: str(x, "name"),
  target: optStr(x, "target"),
  enforcement: str(x, "enforcement"),
  source: optStr(x, "source"),
  sourceType: optStr(x, "source_type"),
  updatedAt: optStr(x, "updated_at"),
  url: optStr(x, "_links", "html", "href"),
});

export const detail = (x: unknown) => ({
  ...summary(x),
  conditions: isObj(at(x, "conditions")) ? at(x, "conditions") : null,
  bypassActors: arr(at(x, "bypass_actors") ?? [], "bypass_actors").map((a) => ({
    actorId: optNum(a, "actor_id"),
    actorType: str(a, "actor_type"),
    bypassMode: optStr(a, "bypass_mode"),
  })),
  rules: arr(at(x, "rules") ?? [], "rules"),
});
