import { describe, expect, test } from "bun:test";
import { projectStateOps } from "../src/project-state.ts";
import { at } from "../src/read.ts";
import { fakeGitHub } from "./fake.ts";
import { failure, gql, input, lookup, proj, query } from "./project-fake.ts";

describe("projectStateOps", () => {
  test("edit maps description and visibility, and refuses an empty edit without a request", async () => {
    const { gh, seen } = fakeGitHub([
      gql([[/updateProjectV2\(/, { result: { projectV2: proj(5) } }], lookup]),
    ]);
    const ops = projectStateOps(gh);
    await ops.edit.invoke({
      owner: "acme",
      number: 5,
      description: "d",
      visibility: "PRIVATE",
    });
    expect(input(seen[1]?.body)).toEqual({
      projectId: "PVT_5",
      shortDescription: "d",
      public: false,
    });
    expect(
      (await failure(ops.edit.invoke({ owner: "acme", number: 5 }))).kind,
    ).toBe("usage");
    expect(seen).toHaveLength(2);
  });

  test("close sets closed, undo reopens", async () => {
    const { gh, seen } = fakeGitHub([
      gql([
        [/updateProjectV2\(/, { result: { projectV2: proj(5, true) } }],
        lookup,
      ]),
    ]);
    const ops = projectStateOps(gh);
    expect((await ops.close.invoke({ owner: "acme", number: 5 })).closed).toBe(
      true,
    );
    await ops.close.invoke({ owner: "acme", number: 5, undo: true });
    expect(at(input(seen[1]?.body), "closed")).toBe(true);
    expect(at(input(seen[3]?.body), "closed")).toBe(false);
  });

  test("markTemplate marks, undo unmarks", async () => {
    const { gh, seen } = fakeGitHub([
      gql([
        [/unmarkProjectV2AsTemplate/, { result: { projectV2: proj(5) } }],
        [
          /markProjectV2AsTemplate/,
          { result: { projectV2: { ...proj(5), template: true } } },
        ],
        lookup,
      ]),
    ]);
    const ops = projectStateOps(gh);
    expect(
      (await ops.markTemplate.invoke({ owner: "acme", number: 5 })).template,
    ).toBe(true);
    expect(
      (await ops.markTemplate.invoke({ owner: "acme", number: 5, undo: true }))
        .template,
    ).toBe(false);
    expect(query(seen[3]?.body)).toContain(
      "unmarkProjectV2AsTemplate(input: $input)",
    );
    expect(input(seen[3]?.body)).toEqual({ projectId: "PVT_5" });
  });
});
