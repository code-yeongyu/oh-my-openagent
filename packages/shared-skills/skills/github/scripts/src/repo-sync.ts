// `repo sync` in its remote form: bring a branch of a repository up to date with its upstream or another repository.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { enc, repoField, writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { optStr, str } from "./read.ts";

// Reading one ref is git/ref/... (git/refs/... lists every ref with that prefix); updating it is git/refs/....
const refPath = (kind: "ref" | "refs", branch: string) =>
  `git/${kind}/heads/${branch.split("/").map(enc).join("/")}`;

export const syncOp = (gh: GitHub) =>
  op({
    description:
      "Update a branch of a repository on GitHub: without source, merge it from the fork's upstream (falling back to a forced reset to the parent when force is set and the merge conflicts); with source, move it to the source branch's head, fast-forward only unless force. No local checkout is touched. Replaces `gh repo sync` for a remote repository.",
    input: s.object({
      repo: repoField,
      branch: s.optional(
        s.string({
          description:
            "Branch to sync; default the destination's default branch (with source: the source's).",
        }),
      ),
      source: s.optional(
        s.string({ description: "Source repository owner/name." }),
      ),
      force: s.optional(
        s.boolean({
          description:
            "Hard reset the branch to the source, discarding its own commits.",
        }),
      ),
    }),
    annotations: writes,
    run: async ({ repo, branch, source, force }) => {
      const r = await gh.repo(repo);
      const fromSource = async (src: string) => {
        const name =
          branch ?? str(await gh.rest("GET", `repos/${src}`), "default_branch");
        const sha = str(
          await gh.rest("GET", `repos/${src}/${refPath("ref", name)}`),
          "object",
          "sha",
        );
        await gh.rest("PATCH", `repos/${r.full}/${refPath("refs", name)}`, {
          body: { sha, force: force === true },
        });
        return {
          repo: r.full,
          branch: name,
          source: src,
          sha,
          mergeType: force === true ? "reset" : "fast-forward",
        };
      };
      if (source !== undefined) return fromSource((await gh.repo(source)).full);
      const dest = await gh.rest("GET", `repos/${r.full}`);
      const name = branch ?? str(dest, "default_branch");
      try {
        const m = await gh.rest("POST", `repos/${r.full}/merge-upstream`, {
          body: { branch: name },
        });
        return {
          repo: r.full,
          branch: name,
          source: optStr(dest, "parent", "full_name"),
          sha: null,
          mergeType: optStr(m, "merge_type"),
        };
      } catch (error) {
        const parent = optStr(dest, "parent", "full_name");
        if (
          force === true &&
          parent !== null &&
          error instanceof SurfaceError &&
          error.kind === "conflict"
        )
          return fromSource(parent);
        throw error;
      }
    },
  });
