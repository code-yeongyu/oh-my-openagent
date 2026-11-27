// Shared plumbing for Projects (v2): owner/number addressing, the project node id lookup, paging and the scope hint.
import { s, SurfaceError } from "../vendor/surface/index.ts";
import type { GitHub } from "./http.ts";
import { at, bool, nodes, num, optStr, str, type Json } from "./read.ts";

export const ownerField = s.string({
  description:
    'Project owner: a user or organization login, or "@me" for the authenticated user.',
});
export const projectNumberField = s.integer({
  description: "Project number (the one in the project URL).",
});
export const itemIdField = s.string({
  description: "Project item node id (PVTI_...), as returned by itemList.",
});

const scopeHint =
  "the token needs the `project` scope (`read:project` for reads): run `gh auth refresh -s project` or mint a token with it";

// GitHub's INSUFFICIENT_SCOPES arrives from gh.graphql as a plain `graphql` error with a "fix the query" hint.
export const projectGraphql = async (
  gh: GitHub,
  query: string,
  variables: Json,
): Promise<Json> => {
  try {
    return await gh.graphql(query, variables);
  } catch (error) {
    if (
      error instanceof SurfaceError &&
      error.kind === "graphql" &&
      /required scopes/.test(error.message)
    )
      throw new SurfaceError("forbidden", error.message, scopeHint);
    throw error;
  }
};

export const ownerRoot = (owner: string) =>
  owner === "@me"
    ? { root: "viewer", decl: "", vars: {} }
    : {
        root: "repositoryOwner(login: $login)",
        decl: "$login: String!",
        vars: { login: owner },
      };

export const declare = (...decls: readonly string[]): string => {
  const list = decls.filter(Boolean).join(", ");
  return list === "" ? "" : `(${list})`;
};

export const missing = (what: string): SurfaceError =>
  new SurfaceError(
    "not_found",
    `${what} not found`,
    'check owner (a login or "@me") and the project number',
  );

export const resolveOwner = async (gh: GitHub, owner: string) => {
  const o = ownerRoot(owner);
  const data = await projectGraphql(
    gh,
    `query${declare(o.decl)} { owner: ${o.root} { id login } }`,
    o.vars,
  );
  if (at(data, "owner") == null) throw missing(`owner ${owner}`);
  return { id: str(data, "owner", "id"), login: str(data, "owner", "login") };
};

export const projectQuery = async (
  gh: GitHub,
  owner: string,
  number: number,
  selection = "",
  extra: { readonly decl?: string; readonly vars?: Json } = {},
) => {
  const o = ownerRoot(owner);
  const data = await projectGraphql(
    gh,
    `query${declare("$number: Int!", o.decl, extra.decl ?? "")} { owner: ${o.root} { login ... on ProjectV2Owner { projectV2(number: $number) { id title ${selection} } } } }`,
    { number, ...o.vars, ...extra.vars },
  );
  const project = at(data, "owner", "projectV2");
  if (project == null) throw missing(`project ${owner}/${number}`);
  return { login: str(data, "owner", "login"), project };
};

export const resolveProject = async (
  gh: GitHub,
  owner: string,
  number: number,
) => {
  const { project } = await projectQuery(gh, owner, number);
  return { id: str(project, "id"), title: str(project, "title") };
};

export const collect = async (
  limit: number,
  page: (first: number, after: string | null) => Promise<unknown>,
  keep: (node: unknown) => boolean = () => true,
): Promise<unknown[]> => {
  const out: unknown[] = [];
  let after: string | null = null;
  while (out.length < limit) {
    const conn = await page(Math.min(100, limit - out.length), after);
    out.push(...nodes(conn).filter(keep));
    after = optStr(conn, "pageInfo", "endCursor");
    if (!bool(conn, "pageInfo", "hasNextPage") || after === null) break;
  }
  return out.slice(0, limit);
};

export const mutate = async (
  gh: GitHub,
  name: string,
  input: Json,
  selection: string,
): Promise<unknown> => {
  const inputType = `${name.charAt(0).toUpperCase()}${name.slice(1)}Input`;
  const data = await projectGraphql(
    gh,
    `mutation($input: ${inputType}!) { result: ${name}(input: $input) { ${selection} } }`,
    { input },
  );
  return at(data, "result");
};

export const pageInfo = "pageInfo { hasNextPage endCursor }";

export const PROJECT_FIELDS =
  "id number title shortDescription public closed template url createdAt updatedAt";

export const projectSummary = (x: unknown) => ({
  id: str(x, "id"),
  number: num(x, "number"),
  title: str(x, "title"),
  description: optStr(x, "shortDescription"),
  public: bool(x, "public"),
  closed: bool(x, "closed"),
  template: bool(x, "template"),
  url: str(x, "url"),
  createdAt: optStr(x, "createdAt"),
  updatedAt: optStr(x, "updatedAt"),
});
