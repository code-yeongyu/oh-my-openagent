// `repo create`: a new repository for a user or organization, empty, initialized, or generated from a template.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { enc, writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { num, str } from "./read.ts";
import { defined, repoSettings } from "./repo-settings.ts";

const usage = (message: string, hint: string) =>
  new SurfaceError("usage", message, hint);

export const createOp = (gh: GitHub) =>
  op({
    description:
      "Create a repository on GitHub: empty, initialized with a README, .gitignore or license, or generated from a template. API-side only: it does not clone, push or link a local directory (gh's --clone, --push, --source, --remote). Replaces `gh repo create`.",
    input: s.object({
      name: s.string({ description: "New repository name." }),
      owner: s.optional(
        s.string({
          description:
            "Organization (or your own login) to own it; default the authenticated user.",
        }),
      ),
      visibility: s.enum(["public", "private", "internal"]),
      description: s.optional(s.string()),
      homepage: s.optional(s.string()),
      template: s.optional(
        s.string({
          description: "Template repository owner/name to generate from.",
        }),
      ),
      includeAllBranches: s.optional(
        s.boolean({
          description:
            "Copy every branch of the template, not only the default.",
        }),
      ),
      addReadme: s.optional(s.boolean()),
      gitignore: s.optional(
        s.string({ description: "gitignore template name, e.g. Node." }),
      ),
      license: s.optional(s.string({ description: "License key, e.g. mit." })),
      team: s.optional(
        s.string({
          description: "Slug of the organization team granted access.",
        }),
      ),
      disableIssues: s.optional(s.boolean()),
      disableWiki: s.optional(s.boolean()),
    }),
    annotations: writes,
    run: async (i) => {
      const hint = "see `gh repo create` for which options combine";
      if (i.includeAllBranches === true && i.template === undefined)
        throw usage("includeAllBranches needs template", hint);
      if (
        i.template !== undefined &&
        (i.addReadme === true ||
          i.gitignore !== undefined ||
          i.license !== undefined ||
          i.homepage !== undefined ||
          i.team !== undefined ||
          i.disableIssues === true ||
          i.disableWiki === true)
      )
        throw usage(
          "template cannot combine with addReadme, gitignore, license, homepage, team, disableIssues or disableWiki",
          hint,
        );
      if (i.template !== undefined) {
        const t = await gh.repo(i.template);
        const x = await gh.rest("POST", `repos/${t.full}/generate`, {
          body: defined({
            owner: i.owner,
            name: i.name,
            description: i.description,
            include_all_branches: i.includeAllBranches,
            private: i.visibility !== "public",
          }),
        });
        // generate takes only a private flag; internal is set afterwards.
        return repoSettings(
          i.visibility === "internal"
            ? await gh.rest("PATCH", `repos/${str(x, "full_name")}`, {
                body: { visibility: "internal" },
              })
            : x,
        );
      }
      let org: string | undefined;
      if (i.owner !== undefined) {
        const owner = await gh.rest("GET", `users/${enc(i.owner)}`);
        if (str(owner, "type") === "Organization") org = str(owner, "login");
        else if (
          str(await gh.rest("GET", "user"), "login").toLowerCase() !==
          i.owner.toLowerCase()
        )
          throw usage(
            `${i.owner} is another user`,
            "create under your own account or an organization",
          );
      }
      if (
        org === undefined &&
        (i.visibility === "internal" || i.team !== undefined)
      )
        throw usage(
          "internal visibility and team need an organization owner",
          hint,
        );
      const teamId =
        org === undefined || i.team === undefined
          ? undefined
          : num(
              await gh.rest("GET", `orgs/${enc(org)}/teams/${enc(i.team)}`),
              "id",
            );
      const x = await gh.rest(
        "POST",
        org === undefined ? "user/repos" : `orgs/${enc(org)}/repos`,
        {
          body: defined({
            name: i.name,
            description: i.description,
            homepage: i.homepage,
            ...(org === undefined
              ? { private: i.visibility === "private" }
              : { visibility: i.visibility }),
            team_id: teamId,
            auto_init: i.addReadme === true ? true : undefined,
            gitignore_template: i.gitignore,
            license_template: i.license,
            has_issues: i.disableIssues === true ? false : undefined,
            has_wiki: i.disableWiki === true ? false : undefined,
          }),
        },
      );
      return repoSettings(x);
    },
  });
