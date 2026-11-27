// Finding a release by tag (drafts included) and downloading its assets or source archive.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { enc, repoField, writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { arr, at, num, str } from "./read.ts";
import { safeJoin } from "./zip.ts";

// GET releases/tags/{tag} never returns a draft, so a miss falls back to scanning the release list.
export const findRelease = async (
  gh: GitHub,
  full: string,
  tag: string,
): Promise<unknown> => {
  try {
    return await gh.rest("GET", `repos/${full}/releases/tags/${enc(tag)}`);
  } catch (error) {
    if (!(error instanceof SurfaceError && error.kind === "not_found"))
      throw error;
  }
  const draft = (await gh.list(`repos/${full}/releases`, 1000)).find(
    (x) => str(x, "tag_name") === tag,
  );
  if (draft === undefined)
    throw new SurfaceError(
      "not_found",
      `no release for tag ${tag} in ${full}`,
      "list releases with `release list`",
    );
  return draft;
};

export const releaseAssets = (x: unknown) =>
  arr(at(x, "assets") ?? [], "assets").map((a) => ({
    id: num(a, "id"),
    name: str(a, "name"),
  }));

export const releaseDownloadOp = (gh: GitHub) =>
  op({
    description:
      "Download release assets (all, or those matching glob patterns) and/or the source archive into a directory; returns the written paths and sizes. Existing files fail as `conflict` unless skipExisting or clobber is set. Replaces `gh release download`.",
    input: s.object({
      repo: repoField,
      tag: s.optional(
        s.string({
          description:
            "Release tag; the latest release when omitted (then patterns or archive is required).",
        }),
      ),
      patterns: s.optional(
        s.array(s.string(), {
          description: "Glob patterns over asset names, e.g. *.tar.gz.",
        }),
      ),
      archive: s.optional(
        s.enum(["zip", "tar.gz"], {
          description: "Also download the source code archive.",
        }),
      ),
      dir: s.optional(
        s.string({ description: "Target directory (default: cwd)." }),
      ),
      skipExisting: s.optional(s.boolean()),
      clobber: s.optional(
        s.boolean({ description: "Overwrite existing files." }),
      ),
    }),
    annotations: writes,
    run: async ({
      repo,
      tag,
      patterns,
      archive,
      dir,
      skipExisting,
      clobber,
    }) => {
      if (skipExisting === true && clobber === true)
        throw new SurfaceError(
          "usage",
          "skipExisting and clobber exclude each other",
          "pass one of them",
        );
      if (tag === undefined && patterns === undefined && archive === undefined)
        throw new SurfaceError(
          "usage",
          "downloading the latest release needs patterns or archive",
          "pass patterns, archive, or a tag",
        );
      const r = await gh.repo(repo);
      const rel =
        tag === undefined
          ? await gh.rest("GET", `repos/${r.full}/releases/latest`)
          : await findRelease(gh, r.full, tag);
      const relTag = str(rel, "tag_name");
      const globs = (patterns ?? []).map((p) => new Bun.Glob(p));
      const assets =
        archive !== undefined && patterns === undefined
          ? []
          : releaseAssets(rel).filter(
              (a) => globs.length === 0 || globs.some((g) => g.match(a.name)),
            );
      const wanted = [
        ...assets.map((a) => ({
          name: a.name,
          path: `repos/${r.full}/releases/assets/${a.id}`,
          accept: "application/octet-stream",
        })),
        ...(archive === undefined
          ? []
          : [
              {
                name: `${r.name}-${relTag.replace(/^v/, "")}.${archive}`,
                path: `repos/${r.full}/${archive === "zip" ? "zipball" : "tarball"}/${enc(relTag)}`,
                accept: undefined,
              },
            ]),
      ];
      if (wanted.length === 0)
        throw new SurfaceError(
          "not_found",
          `no assets of ${relTag} match ${(patterns ?? []).join(", ")}`,
          "see the asset names with `release view`",
        );
      const planned = await Promise.all(
        wanted.map(async (w) => {
          const target = safeJoin(dir ?? ".", w.name);
          return { ...w, target, exists: await Bun.file(target).exists() };
        }),
      );
      const clash = planned.find((p) => p.exists);
      if (clash !== undefined && skipExisting !== true && clobber !== true)
        throw new SurfaceError(
          "conflict",
          `${clash.target} already exists`,
          "pass skipExisting or clobber",
        );
      const files: { readonly path: string; readonly size: number }[] = [];
      const skipped: string[] = [];
      for (const p of planned) {
        if (p.exists && skipExisting === true) {
          skipped.push(p.target);
          continue;
        }
        const bytes = await gh.bytes(p.path, p.accept);
        await Bun.write(p.target, bytes);
        files.push({ path: p.target, size: bytes.length });
      }
      return { repo: r.full, tag: relTag, files, skipped };
    },
  });
