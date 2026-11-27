import { describe, expect, test } from "bun:test";
import { projectFieldOps } from "../src/project-fields.ts";
import { at } from "../src/read.ts";
import { fakeGitHub, json, on } from "./fake.ts";
import { failure, gql, input, lookup } from "./project-fake.ts";

describe("projectFieldOps", () => {
  test("fieldList returns options and iterations and pages with the cursor", async () => {
    let calls = 0;
    const page = (nodes: unknown[], next: boolean) => ({
      data: {
        owner: {
          login: "acme",
          projectV2: {
            id: "PVT_5",
            title: "Roadmap",
            fields: {
              nodes,
              pageInfo: { hasNextPage: next, endCursor: next ? "f1" : null },
            },
          },
        },
      },
    });
    const { gh, seen } = fakeGitHub([
      on("POST", /\/graphql$/, () =>
        json(
          calls++ === 0
            ? page(
                [
                  { id: "F1", name: "Title", dataType: "TITLE" },
                  {
                    id: "F2",
                    name: "Status",
                    dataType: "SINGLE_SELECT",
                    options: [{ id: "o1", name: "Todo" }],
                  },
                ],
                true,
              )
            : page(
                [
                  {
                    id: "F3",
                    name: "Sprint",
                    dataType: "ITERATION",
                    configuration: {
                      iterations: [
                        {
                          id: "i1",
                          title: "S1",
                          startDate: "2026-11-01",
                          duration: 14,
                        },
                      ],
                    },
                  },
                ],
                false,
              ),
        ),
      ),
    ]);
    const out = await projectFieldOps(gh).fieldList.invoke({
      owner: "acme",
      number: 5,
      limit: 5,
    });
    expect(out).toEqual({
      owner: "acme",
      number: 5,
      items: [
        { id: "F1", name: "Title", dataType: "TITLE" },
        {
          id: "F2",
          name: "Status",
          dataType: "SINGLE_SELECT",
          options: [{ id: "o1", name: "Todo" }],
        },
        {
          id: "F3",
          name: "Sprint",
          dataType: "ITERATION",
          iterations: [
            { id: "i1", title: "S1", startDate: "2026-11-01", duration: 14 },
          ],
        },
      ],
    });
    expect(at(seen[0]?.body, "variables")).toEqual({
      number: 5,
      login: "acme",
      first: 5,
      after: null,
    });
    expect(at(seen[1]?.body, "variables", "after")).toBe("f1");
  });

  test("fieldCreate sends single-select options with gh's defaults", async () => {
    const { gh, seen } = fakeGitHub([
      gql([
        [
          /createProjectV2Field/,
          {
            result: {
              projectV2Field: {
                id: "F9",
                name: "Status",
                dataType: "SINGLE_SELECT",
                options: [
                  { id: "a", name: "Todo" },
                  { id: "b", name: "Done" },
                ],
              },
            },
          },
        ],
        lookup,
      ]),
    ]);
    const out = await projectFieldOps(gh).fieldCreate.invoke({
      owner: "acme",
      number: 5,
      name: "Status",
      dataType: "SINGLE_SELECT",
      singleSelectOptions: ["Todo", "Done"],
    });
    expect(out.id).toBe("F9");
    expect(input(seen[1]?.body)).toEqual({
      projectId: "PVT_5",
      dataType: "SINGLE_SELECT",
      name: "Status",
      singleSelectOptions: [
        { name: "Todo", color: "GRAY", description: "" },
        { name: "Done", color: "GRAY", description: "" },
      ],
    });
  });

  test("fieldCreate refuses options on a non-select field and a select without options, sending nothing", async () => {
    const { gh, seen } = fakeGitHub([]);
    const create = projectFieldOps(gh).fieldCreate;
    const base = { owner: "acme", number: 5, name: "F" };
    for (const bad of [
      { dataType: "NUMBER", singleSelectOptions: ["x"] },
      { dataType: "SINGLE_SELECT" },
      { dataType: "SINGLE_SELECT", singleSelectOptions: [] },
    ])
      expect((await failure(create.invoke({ ...base, ...bad }))).kind).toBe(
        "usage",
      );
    expect(seen).toHaveLength(0);
  });

  test("fieldDelete deletes by field id", async () => {
    const { gh, seen } = fakeGitHub([
      gql([
        [
          /deleteProjectV2Field/,
          { result: { projectV2Field: { id: "F2", name: "Status" } } },
        ],
      ]),
    ]);
    expect(await projectFieldOps(gh).fieldDelete.invoke({ id: "F2" })).toEqual({
      id: "F2",
      name: "Status",
      deleted: true,
    });
    expect(input(seen[0]?.body)).toEqual({ fieldId: "F2" });
  });
});
