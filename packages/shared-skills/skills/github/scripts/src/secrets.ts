// Actions, Codespaces and Dependabot secrets: list, set (sealed locally with the scope's public key) and delete.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { enc, irreversible, reads, writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { optStr, str } from "./read.ts";
import { seal } from "./sealed-box.ts";
import {
  accessBody,
  accessFields,
  resolveScope,
  scopeFields,
  type Where,
} from "./scopes.ts";

const appField = s.optional(
  s.enum(["actions", "codespaces", "dependabot"], {
    description: "Secret store (default actions, or codespaces with user).",
  }),
);
const where = {
  ...scopeFields,
  user: s.optional(s.boolean({ description: "Your Codespaces user secrets." })),
  app: appField,
};

const scopeOf = (
  gh: GitHub,
  w: Where & { readonly app?: string | undefined },
) => {
  const app = w.app ?? (w.user === true ? "codespaces" : "actions");
  return resolveScope(gh, w, app, "secrets").then((scope) => ({ app, scope }));
};

const plaintext = async (
  value: string | undefined,
  file: string | undefined,
): Promise<Uint8Array> => {
  if ((value === undefined) === (file === undefined))
    throw new SurfaceError(
      "usage",
      "pass exactly one of value and file",
      "give the secret inline as value, or a path to read it from as file",
    );
  if (value !== undefined) return new TextEncoder().encode(value);
  const source = Bun.file(file ?? "");
  if (!(await source.exists()))
    throw new SurfaceError("usage", `no such file: ${file}`, "check the path");
  return new Uint8Array(await source.arrayBuffer());
};

const sealFor = async (
  gh: GitHub,
  base: string,
  message: Uint8Array,
): Promise<{ readonly encrypted_value: string; readonly key_id: string }> => {
  const publicKey = await gh.rest("GET", `${base}/public-key`);
  const key = Buffer.from(str(publicKey, "key"), "base64");
  if (key.length !== 32)
    throw new SurfaceError(
      "invalid_response",
      "the scope's public key is not a 32-byte X25519 key",
      "inspect it with `api rest` on the public-key endpoint",
    );
  return {
    encrypted_value: Buffer.from(seal(key, message)).toString("base64"),
    key_id: str(publicKey, "key_id"),
  };
};

export const secretOps = (gh: GitHub) => ({
  list: op({
    description:
      "Secret names (never values) with their update time, and visibility at org scope. Replaces `gh secret list`.",
    input: s.object(where),
    annotations: reads,
    run: async (input) => {
      const { app, scope } = await scopeOf(gh, input);
      const raw = await gh.list(scope.base, 1000, { key: "secrets" });
      return {
        ...scope.fields,
        app,
        items: raw.map((x) => ({
          name: str(x, "name"),
          createdAt: optStr(x, "created_at"),
          updatedAt: optStr(x, "updated_at"),
          visibility: optStr(x, "visibility"),
        })),
      };
    },
  }),
  set: op({
    description:
      "Create or update a secret: the value is encrypted locally with the scope's public key and only the ciphertext is sent; the result never contains it. Replaces `gh secret set`.",
    input: s.object({
      name: s.string(),
      ...where,
      value: s.optional(
        s.string({
          description:
            "The secret value. On the CLI pass it through --input, never as a flag.",
          secret: true,
        }),
      ),
      file: s.optional(
        s.string({ description: "Path of a file whose bytes are the value." }),
      ),
      ...accessFields,
    }),
    annotations: writes,
    run: async ({ name, value, file, visibility, repos, ...rest }) => {
      const message = await plaintext(value, file);
      const { app, scope } = await scopeOf(gh, rest);
      const access = await accessBody(gh, scope, visibility, repos);
      const sealed = await sealFor(gh, scope.base, message);
      await gh.rest("PUT", `${scope.base}/${enc(name)}`, {
        body: { ...sealed, ...access },
      });
      return { ...scope.fields, app, name };
    },
  }),
  delete: op({
    description: "Delete a secret. Replaces `gh secret delete`.",
    input: s.object({ name: s.string(), ...where }),
    annotations: irreversible,
    run: async ({ name, ...rest }) => {
      const { app, scope } = await scopeOf(gh, rest);
      await gh.rest("DELETE", `${scope.base}/${enc(name)}`);
      return { ...scope.fields, app, name, deleted: true };
    },
  }),
});
