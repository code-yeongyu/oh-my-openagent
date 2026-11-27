// Checking out a pull request into an existing local clone through git.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { numberField, repoField, writes } from "./fields.ts";
import type { GitHub, Repo } from "./http.ts";
import { str } from "./read.ts";

const remoteFor = async (gh: GitHub, r: Repo, dir: string) => {
  const wanted = r.full.toLowerCase();
  for (const line of (await gh.git(["remote", "-v"], dir)).split("\n")) {
    const [name, url] = line.split(/\s+/);
    const path = url
      ?.toLowerCase()
      .replace(/\/$/, "")
      .replace(/\.git$/, "");
    if (
      name !== undefined &&
      (path?.endsWith(`github.com/${wanted}`) ||
        path?.endsWith(`github.com:${wanted}`))
    )
      return name;
  }
  return `https://github.com/${r.full}.git`;
};

export const checkoutOp = (gh: GitHub) =>
  op({
    description:
      "Fetch a PR's head (refs/pull/N/head) from the base repository into the existing clone at `dir` and switch to it: a new branch is created, an existing one is fast-forwarded (or reset with force), or with detach HEAD is detached at it. No upstream tracking is configured. Replaces `gh pr checkout`.",
    input: s.object({
      repo: repoField,
      number: numberField,
      dir: s.string({ description: "Path of the existing local clone." }),
      branch: s.optional(
        s.string({
          description: "Local branch name (default: the PR's head branch).",
        }),
      ),
      detach: s.optional(s.boolean()),
      force: s.optional(
        s.boolean({
          description: "Reset an existing local branch to the PR head.",
        }),
      ),
    }),
    annotations: writes,
    run: async ({ repo, number, dir, branch, detach, force }) => {
      if (detach === true && branch !== undefined)
        throw new SurfaceError(
          "usage",
          "detach and branch cannot be combined",
          "drop one of them",
        );
      const r = await gh.repo(repo);
      const name =
        detach === true
          ? null
          : (branch ??
            str(
              await gh.rest("GET", `repos/${r.full}/pulls/${number}`),
              "head",
              "ref",
            ));
      if (name?.startsWith("-"))
        throw new SurfaceError(
          "usage",
          `invalid branch name: ${name}`,
          "pass branch",
        );
      await gh.git(
        ["fetch", await remoteFor(gh, r, dir), `refs/pull/${number}/head`],
        dir,
      );
      if (name === null)
        await gh.git(["checkout", "--detach", "FETCH_HEAD"], dir);
      else if (
        force === true ||
        (await gh.git(["branch", "--list", name], dir)).trim() === ""
      )
        await gh.git(["checkout", "-B", name, "FETCH_HEAD"], dir);
      else {
        await gh.git(["checkout", name], dir);
        await gh.git(["merge", "--ff-only", "FETCH_HEAD"], dir);
      }
      return {
        repo: r.full,
        number,
        dir,
        branch: name,
        headSha: (await gh.git(["rev-parse", "HEAD"], dir)).trim(),
      };
    },
  });
