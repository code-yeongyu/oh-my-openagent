import { describe, expect, test } from "bun:test";
import { linkOp } from "../src/project-links.ts";
import { fakeGitHub } from "./fake.ts";
import { failure, gql, input, lookup, vars } from "./project-fake.ts";

const routes = () => [
  gql([
    [/unlinkProjectV2FromTeam/, { result: { team: { id: "T_1" } } }],
    [/linkProjectV2ToRepository/, { result: { repository: { id: "R_1" } } }],
    [/repository\(owner/, { repository: { id: "R_1" } }],
    [/team\(slug/, { organization: { team: { id: "T_1", slug: "core" } } }],
    lookup,
  ]),
];

describe("project link/unlink", () => {
  test("link defaults to the origin repo", async () => {
    const { gh, seen } = fakeGitHub(routes());
    expect(
      await linkOp(gh, "link").invoke({ owner: "acme", number: 5 }),
    ).toEqual({
      projectId: "PVT_5",
      repo: "acme/widgets",
      linked: true,
    });
    expect(vars(seen[0]?.body)).toEqual({ owner: "acme", name: "widgets" });
    expect(input(seen[2]?.body)).toEqual({
      projectId: "PVT_5",
      repositoryId: "R_1",
    });
  });

  test("unlink takes a team slug of the owner organization", async () => {
    const { gh, seen } = fakeGitHub(routes());
    expect(
      await linkOp(gh, "unlink").invoke({
        owner: "acme",
        number: 5,
        team: "core",
      }),
    ).toEqual({
      projectId: "PVT_5",
      team: "acme/core",
      linked: false,
    });
    expect(vars(seen[0]?.body)).toEqual({ org: "acme", slug: "core" });
    expect(input(seen[2]?.body)).toEqual({ projectId: "PVT_5", teamId: "T_1" });
  });

  test("repo and team together, or a team under @me, is refused without a request", async () => {
    const { gh, seen } = fakeGitHub(routes());
    const link = linkOp(gh, "link");
    expect(
      (
        await failure(
          link.invoke({ owner: "acme", number: 5, repo: "a/b", team: "core" }),
        )
      ).kind,
    ).toBe("usage");
    expect(
      (await failure(link.invoke({ owner: "@me", number: 5, team: "core" })))
        .kind,
    ).toBe("usage");
    expect(seen).toHaveLength(0);
  });
});
