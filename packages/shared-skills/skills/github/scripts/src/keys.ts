// The signed-in user's SSH keys (authentication and signing) and GPG keys: list, add and delete.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { irreversible, reads, writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { arr, at, bool, num, optStr, str } from "./read.ts";

const SSH_PATH = {
  authentication: "user/keys",
  signing: "user/ssh_signing_keys",
} as const;
const SSH_SCOPE = {
  authentication: "public_key",
  signing: "ssh_signing_key",
} as const;

// Without the key scope GitHub answers these account endpoints with 404, not 403.
const scoped = async <T>(scope: string, run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof SurfaceError &&
      (error.kind === "not_found" || error.kind === "forbidden")
    )
      throw new SurfaceError(
        "forbidden",
        error.message,
        `the token needs the \`${scope}\` scope (\`gh auth refresh -s ${scope}\`); for a delete, also check the id`,
      );
    throw error;
  }
};
const sshType = s.enum(["authentication", "signing"], {
  description: "Key kind (default authentication).",
});
const keyId = s.integer({ description: "Key id from `list`." });

const keyText = async (
  text: string | undefined,
  file: string | undefined,
  what: string,
): Promise<string> => {
  if ((text === undefined) === (file === undefined))
    throw new SurfaceError(
      "usage",
      `pass exactly one of key and file`,
      `give the ${what} as key, or a path to it as file`,
    );
  if (text !== undefined) return text.trim();
  const source = Bun.file(file ?? "");
  if (!(await source.exists()))
    throw new SurfaceError("usage", `no such file: ${file}`, "check the path");
  return (await source.text()).trim();
};

const sshKey = (x: unknown, type: keyof typeof SSH_PATH) => ({
  id: num(x, "id"),
  type,
  title: optStr(x, "title"),
  key: str(x, "key"),
  createdAt: optStr(x, "created_at"),
});

const gpgKey = (x: unknown) => ({
  id: num(x, "id"),
  keyId: str(x, "key_id"),
  name: optStr(x, "name"),
  emails: arr(at(x, "emails") ?? [], "emails").map((e) => ({
    email: str(e, "email"),
    verified: bool(e, "verified"),
  })),
  canSign: bool(x, "can_sign"),
  createdAt: optStr(x, "created_at"),
  expiresAt: optStr(x, "expires_at"),
});

const keyInput = (what: string) => ({
  key: s.optional(s.string({ description: `The ${what} text.` })),
  file: s.optional(s.string({ description: `Path of the ${what} file.` })),
  title: s.optional(s.string()),
});

export const sshKeyOps = (gh: GitHub) => ({
  list: op({
    description:
      "Your SSH keys of both kinds, each with a `type` of authentication or signing. Replaces `gh ssh-key list`.",
    input: s.object({}),
    annotations: reads,
    run: async () => {
      const kinds = ["authentication", "signing"] as const;
      const lists = await Promise.all(
        kinds.map(async (type) =>
          (
            await scoped(`read:${SSH_SCOPE[type]}`, () =>
              gh.list(SSH_PATH[type], 1000),
            )
          ).map((x) => sshKey(x, type)),
        ),
      );
      return { items: lists.flat() };
    },
  }),
  add: op({
    description:
      "Add a public SSH key to your account for authentication or commit signing. Replaces `gh ssh-key add`.",
    input: s.object({ ...keyInput("public key"), type: s.optional(sshType) }),
    annotations: writes,
    run: async ({ key, file, title, type }) => {
      const kind = type ?? "authentication";
      const text = await keyText(key, file, "public key");
      const k = await scoped(`admin:${SSH_SCOPE[kind]}`, () =>
        gh.rest("POST", SSH_PATH[kind], {
          body: { key: text, ...(title === undefined ? {} : { title }) },
        }),
      );
      return sshKey(k, kind);
    },
  }),
  delete: op({
    description:
      "Delete an SSH key by id; pass type signing for a signing key, since the two kinds have separate ids. Replaces `gh ssh-key delete`.",
    input: s.object({ id: keyId, type: s.optional(sshType) }),
    annotations: irreversible,
    run: async ({ id, type }) => {
      const kind = type ?? "authentication";
      await scoped(`admin:${SSH_SCOPE[kind]}`, () =>
        gh.rest("DELETE", `${SSH_PATH[kind]}/${id}`),
      );
      return { id, type: kind, deleted: true };
    },
  }),
});

export const gpgKeyOps = (gh: GitHub) => ({
  list: op({
    description:
      "Your GPG keys with their key ids, emails and expiry. Replaces `gh gpg-key list`.",
    input: s.object({}),
    annotations: reads,
    run: async () => ({
      items: (
        await scoped("read:gpg_key", () => gh.list("user/gpg_keys", 1000))
      ).map(gpgKey),
    }),
  }),
  add: op({
    description:
      "Add an ASCII-armored public GPG key to your account. Replaces `gh gpg-key add`.",
    input: s.object(keyInput("armored public key")),
    annotations: writes,
    run: async ({ key, file, title }) => {
      const text = await keyText(key, file, "armored public key");
      const k = await scoped("admin:gpg_key", () =>
        gh.rest("POST", "user/gpg_keys", {
          body: {
            armored_public_key: text,
            ...(title === undefined ? {} : { name: title }),
          },
        }),
      );
      return gpgKey(k);
    },
  }),
  delete: op({
    description:
      "Delete a GPG key by its numeric id. Replaces `gh gpg-key delete`.",
    input: s.object({ id: keyId }),
    annotations: irreversible,
    run: async ({ id }) => {
      await scoped("admin:gpg_key", () =>
        gh.rest("DELETE", `user/gpg_keys/${id}`),
      );
      return { id, deleted: true };
    },
  }),
});
