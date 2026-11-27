// Project (v2) fields: list them with their options and iterations, create custom ones, delete them.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { irreversible, limitField, reads, writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import {
  collect,
  mutate,
  ownerField,
  pageInfo,
  projectNumberField,
  projectQuery,
  resolveProject,
} from "./project-ref.ts";
import { arr, at, num, str } from "./read.ts";

const FIELD = `... on ProjectV2FieldCommon { id name dataType }
  ... on ProjectV2SingleSelectField { options { id name } }
  ... on ProjectV2IterationField { configuration { iterations { id title startDate duration } } }`;

const field = (x: unknown) => {
  const options = at(x, "options");
  const iterations = at(x, "configuration", "iterations");
  return {
    id: str(x, "id"),
    name: str(x, "name"),
    dataType: str(x, "dataType"),
    ...(options === undefined
      ? {}
      : {
          options: arr(options, "options").map((o) => ({
            id: str(o, "id"),
            name: str(o, "name"),
          })),
        }),
    ...(iterations === undefined
      ? {}
      : {
          iterations: arr(iterations, "iterations").map((i) => ({
            id: str(i, "id"),
            title: str(i, "title"),
            startDate: str(i, "startDate"),
            duration: num(i, "duration"),
          })),
        }),
  };
};

export const projectFieldOps = (gh: GitHub) => ({
  fieldList: op({
    description:
      "Fields of a project with ids, data types, single-select options and iterations (the ids itemEdit needs). Replaces `gh project field-list`.",
    input: s.object({
      owner: ownerField,
      number: projectNumberField,
      limit: limitField(30),
    }),
    annotations: reads,
    run: async ({ owner, number, limit }) => {
      let login = owner;
      const raw = await collect(limit ?? 30, async (first, after) => {
        const r = await projectQuery(
          gh,
          owner,
          number,
          `fields(first: $first, after: $after) { nodes { ${FIELD} } ${pageInfo} }`,
          { decl: "$first: Int!, $after: String", vars: { first, after } },
        );
        login = r.login;
        return at(r.project, "fields");
      });
      return { owner: login, number, items: raw.map(field) };
    },
  }),
  fieldCreate: op({
    description:
      "Add a custom field to a project; SINGLE_SELECT needs `singleSelectOptions`. Replaces `gh project field-create`.",
    input: s.object({
      owner: ownerField,
      number: projectNumberField,
      name: s.string(),
      dataType: s.enum(["TEXT", "SINGLE_SELECT", "DATE", "NUMBER"]),
      singleSelectOptions: s.optional(s.array(s.string())),
    }),
    annotations: writes,
    run: async ({ owner, number, name, dataType, singleSelectOptions }) => {
      const select = dataType === "SINGLE_SELECT";
      if (
        select !==
        (singleSelectOptions !== undefined && singleSelectOptions.length > 0)
      )
        throw new SurfaceError(
          "usage",
          select
            ? "a SINGLE_SELECT field needs singleSelectOptions"
            : "singleSelectOptions only applies to SINGLE_SELECT",
          "pass options exactly when dataType is SINGLE_SELECT",
        );
      const { id } = await resolveProject(gh, owner, number);
      const result = await mutate(
        gh,
        "createProjectV2Field",
        {
          projectId: id,
          dataType,
          name,
          ...(select
            ? {
                singleSelectOptions: (singleSelectOptions ?? []).map((o) => ({
                  name: o,
                  color: "GRAY",
                  description: "",
                })),
              }
            : {}),
        },
        `projectV2Field { ${FIELD} }`,
      );
      return field(at(result, "projectV2Field"));
    },
  }),
  fieldDelete: op({
    description:
      "Delete a custom field and every value set on it; this cannot be undone. Replaces `gh project field-delete`.",
    input: s.object({
      id: s.string({
        description: "Field node id (PVTF_...), from fieldList.",
      }),
    }),
    annotations: irreversible,
    run: async ({ id }) => {
      const result = await mutate(
        gh,
        "deleteProjectV2Field",
        { fieldId: id },
        "projectV2Field { ... on ProjectV2FieldCommon { id name } }",
      );
      return {
        id: str(result, "projectV2Field", "id"),
        name: str(result, "projectV2Field", "name"),
        deleted: true,
      };
    },
  }),
});
