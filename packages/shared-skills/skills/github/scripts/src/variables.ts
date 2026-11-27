// GitHub Actions variables at repository, environment and organization scope: list, get, set (create or update) and delete.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { enc, irreversible, reads, writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { optStr, str } from "./read.ts";
import {
  accessBody,
  accessFields,
  resolveScope,
  scopeFields,
} from "./scopes.ts";

const variable = (x: unknown) => ({
  name: str(x, "name"),
  value: str(x, "value"),
  createdAt: optStr(x, "created_at"),
  updatedAt: optStr(x, "updated_at"),
  visibility: optStr(x, "visibility"),
});

export const variableOps = (gh: GitHub) => {
  const scopeOf = (w: Parameters<typeof resolveScope>[1]) =>
    resolveScope(gh, w, "actions", "variables");
  return {
    list: op({
      description:
        "Variables with their values, and visibility at org scope. Replaces `gh variable list`.",
      input: s.object(scopeFields),
      annotations: reads,
      run: async (input) => {
        const scope = await scopeOf(input);
        const raw = await gh.list(scope.base, 1000, { key: "variables" });
        return { ...scope.fields, items: raw.map(variable) };
      },
    }),
    get: op({
      description: "One variable with its value. Replaces `gh variable get`.",
      input: s.object({ name: s.string(), ...scopeFields }),
      annotations: reads,
      run: async ({ name, ...rest }) => {
        const scope = await scopeOf(rest);
        const v = await gh.rest("GET", `${scope.base}/${enc(name)}`);
        return { ...scope.fields, ...variable(v) };
      },
    }),
    set: op({
      description:
        "Create a variable, or update it when it already exists; `created` says which. Replaces `gh variable set`.",
      input: s.object({
        name: s.string(),
        value: s.string(),
        ...scopeFields,
        ...accessFields,
      }),
      annotations: writes,
      run: async ({ name, value, visibility, repos, ...rest }) => {
        const scope = await scopeOf(rest);
        const body = {
          name,
          value,
          ...(await accessBody(gh, scope, visibility, repos)),
        };
        let created = false;
        try {
          await gh.rest("PATCH", `${scope.base}/${enc(name)}`, { body });
        } catch (error) {
          if (!(error instanceof SurfaceError && error.kind === "not_found"))
            throw error;
          await gh.rest("POST", scope.base, { body });
          created = true;
        }
        return { ...scope.fields, name, value, created };
      },
    }),
    delete: op({
      description: "Delete a variable. Replaces `gh variable delete`.",
      input: s.object({ name: s.string(), ...scopeFields }),
      annotations: irreversible,
      run: async ({ name, ...rest }) => {
        const scope = await scopeOf(rest);
        await gh.rest("DELETE", `${scope.base}/${enc(name)}`);
        return { ...scope.fields, name, deleted: true };
      },
    }),
  };
};
