import { describe, expect, test } from "bun:test";
import { pullExtraOps } from "../src/pulls-extra.ts";
import { pullReviewOps } from "../src/pulls-review.ts";
import { fakeGitHub, json, on } from "./fake.ts";

const kindOf = async (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e: unknown) => String(Reflect.get(Object(e), "kind")),
  );
const query = (body: unknown) => String(Reflect.get(Object(body), "query"));
const vars = (body: unknown) => Reflect.get(Object(body), "variables");
const pull = on("GET", /\/repos\/acme\/widgets\/pulls\/5$/, () =>
  json({ node_id: "PR_5", head: { ref: "feat", repo: null } }),
);

describe("pr review", () => {
  test("approve needs no body and sends the upper-case event", async () => {
    const { gh, seen } = fakeGitHub([
      on("POST", /\/pulls\/5\/reviews$/, () =>
        json({ id: 9, state: "APPROVED", html_url: "u" }),
      ),
    ]);
    const res = await pullReviewOps(gh).review.invoke({
      number: 5,
      event: "approve",
    });
    expect(seen[0]?.body).toEqual({ event: "APPROVE" });
    expect(res).toEqual({
      repo: "acme/widgets",
      number: 5,
      id: 9,
      state: "APPROVED",
      url: "u",
    });
  });

  test("request_changes without a body is refused before any request", async () => {
    const { gh, seen } = fakeGitHub([]);
    const ops = pullReviewOps(gh);
    expect(
      await kindOf(
        ops.review.invoke({ number: 5, event: "request_changes", body: "" }),
      ),
    ).toBe("usage");
    expect(seen).toHaveLength(0);
  });
});

describe("pr lock", () => {
  test("lock maps the reason to the REST spelling on the issues endpoint; unlock deletes it", async () => {
    const { gh, seen } = fakeGitHub([
      on(
        "PUT",
        /\/issues\/5\/lock$/,
        () => new Response(null, { status: 204 }),
      ),
      on(
        "DELETE",
        /\/issues\/5\/lock$/,
        () => new Response(null, { status: 204 }),
      ),
    ]);
    const ops = pullExtraOps(gh);
    expect(await ops.lock.invoke({ number: 5, reason: "too_heated" })).toEqual({
      repo: "acme/widgets",
      number: 5,
      locked: true,
      reason: "too_heated",
    });
    expect(seen[0]?.body).toEqual({ lock_reason: "too heated" });
    expect((await ops.unlock.invoke({ number: 5 })).locked).toBe(false);
    expect(seen[1]?.method).toBe("DELETE");
  });
});

describe("pr updateBranch and revert", () => {
  test("rebase with an expected head sends REBASE and the pinned sha", async () => {
    const { gh, seen } = fakeGitHub([
      pull,
      on("POST", /\/graphql$/, () =>
        json({
          data: { updatePullRequestBranch: { pullRequest: { number: 5 } } },
        }),
      ),
    ]);
    const res = await pullExtraOps(gh).updateBranch.invoke({
      number: 5,
      rebase: true,
      expectedHeadSha: "abc",
    });
    expect(query(seen[1]?.body)).toContain("updatePullRequestBranch");
    expect(vars(seen[1]?.body)).toEqual({
      id: "PR_5",
      method: "REBASE",
      sha: "abc",
    });
    expect(res.method).toBe("rebase");
  });

  test("the default method is a merge with no sha pinned", async () => {
    const { gh, seen } = fakeGitHub([
      pull,
      on("POST", /\/graphql$/, () =>
        json({
          data: { updatePullRequestBranch: { pullRequest: { number: 5 } } },
        }),
      ),
    ]);
    await pullExtraOps(gh).updateBranch.invoke({ number: 5 });
    expect(vars(seen[1]?.body)).toEqual({ id: "PR_5", method: "MERGE" });
  });

  test("a head that moved refuses the update as conflict", async () => {
    const { gh } = fakeGitHub([
      pull,
      on("POST", /\/graphql$/, () =>
        json({
          errors: [{ message: "head sha didn't match the current head ref." }],
        }),
      ),
    ]);
    expect(
      await kindOf(
        pullExtraOps(gh).updateBranch.invoke({
          number: 5,
          expectedHeadSha: "x",
        }),
      ),
    ).toBe("conflict");
  });

  test("revert sends only the given fields and returns the new PR", async () => {
    const { gh, seen } = fakeGitHub([
      pull,
      on("POST", /\/graphql$/, () =>
        json({
          data: {
            revertPullRequest: {
              revertPullRequest: { number: 6, url: "https://x/6" },
            },
          },
        }),
      ),
    ]);
    const res = await pullExtraOps(gh).revert.invoke({
      number: 5,
      draft: true,
    });
    expect(query(seen[1]?.body)).toContain("revertPullRequest");
    expect(vars(seen[1]?.body)).toEqual({ id: "PR_5", draft: true });
    expect(res).toEqual({
      repo: "acme/widgets",
      reverted: 5,
      number: 6,
      url: "https://x/6",
    });
  });
});

describe("pr status", () => {
  const node = (number: number) => ({
    number,
    title: `t${number}`,
    url: `u${number}`,
    state: "OPEN",
    isDraft: false,
    headRefName: "feat",
    author: { login: "octo" },
    updatedAt: "2026-01-01T00:00:00Z",
    reviewDecision: "APPROVED",
    mergeable: "CONFLICTING",
    mergeStateStatus: "DIRTY",
    commits: {
      nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }],
    },
  });

  test("merges the branch PR with the @me searches and reports each match reason", async () => {
    const { gh, seen } = fakeGitHub([
      on("POST", /\/graphql$/, () =>
        json({
          data: {
            viewer: { login: "octo" },
            created: { nodes: [node(1), {}] },
            reviewRequested: { nodes: [node(2)] },
            branch: { pullRequests: { nodes: [node(1)] } },
          },
        }),
      ),
    ]);
    const res = await pullExtraOps(gh).status.invoke({
      branch: "feat",
      conflicts: true,
    });
    const v = vars(seen[0]?.body);
    expect(v).toMatchObject({
      q0: "repo:acme/widgets is:pr is:open author:@me",
      q1: "repo:acme/widgets is:pr is:open review-requested:@me",
      branch: "feat",
      hasBranch: true,
      conflicts: true,
      limit: 30,
    });
    expect(res.user).toBe("octo");
    expect(res.items.map((i) => [i.number, i.reasons])).toEqual([
      [1, ["branch", "created"]],
      [2, ["reviewRequested"]],
    ]);
    expect(res.items[0]).toMatchObject({
      checks: "SUCCESS",
      mergeable: "CONFLICTING",
      mergeState: "DIRTY",
    });
  });

  test("without conflicts the mergeability fields are left out", async () => {
    const { gh, seen } = fakeGitHub([
      on("POST", /\/graphql$/, () =>
        json({
          data: {
            viewer: { login: "octo" },
            created: { nodes: [node(1)] },
            reviewRequested: { nodes: [] },
          },
        }),
      ),
    ]);
    const res = await pullExtraOps(gh).status.invoke({});
    expect(vars(seen[0]?.body)).toMatchObject({
      hasBranch: false,
      conflicts: false,
    });
    expect(res.items[0]).not.toHaveProperty("mergeable");
  });
});
