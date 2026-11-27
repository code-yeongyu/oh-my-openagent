// Creating, editing and deleting releases and their assets.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { enc, irreversible, repoField, writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { bool, num, str } from "./read.ts";
import {
  checkFiles,
  filesField,
  releaseAssetOps,
  tagField,
  uploadAll,
} from "./release-assets.ts";
import { findRelease, releaseDownloadOp } from "./release-download.ts";

const settings = {
  title: s.optional(s.string()),
  notes: s.optional(s.string({ description: "Release notes (markdown)." })),
  target: s.optional(
    s.string({
      description:
        "Branch or full commit SHA the tag is created from (default branch when omitted).",
    }),
  ),
  draft: s.optional(s.boolean()),
  prerelease: s.optional(s.boolean()),
  latest: s.optional(
    s.boolean({
      description:
        "true marks it Latest, false keeps it from being Latest; omitted lets GitHub decide by date and version.",
    }),
  ),
  discussionCategory: s.optional(
    s.string({ description: "Start a discussion in this category." }),
  ),
  verifyTag: s.optional(
    s.boolean({ description: "Fail unless the tag already exists on GitHub." }),
  ),
};

const defined = (o: Readonly<Record<string, unknown>>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const refPath = (tag: string) => tag.split("/").map(enc).join("/");
const latestFlag = (latest: boolean | undefined) =>
  latest === undefined ? undefined : String(latest);

const summary = (repo: string, x: unknown) => ({
  repo,
  tag: str(x, "tag_name"),
  id: num(x, "id"),
  url: str(x, "html_url"),
  draft: bool(x, "draft"),
  prerelease: bool(x, "prerelease"),
});

const checkTag = async (gh: GitHub, full: string, tag: string) => {
  try {
    await gh.rest("GET", `repos/${full}/git/ref/tags/${refPath(tag)}`);
  } catch (error) {
    if (error instanceof SurfaceError && error.kind === "not_found")
      throw new SurfaceError(
        "not_found",
        `tag ${tag} does not exist in ${full}`,
        "push the tag first or drop verifyTag",
      );
    throw error;
  }
};

export const releaseWriteOps = (gh: GitHub) => ({
  create: op({
    description:
      "Create a release (or draft) for a tag, optionally with generated notes, then upload files as assets. Returns the tag, id, url and uploaded asset names. Replaces `gh release create`.",
    input: s.object({
      repo: repoField,
      tag: tagField,
      ...settings,
      generateNotes: s.optional(
        s.boolean({ description: "Let GitHub generate title and notes." }),
      ),
      notesStartTag: s.optional(
        s.string({
          description:
            "Generate notes from this earlier tag onward (implies generateNotes).",
        }),
      ),
      files: s.optional(filesField),
    }),
    annotations: writes,
    run: async (input) => {
      const r = await gh.repo(input.repo);
      const files = input.files ?? [];
      await checkFiles(files);
      if (input.verifyTag === true) await checkTag(gh, r.full, input.tag);
      let { title, notes } = input;
      if (input.notesStartTag !== undefined) {
        const g = await gh.rest(
          "POST",
          `repos/${r.full}/releases/generate-notes`,
          {
            body: defined({
              tag_name: input.tag,
              target_commitish: input.target,
              previous_tag_name: input.notesStartTag,
            }),
          },
        );
        notes = [notes, str(g, "body")].filter(Boolean).join("\n\n");
        title ??= str(g, "name");
      }
      const x = await gh.rest("POST", `repos/${r.full}/releases`, {
        body: defined({
          tag_name: input.tag,
          target_commitish: input.target,
          name: title,
          body: notes,
          draft: input.draft,
          prerelease: input.prerelease,
          make_latest: latestFlag(input.latest),
          discussion_category_name: input.discussionCategory,
          generate_release_notes:
            input.notesStartTag === undefined ? input.generateNotes : undefined,
        }),
      });
      return { ...summary(r.full, x), assets: await uploadAll(gh, x, files) };
    },
  }),
  edit: op({
    description:
      "Change a release's tag, title, notes, target, draft/prerelease/latest state or discussion category; publishing a draft is draft: false. Replaces `gh release edit`.",
    input: s.object({
      repo: repoField,
      tag: tagField,
      newTag: s.optional(s.string({ description: "Rename the tag to this." })),
      ...settings,
    }),
    annotations: writes,
    run: async (input) => {
      const patch = defined({
        tag_name: input.newTag,
        target_commitish: input.target,
        name: input.title,
        body: input.notes,
        draft: input.draft,
        prerelease: input.prerelease,
        make_latest: latestFlag(input.latest),
        discussion_category_name: input.discussionCategory,
      });
      if (Object.keys(patch).length === 0)
        throw new SurfaceError(
          "usage",
          "nothing to edit",
          "pass at least one field to change",
        );
      const r = await gh.repo(input.repo);
      if (input.verifyTag === true)
        await checkTag(gh, r.full, input.newTag ?? input.tag);
      const cur = await findRelease(gh, r.full, input.tag);
      const x = await gh.rest(
        "PATCH",
        `repos/${r.full}/releases/${num(cur, "id")}`,
        { body: patch },
      );
      return summary(r.full, x);
    },
  }),
  delete: op({
    description:
      "Delete a release; cleanupTag also deletes its git tag (a tag that is already gone is not an error). Replaces `gh release delete`.",
    input: s.object({
      repo: repoField,
      tag: tagField,
      cleanupTag: s.optional(s.boolean()),
    }),
    annotations: irreversible,
    run: async ({ repo, tag, cleanupTag }) => {
      const r = await gh.repo(repo);
      const id = num(await findRelease(gh, r.full, tag), "id");
      await gh.rest("DELETE", `repos/${r.full}/releases/${id}`);
      let tagDeleted = false;
      if (cleanupTag === true) {
        try {
          await gh.rest(
            "DELETE",
            `repos/${r.full}/git/refs/tags/${refPath(tag)}`,
          );
          tagDeleted = true;
        } catch (error) {
          if (!(error instanceof SurfaceError && error.kind === "not_found"))
            throw error;
        }
      }
      return { repo: r.full, tag, id, deleted: true, tagDeleted };
    },
  }),
  ...releaseAssetOps(gh),
  download: releaseDownloadOp(gh),
});
