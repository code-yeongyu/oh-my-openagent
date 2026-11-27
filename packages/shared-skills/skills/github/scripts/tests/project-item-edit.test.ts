import { describe, expect, test } from "bun:test";
import { itemEditOp } from "../src/project-item-edit.ts";
import { at } from "../src/read.ts";
import { fakeGitHub } from "./fake.ts";
import {
  failure,
  gql,
  input,
  isMutation,
  lookup,
  proj,
  query,
  vars,
} from "./project-fake.ts";

describe("project itemEdit", () => {
  test("sets a value by field name", async () => {
    const { gh, seen } = fakeGitHub([
      gql([
        [
          /updateProjectV2ItemFieldValue/,
          { result: { projectV2Item: { id: "PVTI_1" } } },
        ],
        [
          /field\(name/,
          {
            owner: {
              login: "acme",
              projectV2: { ...proj(5), field: { id: "F7" } },
            },
          },
        ],
      ]),
    ]);
    const out = await itemEditOp(gh).invoke({
      owner: "acme",
      number: 5,
      id: "PVTI_1",
      field: "Points",
      numberValue: 5,
    });
    expect(out).toEqual({ id: "PVTI_1", fieldId: "F7", value: { number: 5 } });
    expect(at(vars(seen[0]?.body), "field")).toBe("Points");
    expect(input(seen[1]?.body)).toEqual({
      projectId: "PVT_5",
      itemId: "PVTI_1",
      fieldId: "F7",
      value: { number: 5 },
    });
  });

  test("an unknown field name fails as not_found before any mutation", async () => {
    const { gh, seen } = fakeGitHub([
      gql([
        [
          /field\(name/,
          { owner: { login: "acme", projectV2: { ...proj(5), field: null } } },
        ],
      ]),
    ]);
    const f = await failure(
      itemEditOp(gh).invoke({
        owner: "acme",
        number: 5,
        id: "PVTI_1",
        field: "Nope",
        text: "x",
      }),
    );
    expect(f.kind).toBe("not_found");
    expect(seen.some((r) => isMutation(r.body))).toBe(false);
  });

  test("clears by field id and rewrites a draft's title in the same call", async () => {
    const { gh, seen } = fakeGitHub([
      gql([
        [
          /clearProjectV2ItemFieldValue/,
          { result: { projectV2Item: { id: "PVTI_2" } } },
        ],
        [
          /updateProjectV2DraftIssue/,
          { result: { draftIssue: { id: "DI_1", title: "New", body: "b" } } },
        ],
        [/node\(id/, { node: { content: { id: "DI_1" } } }],
        lookup,
      ]),
    ]);
    const out = await itemEditOp(gh).invoke({
      owner: "acme",
      number: 5,
      id: "PVTI_2",
      fieldId: "F1",
      clear: true,
      title: "New",
    });
    expect(out).toEqual({
      id: "PVTI_2",
      fieldId: "F1",
      value: null,
      title: "New",
      body: "b",
    });
    expect(query(seen[0]?.body)).not.toContain("field(name");
    expect(input(seen[1]?.body)).toEqual({
      projectId: "PVT_5",
      itemId: "PVTI_2",
      fieldId: "F1",
    });
    expect(input(seen[3]?.body)).toEqual({
      draftIssueId: "DI_1",
      title: "New",
    });
  });

  test("refuses bad combinations without a request, and a body on a non-draft item", async () => {
    const { gh, seen } = fakeGitHub([
      gql([[/node\(id/, { node: { content: {} } }]]),
    ]);
    const edit = itemEditOp(gh);
    const base = { owner: "acme", number: 5, id: "PVTI_1" };
    for (const bad of [
      {},
      { text: "x" },
      { fieldId: "F1" },
      { fieldId: "F1", text: "x", clear: true },
      { field: "A", fieldId: "F1", text: "x" },
    ])
      expect((await failure(edit.invoke({ ...base, ...bad }))).kind).toBe(
        "usage",
      );
    expect(seen).toHaveLength(0);
    expect((await failure(edit.invoke({ ...base, body: "b" }))).kind).toBe(
      "usage",
    );
    expect(seen.some((r) => isMutation(r.body))).toBe(false);
  });
});
