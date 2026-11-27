// Ruleset writes: create, edit and delete (gh has no writer for these).
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { irreversible, writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { arr, at, isObj } from "./read.ts";
import { detail, fields, idField, repoOrg, scopeOf } from "./ruleset-shape.ts";

type Fields = {
  readonly name?: string | undefined;
  readonly target?: string | undefined;
  readonly enforcement?: string | undefined;
  readonly include?: readonly string[] | undefined;
  readonly exclude?: readonly string[] | undefined;
  readonly conditions?: Readonly<Record<string, unknown>> | undefined;
  readonly bypassActors?:
    | readonly {
        readonly actorId?: number | undefined;
        readonly actorType: string;
        readonly bypassMode?: string | undefined;
      }[]
    | undefined;
  readonly rules?: readonly unknown[] | undefined;
};

// PUT replaces conditions whole, so an edit that names only one side keeps the other from `current`.
const body = (f: Fields, current: unknown) => {
  const existing = at(current, "conditions");
  const refName = at(existing, "ref_name");
  const keepList = (key: string): unknown[] => [
    ...arr(at(refName, key) ?? [], key),
  ];
  const touchesRefs = f.include !== undefined || f.exclude !== undefined;
  const conditions =
    touchesRefs || f.conditions !== undefined
      ? {
          ...(isObj(existing) ? existing : {}),
          ...f.conditions,
          ...(touchesRefs
            ? {
                ref_name: {
                  include: f.include ?? keepList("include"),
                  exclude: f.exclude ?? keepList("exclude"),
                },
              }
            : {}),
        }
      : undefined;
  const entries = {
    name: f.name,
    target: f.target,
    enforcement: f.enforcement,
    conditions,
    bypass_actors: f.bypassActors?.map((a) => ({
      actor_id: a.actorId ?? null,
      actor_type: a.actorType,
      bypass_mode: a.bypassMode ?? "always",
    })),
    rules: f.rules,
  };
  return Object.fromEntries(
    Object.entries(entries).filter(([, v]) => v !== undefined),
  );
};

export const rulesetWriteOps = (gh: GitHub) => ({
  create: op({
    description:
      "Create a ruleset on a repository, or on an org with `org`. gh has no equivalent.",
    input: s.object({ ...repoOrg, name: s.string(), ...fields }),
    annotations: writes,
    run: async ({ repo, org, ...f }) => {
      const sc = await scopeOf(gh, repo, org);
      const x = await gh.rest("POST", `${sc.path}/rulesets`, {
        body: body(f, undefined),
      });
      return { ...sc.out, ...detail(x) };
    },
  }),
  edit: op({
    description:
      "Change any field of a ruleset; `include` or `exclude` alone keeps the other side, `rules` and `bypassActors` replace the whole list. gh has no equivalent.",
    input: s.object({
      ...repoOrg,
      id: idField,
      name: s.optional(s.string()),
      target: s.optional(fields.target),
      enforcement: s.optional(fields.enforcement),
      include: fields.include,
      exclude: fields.exclude,
      conditions: fields.conditions,
      bypassActors: fields.bypassActors,
      rules: fields.rules,
    }),
    annotations: writes,
    run: async ({ repo, org, id, ...f }) => {
      const sc = await scopeOf(gh, repo, org);
      if (Object.values(f).every((v) => v === undefined))
        throw new SurfaceError(
          "usage",
          "nothing to change",
          "pass at least one ruleset field",
        );
      const path = `${sc.path}/rulesets/${id}`;
      const needsCurrent =
        f.include !== undefined ||
        f.exclude !== undefined ||
        f.conditions !== undefined;
      const current = needsCurrent ? await gh.rest("GET", path) : undefined;
      const x = await gh.rest("PUT", path, { body: body(f, current) });
      return { ...sc.out, ...detail(x) };
    },
  }),
  delete: op({
    description:
      "Delete a ruleset; its rules stop applying at once. gh has no equivalent.",
    input: s.object({ ...repoOrg, id: idField }),
    annotations: irreversible,
    run: async ({ repo, org, id }) => {
      const sc = await scopeOf(gh, repo, org);
      await gh.rest("DELETE", `${sc.path}/rulesets/${id}`);
      return { ...sc.out, id, deleted: true };
    },
  }),
});
