import { describe, expect, test } from "bun:test";
import { issueExtraOps } from "../src/issues-extra.ts";
import { fakeGitHub, json, on } from "./fake.ts";

const kindOf = async (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e: unknown) => String(Reflect.get(Object(e), "kind")),
  );
const query = (body: unknown) => String(Reflect.get(Object(body), "query"));
const vars = (body: unknown) => Reflect.get(Object(body), "variables");
const issue = on("GET", /\/repos\/acme\/widgets\/issues\/7$/, () =>
  json({ node_id: "I_7", number: 7 }),
);

describe("issue delete, lock, pin", () => {
  test("delete resolves the node id and runs deleteIssue", async () => {
    const { gh, seen } = fakeGitHub([
      issue,
      on("POST", /\/graphql$/, () =>
        json({ data: { deleteIssue: { clientMutationId: null } } }),
      ),
    ]);
    const res = await issueExtraOps(gh).delete.invoke({ number: 7 });
    expect(query(seen[1]?.body)).toContain("deleteIssue");
    expect(vars(seen[1]?.body)).toEqual({ id: "I_7" });
    expect(res).toEqual({ repo: "acme/widgets", number: 7, deleted: true });
  });

  test("lock without a reason sends no body", async () => {
    const { gh, seen } = fakeGitHub([
      on(
        "PUT",
        /\/issues\/7\/lock$/,
        () => new Response(null, { status: 204 }),
      ),
    ]);
    const res = await issueExtraOps(gh).lock.invoke({ number: 7 });
    expect(seen[0]?.body).toBeUndefined();
    expect(res.reason).toBeNull();
  });

  test("pin and unpin report the resulting pinned state", async () => {
    const { gh, seen } = fakeGitHub([
      issue,
      on("POST", /\/graphql$/, (req) =>
        query(req.body).includes("unpinIssue")
          ? json({ data: { unpinIssue: { issue: { isPinned: false } } } })
          : json({ data: { pinIssue: { issue: { isPinned: true } } } }),
      ),
    ]);
    const ops = issueExtraOps(gh);
    expect((await ops.pin.invoke({ number: 7 })).pinned).toBe(true);
    expect((await ops.unpin.invoke({ number: 7 })).pinned).toBe(false);
    expect(query(seen[1]?.body)).toContain("pinIssue(input:{issueId:$id})");
    expect(query(seen[3]?.body)).toContain("unpinIssue");
  });
});

describe("issue transfer", () => {
  test("looks up the destination repo id and returns the new location", async () => {
    const { gh, seen } = fakeGitHub([
      issue,
      on("GET", /\/repos\/acme\/other$/, () => json({ node_id: "R_other" })),
      on("POST", /\/graphql$/, () =>
        json({
          data: {
            transferIssue: {
              issue: {
                number: 3,
                url: "https://github.com/acme/other/issues/3",
                repository: { nameWithOwner: "acme/other" },
              },
            },
          },
        }),
      ),
    ]);
    const res = await issueExtraOps(gh).transfer.invoke({
      number: 7,
      destination: "acme/other",
      createLabelsIfMissing: true,
    });
    const mutation = seen.find((s) => s.method === "POST");
    expect(vars(mutation?.body)).toEqual({
      issue: "I_7",
      repo: "R_other",
      labels: true,
    });
    expect(res).toEqual({
      from: "acme/widgets",
      repo: "acme/other",
      number: 3,
      url: "https://github.com/acme/other/issues/3",
    });
  });
});

describe("issue develop", () => {
  const ref = (name: string) => ({
    name,
    target: { oid: "sha1" },
    repository: { nameWithOwner: "acme/widgets" },
  });

  test("list returns the linked branches with urls", async () => {
    const { gh } = fakeGitHub([
      on("POST", /\/graphql$/, () =>
        json({
          data: {
            repository: {
              issue: { linkedBranches: { nodes: [{ ref: ref("7-fix") }] } },
            },
          },
        }),
      ),
    ]);
    const res = await issueExtraOps(gh).develop.invoke({
      number: 7,
      list: true,
    });
    expect(res).toEqual({
      repo: "acme/widgets",
      number: 7,
      items: [
        {
          name: "7-fix",
          repo: "acme/widgets",
          headSha: "sha1",
          url: "https://github.com/acme/widgets/tree/7-fix",
        },
      ],
    });
  });

  test("create starts from the default branch and links the named branch", async () => {
    const { gh, seen } = fakeGitHub([
      on("POST", /\/graphql$/, (req) =>
        query(req.body).includes("createLinkedBranch")
          ? json({
              data: {
                createLinkedBranch: { linkedBranch: { ref: ref("7-fix") } },
              },
            })
          : json({
              data: {
                repository: { issue: { id: "I_7" } },
                target: {
                  id: "R_w",
                  defaultBranchRef: { name: "main", target: { oid: "base1" } },
                },
              },
            }),
      ),
    ]);
    const res = await issueExtraOps(gh).develop.invoke({
      number: 7,
      name: "7-fix",
    });
    expect(vars(seen[0]?.body)).toMatchObject({
      hasBase: false,
      bName: "widgets",
    });
    expect(vars(seen[1]?.body)).toEqual({
      issue: "I_7",
      oid: "base1",
      repo: "R_w",
      name: "7-fix",
    });
    expect(res).toMatchObject({
      base: "main",
      branch: { name: "7-fix", repo: "acme/widgets" },
    });
  });

  test("a missing base branch fails before the mutation", async () => {
    const { gh, seen } = fakeGitHub([
      on("POST", /\/graphql$/, () =>
        json({
          data: {
            repository: { issue: { id: "I_7" } },
            target: { id: "R_w", defaultBranchRef: null, ref: null },
          },
        }),
      ),
    ]);
    expect(
      await kindOf(
        issueExtraOps(gh).develop.invoke({ number: 7, base: "nope" }),
      ),
    ).toBe("not_found");
    expect(vars(seen[0]?.body)).toMatchObject({
      base: "refs/heads/nope",
      hasBase: true,
    });
    expect(seen).toHaveLength(1);
  });

  test("list with create fields is refused without a request", async () => {
    const { gh, seen } = fakeGitHub([]);
    expect(
      await kindOf(
        issueExtraOps(gh).develop.invoke({ number: 7, list: true, name: "x" }),
      ),
    ).toBe("usage");
    expect(seen).toHaveLength(0);
  });
});

describe("issue status", () => {
  test("runs the three @me searches and merges reasons by number", async () => {
    const node = (number: number) => ({
      number,
      title: "t",
      url: "u",
      state: "OPEN",
      updatedAt: "2026-01-01T00:00:00Z",
      author: { login: "octo" },
      labels: { nodes: [{ name: "bug" }] },
    });
    const { gh, seen } = fakeGitHub([
      on("POST", /\/graphql$/, () =>
        json({
          data: {
            viewer: { login: "octo" },
            assigned: { nodes: [node(1)] },
            mentioned: { nodes: [node(2), node(1)] },
            opened: { nodes: [] },
          },
        }),
      ),
    ]);
    const res = await issueExtraOps(gh).status.invoke({ limit: 5 });
    expect(vars(seen[0]?.body)).toEqual({
      limit: 5,
      q0: "repo:acme/widgets is:issue is:open assignee:@me",
      q1: "repo:acme/widgets is:issue is:open mentions:@me",
      q2: "repo:acme/widgets is:issue is:open author:@me",
    });
    expect(res.items.map((i) => [i.number, i.reasons, i.labels])).toEqual([
      [1, ["assigned", "mentioned"], ["bug"]],
      [2, ["mentioned"], ["bug"]],
    ]);
  });
});
