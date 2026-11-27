import { describe, expect, test } from "bun:test";
import { projectItemOps } from "../src/project-items.ts";
import { fakeGitHub } from "./fake.ts";
import {
  failure,
  gql,
  input,
  lookup,
  proj,
  query,
  vars,
} from "./project-fake.ts";

const issueItem = {
  id: "PVTI_1",
  type: "ISSUE",
  isArchived: false,
  content: {
    id: "I_1",
    number: 42,
    title: "Bug",
    url: "https://github.com/acme/widgets/issues/42",
    issueState: "OPEN",
    repository: { nameWithOwner: "acme/widgets" },
  },
  fieldValues: {
    nodes: [
      { text: "note", field: { name: "Notes" } },
      { number: 3, field: { name: "Points" } },
      { name: "Todo", optionId: "o1", field: { name: "Status" } },
      {},
    ],
  },
};

describe("projectItemOps", () => {
  test("itemList flattens content and field values and passes the filter", async () => {
    const items = {
      nodes: [issueItem],
      pageInfo: { hasNextPage: false, endCursor: null },
    };
    const { gh, seen } = fakeGitHub([
      gql([
        [
          /items\(first/,
          { owner: { login: "acme", projectV2: { ...proj(5), items } } },
        ],
      ]),
    ]);
    const out = await projectItemOps(gh).itemList.invoke({
      owner: "acme",
      number: 5,
      query: "-status:Done",
    });
    expect(out).toEqual({
      owner: "acme",
      number: 5,
      items: [
        {
          id: "PVTI_1",
          type: "ISSUE",
          archived: false,
          contentId: "I_1",
          title: "Bug",
          number: 42,
          state: "OPEN",
          repo: "acme/widgets",
          url: "https://github.com/acme/widgets/issues/42",
          fields: { Notes: "note", Points: 3, Status: "Todo" },
        },
      ],
    });
    expect(vars(seen[0]?.body)).toEqual({
      number: 5,
      login: "acme",
      first: 30,
      after: null,
      query: "-status:Done",
    });
  });

  test("itemAdd resolves the URL to a content id, and a non-issue URL sends no mutation", async () => {
    const url = "https://github.com/acme/widgets/issues/42";
    const { gh, seen } = fakeGitHub([
      gql([
        [/addProjectV2ItemById/, { result: { item: issueItem } }],
        [/resource\(url/, { resource: { id: "I_1" } }],
        lookup,
      ]),
    ]);
    expect(
      (
        await projectItemOps(gh).itemAdd.invoke({
          owner: "acme",
          number: 5,
          url,
        })
      ).id,
    ).toBe("PVTI_1");
    expect(vars(seen[0]?.body)).toEqual({ url });
    expect(input(seen[2]?.body)).toEqual({
      projectId: "PVT_5",
      contentId: "I_1",
    });

    const repo = fakeGitHub([gql([[/resource\(url/, { resource: {} }]])]);
    const add = projectItemOps(repo.gh).itemAdd;
    expect(
      (
        await failure(
          add.invoke({
            owner: "acme",
            number: 5,
            url: "https://github.com/acme/widgets",
          }),
        )
      ).kind,
    ).toBe("not_found");
    expect(repo.seen).toHaveLength(1);
  });

  test("itemCreate adds a draft issue with an optional body", async () => {
    const draft = {
      id: "PVTI_2",
      type: "DRAFT_ISSUE",
      isArchived: false,
      content: { id: "DI_1", title: "Idea", body: "" },
      fieldValues: { nodes: [] },
    };
    const { gh, seen } = fakeGitHub([
      gql([
        [/addProjectV2DraftIssue/, { result: { projectItem: draft } }],
        lookup,
      ]),
    ]);
    const out = await projectItemOps(gh).itemCreate.invoke({
      owner: "acme",
      number: 5,
      title: "Idea",
    });
    expect(out).toMatchObject({
      id: "PVTI_2",
      type: "DRAFT_ISSUE",
      contentId: "DI_1",
      title: "Idea",
    });
    expect(input(seen[1]?.body)).toEqual({ projectId: "PVT_5", title: "Idea" });
  });

  test("itemArchive archives and unarchives; itemDelete returns the deleted id", async () => {
    const { gh, seen } = fakeGitHub([
      gql([
        [
          /unarchiveProjectV2Item/,
          { result: { item: { id: "PVTI_1", isArchived: false } } },
        ],
        [
          /archiveProjectV2Item/,
          { result: { item: { id: "PVTI_1", isArchived: true } } },
        ],
        [/deleteProjectV2Item/, { result: { deletedItemId: "PVTI_1" } }],
        lookup,
      ]),
    ]);
    const ops = projectItemOps(gh);
    const ref = { owner: "acme", number: 5, id: "PVTI_1" };
    expect(await ops.itemArchive.invoke(ref)).toEqual({
      id: "PVTI_1",
      archived: true,
    });
    expect(await ops.itemArchive.invoke({ ...ref, undo: true })).toEqual({
      id: "PVTI_1",
      archived: false,
    });
    expect(query(seen[3]?.body)).toContain(
      "unarchiveProjectV2Item(input: $input)",
    );
    expect(await ops.itemDelete.invoke(ref)).toEqual({
      id: "PVTI_1",
      deleted: true,
    });
    expect(input(seen[5]?.body)).toEqual({
      projectId: "PVT_5",
      itemId: "PVTI_1",
    });
  });
});
