// Where an Actions-family secret or variable lives (repository, environment, organization, the user's Codespaces) and who may read an org-level one.
import { s, SurfaceError } from "../vendor/surface/index.ts";
import { enc, repoField } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { num } from "./read.ts";

export const scopeFields = {
  repo: repoField,
  env: s.optional(
    s.string({ description: "Deployment environment of the repo." }),
  ),
  org: s.optional(s.string({ description: "Organization login." })),
};

export const accessFields = {
  visibility: s.optional(
    s.enum(["all", "private", "selected"], {
      description:
        "Organization visibility (default private, or selected when repos is given).",
    }),
  ),
  repos: s.optional(
    s.array(s.string(), {
      description:
        "Repositories allowed to read it (name inside the org, or owner/name). Org scope with visibility selected, or user scope.",
    }),
  ),
};

export type Where = {
  readonly repo?: string | undefined;
  readonly env?: string | undefined;
  readonly org?: string | undefined;
  readonly user?: boolean | undefined;
};

export type Scope =
  | {
      readonly kind: "repo";
      readonly base: string;
      readonly fields: { readonly repo: string };
    }
  | {
      readonly kind: "env";
      readonly base: string;
      readonly fields: { readonly repo: string; readonly env: string };
    }
  | {
      readonly kind: "org";
      readonly base: string;
      readonly fields: { readonly org: string };
    }
  | {
      readonly kind: "user";
      readonly base: string;
      readonly fields: { readonly user: true };
    };

const usage = (message: string, hint: string) =>
  new SurfaceError("usage", message, hint);

export const resolveScope = async (
  gh: GitHub,
  where: Where,
  app: string,
  noun: string,
): Promise<Scope> => {
  const { env, org, user } = where;
  const chosen = [env, org, user === true ? true : undefined].filter(
    (x) => x !== undefined,
  );
  if (chosen.length > 1)
    throw usage("pass only one of env, org and user", "pick one scope");
  if (org !== undefined)
    return {
      kind: "org",
      base: `orgs/${enc(org)}/${app}/${noun}`,
      fields: { org },
    };
  if (user === true) {
    if (app !== "codespaces")
      throw usage(
        "user secrets exist only for codespaces",
        "omit app or pass app: codespaces",
      );
    return {
      kind: "user",
      base: `user/codespaces/${noun}`,
      fields: { user: true },
    };
  }
  const r = await gh.repo(where.repo);
  if (env === undefined)
    return {
      kind: "repo",
      base: `repos/${r.full}/${app}/${noun}`,
      fields: { repo: r.full },
    };
  if (app !== "actions")
    throw usage(
      "environment secrets and variables exist only for actions",
      "omit app or pass app: actions",
    );
  return {
    kind: "env",
    base: `repos/${r.full}/environments/${enc(env)}/${noun}`,
    fields: { repo: r.full, env },
  };
};

const repoIds = (
  gh: GitHub,
  owner: string | undefined,
  repos: readonly string[],
): Promise<number[]> =>
  Promise.all(
    repos.map(async (name) => {
      if (owner === undefined && !name.includes("/"))
        throw usage(
          `repo ${name} needs its owner`,
          "write repos as owner/name",
        );
      const r = await gh.repo(name.includes("/") ? name : `${owner}/${name}`);
      return num(await gh.rest("GET", `repos/${r.full}`), "id");
    }),
  );

export const accessBody = async (
  gh: GitHub,
  scope: Scope,
  visibility: "all" | "private" | "selected" | undefined,
  repos: readonly string[] | undefined,
): Promise<Readonly<Record<string, unknown>>> => {
  if (scope.kind === "repo" || scope.kind === "env") {
    if (visibility !== undefined || repos !== undefined)
      throw usage(
        "visibility and repos apply to org or user scope only",
        "pass org, or drop them",
      );
    return {};
  }
  if (scope.kind === "user") {
    if (visibility !== undefined)
      throw usage(
        "user secrets have no visibility",
        "pass repos to choose who reads it",
      );
    return repos === undefined
      ? {}
      : { selected_repository_ids: await repoIds(gh, undefined, repos) };
  }
  const chosen = visibility ?? (repos === undefined ? "private" : "selected");
  if (chosen !== "selected") {
    if (repos !== undefined)
      throw usage(
        "repos needs visibility selected",
        "drop repos or pass visibility: selected",
      );
    return { visibility: chosen };
  }
  return {
    visibility: chosen,
    selected_repository_ids: await repoIds(gh, scope.fields.org, repos ?? []),
  };
};
