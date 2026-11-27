// Repository and organization rulesets: list, view and the rules that apply to a branch; writes in rulesets-write.ts.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { enc, limitField, reads, repoField } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { at, num, optStr, str } from "./read.ts";
import { detail, idField, repoOrg, scopeOf, summary } from "./ruleset-shape.ts";
import { rulesetWriteOps } from "./rulesets-write.ts";

export const rulesetOps = (gh: GitHub) => ({
  list: op({
    description:
      "Rulesets of a repository (with those inherited from its org unless `parents: false`) or of an org. Replaces `gh ruleset list`.",
    input: s.object({
      ...repoOrg,
      parents: s.optional(s.boolean()),
      limit: limitField(30),
    }),
    annotations: reads,
    run: async ({ repo, org, parents, limit }) => {
      const sc = await scopeOf(gh, repo, org);
      const raw = await gh.list(`${sc.path}/rulesets`, limit ?? 30, {
        query: org === undefined ? { includes_parents: parents ?? true } : {},
      });
      return { ...sc.out, items: raw.map(summary) };
    },
  }),
  view: op({
    description:
      "One ruleset: name, target, enforcement, conditions, bypass actors and rules with their parameters. Replaces `gh ruleset view`.",
    input: s.object({ ...repoOrg, id: idField }),
    annotations: reads,
    run: async ({ repo, org, id }) => {
      const sc = await scopeOf(gh, repo, org);
      return {
        ...sc.out,
        ...detail(await gh.rest("GET", `${sc.path}/rulesets/${id}`)),
      };
    },
  }),
  check: op({
    description:
      "The rules that apply to a branch, each with the ruleset it comes from. Replaces `gh ruleset check`.",
    input: s.object({
      repo: repoField,
      branch: s.optional(s.string()),
      default: s.optional(
        s.boolean({ description: "Check the default branch." }),
      ),
    }),
    annotations: reads,
    run: async ({ repo, branch, default: useDefault }) => {
      if ((branch === undefined) === (useDefault !== true))
        throw new SurfaceError(
          "usage",
          "pass exactly one of branch or default: true",
          "name the branch to check",
        );
      const r = await gh.repo(repo);
      const name =
        branch ??
        str(await gh.rest("GET", `repos/${r.full}`), "default_branch");
      const raw = await gh.list(
        `repos/${r.full}/rules/branches/${enc(name)}`,
        1000,
      );
      return {
        repo: r.full,
        branch: name,
        items: raw.map((x) => ({
          type: str(x, "type"),
          parameters: at(x, "parameters") ?? null,
          rulesetId: num(x, "ruleset_id"),
          rulesetSource: optStr(x, "ruleset_source"),
          rulesetSourceType: optStr(x, "ruleset_source_type"),
        })),
      };
    },
  }),
  ...rulesetWriteOps(gh),
});
