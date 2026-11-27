// Editing one project item: set or clear one field value, and retitle or rewrite a draft issue.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import {
  itemIdField,
  missing,
  mutate,
  ownerField,
  projectGraphql,
  projectNumberField,
  projectQuery,
} from "./project-ref.ts";
import { at, optStr, str } from "./read.ts";

const usage = (message: string, hint: string) =>
  new SurfaceError("usage", message, hint);

const resolveField = async (
  gh: GitHub,
  owner: string,
  number: number,
  name: string | undefined,
) => {
  const { project } = await projectQuery(
    gh,
    owner,
    number,
    name === undefined
      ? ""
      : "field(name: $field) { ... on ProjectV2FieldCommon { id } }",
    name === undefined
      ? {}
      : { decl: "$field: String!", vars: { field: name } },
  );
  return {
    projectId: str(project, "id"),
    fieldId: optStr(project, "field", "id"),
  };
};

const draftIssueId = async (gh: GitHub, itemId: string) => {
  const data = await projectGraphql(
    gh,
    "query($id: ID!) { node(id: $id) { ... on ProjectV2Item { content { ... on DraftIssue { id } } } } }",
    { id: itemId },
  );
  const id = optStr(data, "node", "content", "id");
  if (id === null)
    throw usage(
      `item ${itemId} is not a draft issue`,
      "title and body only apply to draft issue items; edit an issue or PR with issue.edit / pr.edit",
    );
  return id;
};

export const itemEditOp = (gh: GitHub) =>
  op({
    description:
      "Set one field value on a project item (by field name or id), clear it, or change a draft issue's title/body. Replaces `gh project item-edit`.",
    input: s.object({
      owner: ownerField,
      number: projectNumberField,
      id: itemIdField,
      field: s.optional(s.string({ description: "Field name to update." })),
      fieldId: s.optional(s.string({ description: "Field id (PVTF_...)." })),
      text: s.optional(s.string()),
      numberValue: s.optional(
        s.number({ description: "Value for a NUMBER field." }),
      ),
      date: s.optional(s.string({ description: "YYYY-MM-DD." })),
      singleSelectOptionId: s.optional(s.string()),
      iterationId: s.optional(s.string()),
      clear: s.optional(s.boolean({ description: "Remove the field value." })),
      title: s.optional(s.string({ description: "Draft issue title." })),
      body: s.optional(s.string({ description: "Draft issue body." })),
    }),
    annotations: writes,
    run: async (input) => {
      const { owner, number, id, field, fieldId, clear, title, body } = input;
      const value = Object.fromEntries(
        Object.entries({
          text: input.text,
          number: input.numberValue,
          date: input.date,
          singleSelectOptionId: input.singleSelectOptionId,
          iterationId: input.iterationId,
        }).filter(([, v]) => v !== undefined),
      );
      const changes = Object.keys(value).length + (clear === true ? 1 : 0);
      const named = field !== undefined || fieldId !== undefined;
      const draft = title !== undefined || body !== undefined;
      if (field !== undefined && fieldId !== undefined)
        throw usage("pass field or fieldId, not both", "name the field once");
      if (changes > 1)
        throw usage("one field value per call", "pass a single value or clear");
      if (named !== (changes === 1))
        throw usage(
          named
            ? "a field needs a value or clear"
            : "a value needs field or fieldId",
          "pass field (or fieldId) together with one value or clear",
        );
      if (!named && !draft)
        throw usage(
          "nothing to change",
          "pass a field value, clear, title or body",
        );

      const result: Record<string, unknown> = { id };
      if (named) {
        const ref = await resolveField(gh, owner, number, field);
        const target = fieldId ?? ref.fieldId;
        if (target === null) throw missing(`field "${field ?? ""}"`);
        const keys = { projectId: ref.projectId, itemId: id, fieldId: target };
        await (clear === true
          ? mutate(
              gh,
              "clearProjectV2ItemFieldValue",
              keys,
              "projectV2Item { id }",
            )
          : mutate(
              gh,
              "updateProjectV2ItemFieldValue",
              { ...keys, value },
              "projectV2Item { id }",
            ));
        Object.assign(result, {
          fieldId: target,
          value: clear === true ? null : value,
        });
      }
      if (draft) {
        const draftId = await draftIssueId(gh, id);
        const d = await mutate(
          gh,
          "updateProjectV2DraftIssue",
          {
            draftIssueId: draftId,
            ...(title === undefined ? {} : { title }),
            ...(body === undefined ? {} : { body }),
          },
          "draftIssue { id title body }",
        );
        Object.assign(result, {
          title: str(d, "draftIssue", "title"),
          body: optStr(at(d, "draftIssue"), "body"),
        });
      }
      return result;
    },
  });
