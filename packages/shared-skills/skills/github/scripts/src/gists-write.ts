// Gist writes: create, edit, rename, delete and clone.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { enc, irreversible, writes } from "./fields.ts";
import {
  contentsOf,
  gistField,
  gistId,
  gistWritten,
  readPaths,
} from "./gist-shape.ts";
import type { GitHub } from "./http.ts";

export const gistWriteOps = (gh: GitHub) => ({
  create: op({
    description:
      "Create a gist from inline contents and/or local files; secret unless `public`. Replaces `gh gist create`.",
    input: s.object({
      files: s.optional(
        s.record(s.string(), { description: "filename -> content." }),
      ),
      paths: s.optional(
        s.array(s.string(), {
          description: "Local files to upload under their base names.",
        }),
      ),
      description: s.optional(s.string()),
      public: s.optional(s.boolean()),
    }),
    annotations: writes,
    run: async ({ files, paths, description, public: isPublic }) => {
      const contents = {
        ...contentsOf(files ?? {}),
        ...(await readPaths(paths ?? [])),
      };
      if (Object.keys(contents).length === 0)
        throw new SurfaceError(
          "usage",
          "a gist needs at least one file",
          "pass files or paths",
        );
      return gistWritten(
        await gh.rest("POST", "gists", {
          body: {
            files: contents,
            public: isPublic ?? false,
            ...(description === undefined ? {} : { description }),
          },
        }),
      );
    },
  }),
  edit: op({
    description:
      "Change a gist's description, replace or add file contents, add local files, or remove files. Replaces `gh gist edit`.",
    input: s.object({
      id: gistField,
      description: s.optional(s.string()),
      set: s.optional(
        s.record(s.string(), {
          description: "filename -> new content (adds the file if missing).",
        }),
      ),
      add: s.optional(
        s.array(s.string(), {
          description: "Local files to add under their base names.",
        }),
      ),
      remove: s.optional(s.array(s.string(), { description: "Filenames." })),
    }),
    annotations: writes,
    run: async ({ id, description, set, add, remove }) => {
      const gist = gistId(id);
      const files = {
        ...contentsOf(set ?? {}),
        ...(await readPaths(add ?? [])),
        ...Object.fromEntries((remove ?? []).map((name) => [name, null])),
      };
      if (description === undefined && Object.keys(files).length === 0)
        throw new SurfaceError(
          "usage",
          "nothing to change",
          "pass description, set, add or remove",
        );
      return gistWritten(
        await gh.rest("PATCH", `gists/${enc(gist)}`, {
          body: {
            ...(description === undefined ? {} : { description }),
            ...(Object.keys(files).length === 0 ? {} : { files }),
          },
        }),
      );
    },
  }),
  rename: op({
    description:
      "Rename one file in a gist, keeping its content. Replaces `gh gist rename`.",
    input: s.object({ id: gistField, from: s.string(), to: s.string() }),
    annotations: writes,
    run: async ({ id, from, to }) =>
      gistWritten(
        await gh.rest("PATCH", `gists/${enc(gistId(id))}`, {
          body: { files: { [from]: { filename: to } } },
        }),
      ),
  }),
  delete: op({
    description: "Delete a gist and its history. Replaces `gh gist delete`.",
    input: s.object({ id: gistField }),
    annotations: irreversible,
    run: async ({ id }) => {
      const gist = gistId(id);
      await gh.rest("DELETE", `gists/${enc(gist)}`);
      return { id: gist, deleted: true };
    },
  }),
  clone: op({
    description:
      "Clone a gist's git repository into a local directory. Replaces `gh gist clone`.",
    input: s.object({
      id: gistField,
      dir: s.string({ description: "Directory to clone into." }),
    }),
    annotations: writes,
    run: async ({ id, dir }) => {
      const gist = gistId(id);
      await gh.git(["clone", `https://gist.github.com/${gist}.git`, dir], ".");
      return { id: gist, dir };
    },
  }),
});
