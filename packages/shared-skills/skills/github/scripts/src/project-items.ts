// Project (v2) items: list with field values, add issues/PRs, create drafts, archive and delete.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { irreversible, limitField, reads, writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { itemEditOp } from "./project-item-edit.ts";
import {
  collect,
  itemIdField,
  mutate,
  ownerField,
  pageInfo,
  projectGraphql,
  projectNumberField,
  projectQuery,
  resolveProject,
} from "./project-ref.ts";
import { at, bool, nodes, optNum, optStr, str } from "./read.ts";

const NAME = "field { ... on ProjectV2FieldCommon { name } }";
// Issue.state and PullRequest.state are different enums, so they need distinct response names.
const ITEM = `id type isArchived
  content {
    ... on DraftIssue { id title body }
    ... on Issue { id number title url issueState: state repository { nameWithOwner } }
    ... on PullRequest { id number title url prState: state repository { nameWithOwner } }
  }
  fieldValues(first: 30) { nodes {
    ... on ProjectV2ItemFieldTextValue { text ${NAME} }
    ... on ProjectV2ItemFieldNumberValue { number ${NAME} }
    ... on ProjectV2ItemFieldDateValue { date ${NAME} }
    ... on ProjectV2ItemFieldSingleSelectValue { name optionId ${NAME} }
    ... on ProjectV2ItemFieldIterationValue { title iterationId ${NAME} }
  } }`;

const fieldValue = (v: unknown): string | number | null =>
  optStr(v, "text") ??
  optNum(v, "number") ??
  optStr(v, "date") ??
  optStr(v, "name") ??
  optStr(v, "title");

const item = (x: unknown) => {
  const c = at(x, "content");
  return {
    id: str(x, "id"),
    type: str(x, "type"),
    archived: bool(x, "isArchived"),
    contentId: optStr(c, "id"),
    title: optStr(c, "title"),
    number: optNum(c, "number"),
    state: optStr(c, "issueState") ?? optStr(c, "prState"),
    repo: optStr(c, "repository", "nameWithOwner"),
    url: optStr(c, "url"),
    fields: Object.fromEntries(
      nodes(x, "fieldValues").flatMap((v) => {
        const name = optStr(v, "field", "name");
        const value = fieldValue(v);
        return name === null || value === null ? [] : [[name, value]];
      }),
    ),
  };
};

const itemInput = { owner: ownerField, number: projectNumberField };

export const projectItemOps = (gh: GitHub) => ({
  itemList: op({
    description:
      "Items of a project with their issue/PR/draft content and field values by field name. Replaces `gh project item-list`.",
    input: s.object({
      ...itemInput,
      query: s.optional(
        s.string({
          description:
            'Projects filter syntax, e.g. "assignee:octocat -status:Done".',
        }),
      ),
      limit: limitField(30),
    }),
    annotations: reads,
    run: async ({ owner, number, query, limit }) => {
      let login = owner;
      const raw = await collect(limit ?? 30, async (first, after) => {
        const r = await projectQuery(
          gh,
          owner,
          number,
          `items(first: $first, after: $after, query: $query) { nodes { ${ITEM} } ${pageInfo} }`,
          {
            decl: "$first: Int!, $after: String, $query: String",
            vars: { first, after, query: query ?? null },
          },
        );
        login = r.login;
        return at(r.project, "items");
      });
      return { owner: login, number, items: raw.map(item) };
    },
  }),
  itemAdd: op({
    description:
      "Add an issue or pull request to a project by its URL; adding one already there returns the existing item. Replaces `gh project item-add`.",
    input: s.object({
      ...itemInput,
      url: s.string({ description: "Issue or pull request URL." }),
    }),
    annotations: writes,
    run: async ({ owner, number, url }) => {
      const data = await projectGraphql(
        gh,
        "query($url: URI!) { resource(url: $url) { ... on Issue { id } ... on PullRequest { id } } }",
        { url },
      );
      const contentId = optStr(data, "resource", "id");
      if (contentId === null)
        throw new SurfaceError(
          "not_found",
          `${url} is not an issue or pull request this token can see`,
          "pass the full github.com URL of an issue or pull request",
        );
      const { id } = await resolveProject(gh, owner, number);
      const result = await mutate(
        gh,
        "addProjectV2ItemById",
        { projectId: id, contentId },
        `item { ${ITEM} }`,
      );
      return item(at(result, "item"));
    },
  }),
  itemCreate: op({
    description:
      "Create a draft issue item in a project. Replaces `gh project item-create`.",
    input: s.object({
      ...itemInput,
      title: s.string(),
      body: s.optional(s.string()),
    }),
    annotations: writes,
    run: async ({ owner, number, title, body }) => {
      const { id } = await resolveProject(gh, owner, number);
      const result = await mutate(
        gh,
        "addProjectV2DraftIssue",
        { projectId: id, title, ...(body === undefined ? {} : { body }) },
        `projectItem { ${ITEM} }`,
      );
      return item(at(result, "projectItem"));
    },
  }),
  itemEdit: itemEditOp(gh),
  itemArchive: op({
    description:
      "Archive a project item, or restore it with `undo`. Replaces `gh project item-archive [--undo]`.",
    input: s.object({
      ...itemInput,
      id: itemIdField,
      undo: s.optional(s.boolean({ description: "true to unarchive." })),
    }),
    annotations: writes,
    run: async ({ owner, number, id, undo }) => {
      const p = await resolveProject(gh, owner, number);
      const result = await mutate(
        gh,
        undo === true ? "unarchiveProjectV2Item" : "archiveProjectV2Item",
        { projectId: p.id, itemId: id },
        "item { id isArchived }",
      );
      return {
        id: str(result, "item", "id"),
        archived: bool(result, "item", "isArchived"),
      };
    },
  }),
  itemDelete: op({
    description:
      "Remove an item from a project (a draft issue is destroyed; an issue or PR itself stays). Replaces `gh project item-delete`.",
    input: s.object({ ...itemInput, id: itemIdField }),
    annotations: irreversible,
    run: async ({ owner, number, id }) => {
      const p = await resolveProject(gh, owner, number);
      const result = await mutate(
        gh,
        "deleteProjectV2Item",
        { projectId: p.id, itemId: id },
        "deletedItemId",
      );
      return { id: str(result, "deletedItemId"), deleted: true };
    },
  }),
});
