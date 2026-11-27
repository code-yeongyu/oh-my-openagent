import { describe, expect, test } from "bun:test";
import { projectOps } from "../src/projects.ts";
import { at } from "../src/read.ts";
import { fakeGitHub, json, on } from "./fake.ts";
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

const page = (nodes: unknown[], next: boolean) => ({
  owner: {
    login: "acme",
    projectsV2: {
      nodes,
      pageInfo: { hasNextPage: next, endCursor: next ? "c1" : null },
    },
  },
});

describe("projectOps", () => {
  test("list pages through projectsV2 and drops closed projects unless asked", async () => {
    let calls = 0;
    const { gh, seen } = fakeGitHub([
      on("POST", /\/graphql$/, () =>
        json({
          data:
            calls++ === 0
              ? page([proj(1), proj(2, true)], true)
              : page([proj(3)], false),
        }),
      ),
    ]);
    const out = await projectOps(gh).list.invoke({ owner: "acme", limit: 2 });
    expect(out.owner).toBe("acme");
    expect(out.items.map((p) => p.number)).toEqual([1, 3]);
    expect(vars(seen[0]?.body)).toEqual({
      first: 2,
      after: null,
      login: "acme",
    });
    expect(at(vars(seen[1]?.body), "after")).toBe("c1");
    expect(query(seen[0]?.body)).toContain("repositoryOwner(login: $login)");
  });

  test('"@me" resolves through viewer without a login variable', async () => {
    const { gh, seen } = fakeGitHub([
      gql([[/viewer/, page([proj(9, true)], false)]]),
    ]);
    const out = await projectOps(gh).list.invoke({
      owner: "@me",
      closed: true,
    });
    expect(out).toMatchObject({
      owner: "acme",
      items: [{ number: 9, closed: true }],
    });
    expect(vars(seen[0]?.body)).toEqual({ first: 30, after: null });
  });

  test("view returns readme and counts", async () => {
    const { gh, seen } = fakeGitHub([
      gql([
        [
          /readme/,
          {
            owner: {
              login: "acme",
              projectV2: {
                ...proj(5),
                readme: "# hi",
                items: { totalCount: 4 },
                fields: { totalCount: 11 },
              },
            },
          },
        ],
      ]),
    ]);
    const out = await projectOps(gh).view.invoke({ owner: "acme", number: 5 });
    expect(out).toMatchObject({
      owner: "acme",
      id: "PVT_5",
      readme: "# hi",
      itemCount: 4,
      fieldCount: 11,
    });
    expect(vars(seen[0]?.body)).toEqual({ number: 5, login: "acme" });
  });

  test("a missing project fails as not_found, and a missing scope names the project scope", async () => {
    const nf = fakeGitHub([
      gql([[/projectV2/, { owner: { login: "acme", projectV2: null } }]]),
    ]);
    expect(
      (
        await failure(
          projectOps(nf.gh).view.invoke({ owner: "acme", number: 1 }),
        )
      ).kind,
    ).toBe("not_found");
    const scope = fakeGitHub([
      on("POST", /\/graphql$/, () =>
        json({
          errors: [
            {
              type: "INSUFFICIENT_SCOPES",
              message:
                "Your token has not been granted the required scopes to execute this query.",
            },
          ],
        }),
      ),
    ]);
    const f = await failure(
      projectOps(scope.gh).view.invoke({ owner: "acme", number: 1 }),
    );
    expect(f.kind).toBe("forbidden");
    expect(f.hint).toContain("gh auth refresh -s project");
  });

  test("create resolves the owner id, then creates", async () => {
    const { gh, seen } = fakeGitHub([
      gql([
        [/createProjectV2/, { result: { projectV2: proj(7) } }],
        [/owner: repositoryOwner/, { owner: { id: "O_1", login: "acme" } }],
      ]),
    ]);
    const out = await projectOps(gh).create.invoke({
      owner: "acme",
      title: "Roadmap 7",
    });
    expect(out).toMatchObject({ owner: "acme", number: 7 });
    expect(input(seen[1]?.body)).toEqual({
      ownerId: "O_1",
      title: "Roadmap 7",
    });
  });

  test("delete needs the exact title and sends no mutation otherwise", async () => {
    const { gh, seen } = fakeGitHub([
      gql([
        [/deleteProjectV2\(/, { result: { projectV2: { id: "PVT_5" } } }],
        lookup,
      ]),
    ]);
    const ops = projectOps(gh);
    expect(
      (
        await failure(
          ops.delete.invoke({ owner: "acme", number: 5, confirm: "roadmap 5" }),
        )
      ).kind,
    ).toBe("usage");
    expect(seen.some((r) => isMutation(r.body))).toBe(false);
    expect(
      await ops.delete.invoke({
        owner: "acme",
        number: 5,
        confirm: "Roadmap 5",
      }),
    ).toEqual({
      id: "PVT_5",
      title: "Roadmap 5",
      deleted: true,
    });
    expect(input(seen.at(-1)?.body)).toEqual({ projectId: "PVT_5" });
  });

  test("copy sends source project, target owner, title and drafts", async () => {
    const { gh, seen } = fakeGitHub([
      gql([
        [/copyProjectV2/, { result: { projectV2: proj(8) } }],
        lookup,
        [/owner: repositoryOwner/, { owner: { id: "O_2", login: "other" } }],
      ]),
    ]);
    const out = await projectOps(gh).copy.invoke({
      owner: "acme",
      number: 5,
      targetOwner: "other",
      title: "Copy",
      drafts: true,
    });
    expect(out).toMatchObject({ owner: "other", number: 8 });
    expect(at(vars(seen[1]?.body), "login")).toBe("other");
    expect(input(seen[2]?.body)).toEqual({
      projectId: "PVT_5",
      ownerId: "O_2",
      title: "Copy",
      includeDraftIssues: true,
    });
  });
});
