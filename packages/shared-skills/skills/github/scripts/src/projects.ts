// Projects (v2) themselves: list, view, create, delete and copy; state changes and links are spread in.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { irreversible, limitField, reads, writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { linkOp } from "./project-links.ts";
import {
  collect,
  declare,
  missing,
  mutate,
  ownerField,
  ownerRoot,
  pageInfo,
  PROJECT_FIELDS as FIELDS,
  projectGraphql,
  projectNumberField,
  projectQuery,
  projectSummary as project,
  resolveOwner,
  resolveProject,
} from "./project-ref.ts";
import { projectStateOps } from "./project-state.ts";
import { at, bool, num, optStr, str } from "./read.ts";

export const projectOps = (gh: GitHub) => ({
  list: op({
    description:
      "Projects of a user or organization, open ones only unless `closed` is true. Replaces `gh project list`.",
    input: s.object({
      owner: ownerField,
      closed: s.optional(
        s.boolean({ description: "Include closed projects." }),
      ),
      limit: limitField(30),
    }),
    annotations: reads,
    run: async ({ owner, closed, limit }) => {
      const o = ownerRoot(owner);
      const query = `query${declare("$first: Int!", "$after: String", o.decl)} { owner: ${o.root} { login ... on ProjectV2Owner { projectsV2(first: $first, after: $after) { nodes { ${FIELDS} } ${pageInfo} } } } }`;
      let login = owner;
      const raw = await collect(
        limit ?? 30,
        async (first, after) => {
          const data = await projectGraphql(gh, query, {
            first,
            after,
            ...o.vars,
          });
          if (at(data, "owner") == null) throw missing(`owner ${owner}`);
          login = str(data, "owner", "login");
          return at(data, "owner", "projectsV2");
        },
        (p) => closed === true || !bool(p, "closed"),
      );
      return { owner: login, items: raw.map(project) };
    },
  }),
  view: op({
    description:
      "One project with its readme and item and field counts. Replaces `gh project view`.",
    input: s.object({ owner: ownerField, number: projectNumberField }),
    annotations: reads,
    run: async ({ owner, number }) => {
      const { login, project: p } = await projectQuery(
        gh,
        owner,
        number,
        `${FIELDS} readme items { totalCount } fields { totalCount }`,
      );
      return {
        owner: login,
        ...project(p),
        readme: optStr(p, "readme"),
        itemCount: num(p, "items", "totalCount"),
        fieldCount: num(p, "fields", "totalCount"),
      };
    },
  }),
  create: op({
    description:
      "Create an empty project under a user or organization. Replaces `gh project create`.",
    input: s.object({ owner: ownerField, title: s.string() }),
    annotations: writes,
    run: async ({ owner, title }) => {
      const o = await resolveOwner(gh, owner);
      const result = await mutate(
        gh,
        "createProjectV2",
        { ownerId: o.id, title },
        `projectV2 { ${FIELDS} }`,
      );
      return { owner: o.login, ...project(at(result, "projectV2")) };
    },
  }),
  delete: op({
    description:
      "Delete a project with all its items and fields; this cannot be undone. `confirm` must equal the project's title. Replaces `gh project delete`.",
    input: s.object({
      owner: ownerField,
      number: projectNumberField,
      confirm: s.string({ description: "The project's exact title." }),
    }),
    annotations: irreversible,
    run: async ({ owner, number, confirm }) => {
      const p = await resolveProject(gh, owner, number);
      if (confirm !== p.title)
        throw new SurfaceError(
          "usage",
          `confirm "${confirm}" does not match the project title "${p.title}"`,
          "pass the project's exact title as confirm",
        );
      await mutate(
        gh,
        "deleteProjectV2",
        { projectId: p.id },
        "projectV2 { id }",
      );
      return { id: p.id, title: p.title, deleted: true };
    },
  }),
  copy: op({
    description:
      "Copy a project's fields and views (and draft issues with `drafts`) into a new project. Replaces `gh project copy`.",
    input: s.object({
      owner: s.string({
        description: 'Source project owner login, or "@me".',
      }),
      number: projectNumberField,
      targetOwner: s.optional(
        s.string({ description: "New project owner (default: owner)." }),
      ),
      title: s.string({ description: "Title for the new project." }),
      drafts: s.optional(
        s.boolean({ description: "Include draft issues when copying." }),
      ),
    }),
    annotations: writes,
    run: async ({ owner, number, targetOwner, title, drafts }) => {
      const source = await resolveProject(gh, owner, number);
      const target = await resolveOwner(gh, targetOwner ?? owner);
      const result = await mutate(
        gh,
        "copyProjectV2",
        {
          projectId: source.id,
          ownerId: target.id,
          title,
          includeDraftIssues: drafts === true,
        },
        `projectV2 { ${FIELDS} }`,
      );
      return { owner: target.login, ...project(at(result, "projectV2")) };
    },
  }),
  link: linkOp(gh, "link"),
  unlink: linkOp(gh, "unlink"),
  ...projectStateOps(gh),
});
