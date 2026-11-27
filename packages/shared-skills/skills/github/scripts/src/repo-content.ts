// Repository content without a checkout (directory listings and files through the contents API), and `repo clone`.
import { isAbsolute, resolve } from "node:path";
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { enc, reads, repoField, writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { arr, at, num, optNum, optStr, str } from "./read.ts";

const segments = (path: string) =>
  path.split("/").filter(Boolean).map(enc).join("/");

const contentsPath = (full: string, path: string | undefined) => {
  const rel = segments(path ?? "");
  return rel === ""
    ? `repos/${full}/contents`
    : `repos/${full}/contents/${rel}`;
};

const refField = s.optional(
  s.string({
    description: "Branch, tag or commit; default the default branch.",
  }),
);

const textOf = (bytes: Uint8Array): string | undefined => {
  if (bytes.includes(0)) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) return undefined;
    throw error;
  }
};

export const repoContentOps = (gh: GitHub) => ({
  readDir: op({
    description:
      "Entries of a directory in a repository (root when path is omitted) with type, size and blob SHA. Replaces `gh repo read-dir`.",
    input: s.object({
      repo: repoField,
      path: s.optional(s.string()),
      ref: refField,
    }),
    annotations: reads,
    run: async ({ repo, path, ref }) => {
      const r = await gh.repo(repo);
      const body = await gh.rest("GET", contentsPath(r.full, path), {
        query: { ref },
      });
      if (!Array.isArray(body))
        throw new SurfaceError(
          "usage",
          `${path ?? ""} is a ${optStr(body, "type") ?? "file"}, not a directory`,
          "read it with `repo readFile`",
        );
      return {
        repo: r.full,
        path: path ?? "",
        ref: ref ?? null,
        items: arr(body, "entries").map((e) => ({
          name: str(e, "name"),
          path: str(e, "path"),
          type: str(e, "type"),
          size: optNum(e, "size"),
          sha: str(e, "sha"),
        })),
      };
    },
  }),
  readFile: op({
    description:
      "A file's text with its size and blob SHA. With output, or for binary content (which then requires output), the bytes are written to that local path instead and the path is returned; an existing file is kept unless clobber. Replaces `gh repo read-file`.",
    input: s.object({
      repo: repoField,
      path: s.string(),
      ref: refField,
      output: s.optional(
        s.string({ description: "Local path to write the bytes to." }),
      ),
      clobber: s.optional(
        s.boolean({ description: "Overwrite output if it exists." }),
      ),
    }),
    annotations: reads,
    run: async ({ repo, path, ref, output, clobber }) => {
      const r = await gh.repo(repo);
      const where = contentsPath(r.full, path);
      const meta = await gh.rest("GET", where, { query: { ref } });
      if (Array.isArray(meta) || str(meta, "type") !== "file")
        throw new SurfaceError(
          "usage",
          `${path} is ${Array.isArray(meta) ? "a directory" : `a ${str(meta, "type")}${optStr(meta, "target") === null ? "" : ` to ${optStr(meta, "target")}`}`}, not a file`,
          "list a directory with `repo readDir`",
        );
      // Files over 1 MB come back with encoding "none" and no content; the raw media type returns them up to 100 MB.
      const bytes =
        optStr(meta, "encoding") === "base64"
          ? new Uint8Array(Buffer.from(str(meta, "content"), "base64"))
          : await gh.bytes(
              ref === undefined ? where : `${where}?ref=${enc(ref)}`,
              "application/vnd.github.raw+json",
            );
      const base = {
        repo: r.full,
        path,
        ref: ref ?? null,
        sha: str(meta, "sha"),
        size: num(meta, "size"),
      };
      const text = output === undefined ? textOf(bytes) : undefined;
      if (text !== undefined) return { ...base, content: text };
      if (output === undefined)
        throw new SurfaceError(
          "usage",
          `${path} is binary`,
          "pass output to write it to a local file",
        );
      const target = resolve(output);
      if (clobber !== true && (await Bun.file(target).exists()))
        throw new SurfaceError(
          "usage",
          `${target} already exists`,
          "pass clobber: true to overwrite it",
        );
      await Bun.write(target, bytes);
      return { ...base, output: target };
    },
  }),
  clone: op({
    description:
      "Clone a repository over https into a new local directory; when it is a fork, add the parent as a remote (`upstream` by default) and fetch it, as gh does. git authenticates through your own credential helper (e.g. `gh auth setup-git`); this SDK's token is not handed to git. Replaces `gh repo clone`.",
    input: s.object({
      repo: s.string({ description: "owner/name or a github.com URL." }),
      dir: s.string({ description: "Absolute path of the new checkout." }),
      gitFlags: s.optional(
        s.array(s.string(), {
          description: 'Extra `git clone` flags, e.g. ["--depth", "1"].',
        }),
      ),
      upstreamRemoteName: s.optional(
        s.string({
          description: "Remote name for a fork's parent (default upstream).",
        }),
      ),
      noUpstream: s.optional(
        s.boolean({
          description: "Do not add the parent of a fork as a remote.",
        }),
      ),
    }),
    annotations: writes,
    run: async ({ repo, dir, gitFlags, upstreamRemoteName, noUpstream }) => {
      if (!isAbsolute(dir))
        throw new SurfaceError(
          "usage",
          `dir must be absolute: ${dir}`,
          "pass the full path of the new checkout",
        );
      const r = await gh.repo(repo);
      const x = await gh.rest("GET", `repos/${r.full}`);
      const full = str(x, "full_name");
      const https = (name: string) => `https://github.com/${name}.git`;
      await gh.git(
        ["clone", ...(gitFlags ?? []), "--", https(full), dir],
        process.cwd(),
      );
      const parent = at(x, "parent");
      if (parent === undefined || noUpstream === true)
        return { repo: full, dir, upstream: null };
      const remote = upstreamRemoteName ?? "upstream";
      const parentFull = str(parent, "full_name");
      await gh.git(
        [
          "remote",
          "add",
          "-t",
          str(parent, "default_branch"),
          remote,
          https(parentFull),
        ],
        dir,
      );
      await gh.git(["fetch", remote], dir);
      await gh.git(["config", `remote.${remote}.gh-resolved`, "base"], dir);
      return { repo: full, dir, upstream: { remote, repo: parentFull } };
    },
  }),
});
