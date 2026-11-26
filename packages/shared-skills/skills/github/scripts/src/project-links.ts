// Linking a project to a repository or an organization team, and undoing it.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import {
  mutate,
  ownerField,
  projectGraphql,
  projectNumberField,
  resolveProject,
} from "./project-ref.ts";
import { at, str } from "./read.ts";

const target = async (
  gh: GitHub,
  owner: string,
  repo: string | undefined,
  team: string | undefined,
) => {
  if (repo !== undefined && team !== undefined)
    throw new SurfaceError(
      "usage",
      "pass repo or team, not both",
      "link one target per call",
    );
  if (team !== undefined) {
    if (owner === "@me")
      throw new SurfaceError(
        "usage",
        "teams belong to organizations; @me has none",
        "pass the organization login as owner",
      );
    const data = await projectGraphql(
      gh,
      "query($org: String!, $slug: String!) { organization(login: $org) { team(slug: $slug) { id slug } } }",
      { org: owner, slug: team },
    );
    if (at(data, "organization", "team") == null)
      throw new SurfaceError(
        "not_found",
        `team ${owner}/${team} not found`,
        "pass the team slug of the project's organization",
      );
    return {
      kind: "team",
      id: str(data, "organization", "team", "id"),
      name: `${owner}/${team}`,
    } as const;
  }
  const r = await gh.repo(repo);
  const data = await projectGraphql(
    gh,
    "query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id } }",
    { owner: r.owner, name: r.name },
  );
  return {
    kind: "repo",
    id: str(data, "repository", "id"),
    name: r.full,
  } as const;
};

export const linkOp = (gh: GitHub, action: "link" | "unlink") =>
  op({
    description:
      action === "link"
        ? "Link a project to a repository (default: the current repo) or to an organization team. Replaces `gh project link`."
        : "Unlink a project from a repository (default: the current repo) or from an organization team. Replaces `gh project unlink`.",
    input: s.object({
      owner: ownerField,
      number: projectNumberField,
      repo: s.optional(
        s.string({
          description:
            "owner/name to link. Defaults to the git origin of the current directory.",
        }),
      ),
      team: s.optional(
        s.string({ description: "Team slug in the owner organization." }),
      ),
    }),
    annotations: writes,
    run: async ({ owner, number, repo, team }) => {
      const to = await target(gh, owner, repo, team);
      const project = await resolveProject(gh, owner, number);
      const verb =
        action === "link" ? "linkProjectV2To" : "unlinkProjectV2From";
      const noun = to.kind === "team" ? "Team" : "Repository";
      await mutate(
        gh,
        `${verb}${noun}`,
        {
          projectId: project.id,
          [to.kind === "team" ? "teamId" : "repositoryId"]: to.id,
        },
        to.kind === "team" ? "team { id }" : "repository { id }",
      );
      return {
        projectId: project.id,
        [to.kind === "team" ? "team" : "repo"]: to.name,
        linked: action === "link",
      };
    },
  });
