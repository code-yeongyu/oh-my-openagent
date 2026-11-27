// `repo url`: the github.com address `gh browse -n` prints, built locally; only a bare path asks GitHub for the default branch.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { enc, reads, repoField } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { str } from "./read.ts";

const segments = (path: string) =>
  path.split("/").filter(Boolean).map(enc).join("/");

const usage = (message: string) =>
  new SurfaceError(
    "usage",
    message,
    "see the field descriptions of `repo url`",
  );

export const urlOp = (gh: GitHub) =>
  op({
    description:
      "The github.com URL of a repository, an issue or pull request, a file or directory (optionally at a branch or commit and line), a commit, or a repository page. Opens nothing. Replaces `gh browse -n`.",
    input: s.object({
      repo: repoField,
      number: s.optional(
        s.integer({ description: "Issue or pull request number." }),
      ),
      path: s.optional(
        s.string({
          description: "File or directory path from the repository root.",
        }),
      ),
      line: s.optional(s.integer({ description: "Line to point at in path." })),
      endLine: s.optional(
        s.integer({ description: "Last line of a range starting at line." }),
      ),
      blame: s.optional(s.boolean({ description: "Blame view of path." })),
      branch: s.optional(
        s.string({
          description: "Branch for path, or the branch's tree alone.",
        }),
      ),
      commit: s.optional(
        s.string({
          description:
            "Commit SHA: the version of path, or the commit page alone.",
        }),
      ),
      page: s.optional(
        s.enum(["settings", "wiki", "releases", "actions", "projects"]),
      ),
    }),
    annotations: reads,
    run: async ({
      repo,
      number,
      path,
      line,
      endLine,
      blame,
      branch,
      commit,
      page,
    }) => {
      const located =
        path !== undefined || branch !== undefined || commit !== undefined;
      if (
        [number !== undefined, page !== undefined, located].filter(Boolean)
          .length > 1
      )
        throw usage("pass only one of number, page, or path/branch/commit");
      if (branch !== undefined && commit !== undefined)
        throw usage("pass branch or commit, not both");
      if (path === undefined && (line !== undefined || blame === true))
        throw usage("line and blame need a path");
      if (endLine !== undefined && line === undefined)
        throw usage("endLine needs line");
      const r = await gh.repo(repo);
      const base = `https://github.com/${r.full}`;
      const at = (suffix: string) => ({
        repo: r.full,
        url: `${base}/${suffix}`,
      });
      if (number !== undefined) return at(`issues/${number}`);
      if (page !== undefined) return at(page);
      if (path === undefined) {
        if (commit !== undefined) return at(`commit/${enc(commit)}`);
        if (branch !== undefined) return at(`tree/${segments(branch)}`);
        return { repo: r.full, url: base };
      }
      const ref =
        branch ??
        commit ??
        str(await gh.rest("GET", `repos/${r.full}`), "default_branch");
      const view =
        blame === true ? "blame" : line === undefined ? "tree" : "blob";
      // Markdown renders by default, and a rendered page has no line anchors.
      const plain =
        view === "blob" && /\.(md|markdown)$/i.test(path) ? "?plain=1" : "";
      const anchor =
        line === undefined
          ? ""
          : `#L${line}${endLine === undefined ? "" : `-L${endLine}`}`;
      return at(`${view}/${segments(ref)}/${segments(path)}${plain}${anchor}`);
    },
  });
