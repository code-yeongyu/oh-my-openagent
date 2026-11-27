// Uploading and deleting the assets of a release.
import { basename } from "node:path";
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import type { Infer } from "../vendor/surface/index.ts";
import { irreversible, repoField, writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { str } from "./read.ts";
import { findRelease, releaseAssets } from "./release-download.ts";

export const tagField = s.string({ description: "Release tag, e.g. v1.2.0." });
export const filesField = s.array(
  s.object({
    path: s.string({ description: "Local file to upload." }),
    name: s.optional(
      s.string({ description: "Asset name (default: the file's base name)." }),
    ),
    label: s.optional(s.string({ description: "Display label." })),
    contentType: s.optional(
      s.string({ description: "MIME type (default: from the extension)." }),
    ),
  }),
);
type Files = Infer<typeof filesField>;

const assetName = (f: Files[number]) => f.name ?? basename(f.path);

export const checkFiles = async (files: Files) => {
  for (const f of files)
    if (!(await Bun.file(f.path).exists()))
      throw new SurfaceError(
        "usage",
        `no such file: ${f.path}`,
        "pass paths to existing local files",
      );
};

export const uploadAll = async (gh: GitHub, release: unknown, files: Files) => {
  const base = str(release, "upload_url").replace(/\{[^}]*\}$/, "");
  const names: string[] = [];
  for (const f of files) {
    const file = Bun.file(f.path);
    const query = new URLSearchParams({
      name: assetName(f),
      ...(f.label === undefined ? {} : { label: f.label }),
    });
    const asset = await gh.upload(
      `${base}?${query.toString()}`,
      await file.bytes(),
      f.contentType ?? file.type,
    );
    names.push(str(asset, "name"));
  }
  return names;
};

export const releaseAssetOps = (gh: GitHub) => ({
  deleteAsset: op({
    description:
      "Delete one asset of a release by its name. Replaces `gh release delete-asset`.",
    input: s.object({ repo: repoField, tag: tagField, name: s.string() }),
    annotations: irreversible,
    run: async ({ repo, tag, name }) => {
      const r = await gh.repo(repo);
      const asset = releaseAssets(await findRelease(gh, r.full, tag)).find(
        (a) => a.name === name,
      );
      if (asset === undefined)
        throw new SurfaceError(
          "not_found",
          `release ${tag} has no asset ${name}`,
          "see the asset names with `release view`",
        );
      await gh.rest("DELETE", `repos/${r.full}/releases/assets/${asset.id}`);
      return { repo: r.full, tag, name, id: asset.id, deleted: true };
    },
  }),
  upload: op({
    description:
      "Upload files as assets of an existing release. A same-named asset fails as `conflict` before anything uploads, unless clobber replaces it. Replaces `gh release upload`.",
    input: s.object({
      repo: repoField,
      tag: tagField,
      files: filesField,
      clobber: s.optional(
        s.boolean({ description: "Delete same-named assets first." }),
      ),
    }),
    annotations: writes,
    run: async ({ repo, tag, files, clobber }) => {
      const r = await gh.repo(repo);
      await checkFiles(files);
      const rel = await findRelease(gh, r.full, tag);
      const wanted = new Set(files.map(assetName));
      const clashes = releaseAssets(rel).filter((a) => wanted.has(a.name));
      if (clashes.length > 0 && clobber !== true)
        throw new SurfaceError(
          "conflict",
          `release ${tag} already has ${clashes.map((a) => a.name).join(", ")}`,
          "pass clobber: true to replace them",
        );
      for (const a of clashes)
        await gh.rest("DELETE", `repos/${r.full}/releases/assets/${a.id}`);
      return {
        repo: r.full,
        tag,
        assets: await uploadAll(gh, rel, files),
        replaced: clashes.map((a) => a.name),
      };
    },
  }),
});
