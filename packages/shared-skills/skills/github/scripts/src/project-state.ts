// Changing an existing project: title, description, readme and visibility; closed; template mark.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import {
  mutate,
  ownerField,
  PROJECT_FIELDS,
  projectNumberField,
  projectSummary,
  resolveProject,
} from "./project-ref.ts";
import { at } from "./read.ts";

const update = async (
  gh: GitHub,
  owner: string,
  number: number,
  patch: Readonly<Record<string, string | boolean | undefined>>,
) => {
  const { id } = await resolveProject(gh, owner, number);
  const input = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  );
  const result = await mutate(
    gh,
    "updateProjectV2",
    { projectId: id, ...input },
    `projectV2 { ${PROJECT_FIELDS} }`,
  );
  return projectSummary(at(result, "projectV2"));
};

const undoField = (what: string) =>
  s.optional(s.boolean({ description: `true to ${what} instead.` }));

export const projectStateOps = (gh: GitHub) => ({
  edit: op({
    description:
      "Change a project's title, short description, readme or visibility. Replaces `gh project edit`.",
    input: s.object({
      owner: ownerField,
      number: projectNumberField,
      title: s.optional(s.string()),
      description: s.optional(s.string()),
      readme: s.optional(s.string()),
      visibility: s.optional(s.enum(["PUBLIC", "PRIVATE"])),
    }),
    annotations: writes,
    run: async ({ owner, number, title, description, readme, visibility }) => {
      if (
        [title, description, readme, visibility].every((v) => v === undefined)
      )
        throw new SurfaceError(
          "usage",
          "nothing to change",
          "pass title, description, readme or visibility",
        );
      return update(gh, owner, number, {
        title,
        shortDescription: description,
        readme,
        public: visibility === undefined ? undefined : visibility === "PUBLIC",
      });
    },
  }),
  close: op({
    description:
      "Close a project, or reopen it with `undo`. Replaces `gh project close [--undo]`.",
    input: s.object({
      owner: ownerField,
      number: projectNumberField,
      undo: undoField("reopen"),
    }),
    annotations: writes,
    run: ({ owner, number, undo }) =>
      update(gh, owner, number, { closed: undo !== true }),
  }),
  markTemplate: op({
    description:
      "Mark an organization project as a template, or unmark it with `undo`. Replaces `gh project mark-template [--undo]`.",
    input: s.object({
      owner: ownerField,
      number: projectNumberField,
      undo: undoField("unmark it"),
    }),
    annotations: writes,
    run: async ({ owner, number, undo }) => {
      const { id } = await resolveProject(gh, owner, number);
      const result = await mutate(
        gh,
        undo === true ? "unmarkProjectV2AsTemplate" : "markProjectV2AsTemplate",
        { projectId: id },
        `projectV2 { ${PROJECT_FIELDS} }`,
      );
      return projectSummary(at(result, "projectV2"));
    },
  }),
});
