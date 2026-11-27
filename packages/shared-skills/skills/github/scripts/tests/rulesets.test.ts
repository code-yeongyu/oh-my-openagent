import { describe, expect, test } from "bun:test";
import { rulesetOps } from "../src/rulesets.ts";
import { fakeGitHub, json, on } from "./fake.ts";

const kindOf = async (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e: unknown) => String(Reflect.get(Object(e), "kind")),
  );
const query = (url: string | undefined) =>
  Object.fromEntries(new URL(url ?? "http://x").searchParams);

const listed = {
  id: 11760031,
  name: "Protect dev",
  target: "branch",
  source_type: "Repository",
  source: "acme/widgets",
  enforcement: "active",
  updated_at: "2026-07-09T19:11:56.901+09:00",
  _links: { html: { href: "https://github.com/acme/widgets/rules/11760031" } },
};
const full = {
  ...listed,
  conditions: {
    ref_name: { include: ["refs/heads/dev"], exclude: ["refs/heads/x"] },
  },
  rules: [{ type: "deletion" }, { type: "non_fast_forward" }],
  bypass_actors: [
    { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" },
  ],
};

describe("ruleset reads", () => {
  test("list includes parent rulesets by default and trims each one", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /\/repos\/acme\/widgets\/rulesets/, () => json([listed])),
    ]);
    const out = await rulesetOps(gh).list.invoke({});
    expect(query(seen[0]?.url)).toEqual({
      includes_parents: "true",
      per_page: "30",
    });
    expect(out).toEqual({
      repo: "acme/widgets",
      items: [
        {
          id: 11760031,
          name: "Protect dev",
          target: "branch",
          enforcement: "active",
          source: "acme/widgets",
          sourceType: "Repository",
          updatedAt: "2026-07-09T19:11:56.901+09:00",
          url: "https://github.com/acme/widgets/rules/11760031",
        },
      ],
    });
  });

  test("list for an org uses the org endpoint and can exclude parents on a repo", async () => {
    const { gh, seen } = fakeGitHub([on("GET", /\/rulesets/, () => json([]))]);
    const ops = rulesetOps(gh);
    expect(await ops.list.invoke({ org: "acme", limit: 5 })).toEqual({
      org: "acme",
      items: [],
    });
    await ops.list.invoke({ parents: false });
    expect(new URL(seen[0]?.url ?? "").pathname).toBe("/orgs/acme/rulesets");
    expect(query(seen[0]?.url)).toEqual({ per_page: "5" });
    expect(query(seen[1]?.url)).toMatchObject({ includes_parents: "false" });
  });

  test("view returns conditions, bypass actors and rules", async () => {
    const { gh } = fakeGitHub([
      on("GET", /\/repos\/acme\/widgets\/rulesets\/11760031$/, () =>
        json(full),
      ),
    ]);
    const out = await rulesetOps(gh).view.invoke({ id: 11760031 });
    expect(out.conditions).toEqual(full.conditions);
    expect(out.rules).toEqual(full.rules);
    expect(out.bypassActors).toEqual([
      { actorId: 5, actorType: "RepositoryRole", bypassMode: "always" },
    ]);
  });

  test("check resolves the default branch and names each rule's ruleset", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /\/repos\/acme\/widgets$/, () =>
        json({ default_branch: "dev" }),
      ),
      on("GET", /\/rules\/branches\/dev/, () =>
        json([
          {
            type: "required_status_checks",
            parameters: { strict_required_status_checks_policy: false },
            ruleset_source_type: "Repository",
            ruleset_source: "acme/widgets",
            ruleset_id: 17777319,
          },
        ]),
      ),
    ]);
    const out = await rulesetOps(gh).check.invoke({ default: true });
    expect(new URL(seen[1]?.url ?? "").pathname).toBe(
      "/repos/acme/widgets/rules/branches/dev",
    );
    expect(out).toEqual({
      repo: "acme/widgets",
      branch: "dev",
      items: [
        {
          type: "required_status_checks",
          parameters: { strict_required_status_checks_policy: false },
          rulesetId: 17777319,
          rulesetSource: "acme/widgets",
          rulesetSourceType: "Repository",
        },
      ],
    });
  });

  test("check encodes a branch with a slash and needs exactly one of branch/default", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /\/rules\/branches\//, () => json([])),
    ]);
    const ops = rulesetOps(gh);
    await ops.check.invoke({ branch: "feat/x" });
    expect(seen[0]?.url).toContain("/rules/branches/feat%2Fx");
    expect(await kindOf(ops.check.invoke({}))).toBe("usage");
    expect(await kindOf(ops.check.invoke({ branch: "a", default: true }))).toBe(
      "usage",
    );
    expect(seen).toHaveLength(1);
  });
});

describe("ruleset writes", () => {
  test("create builds GitHub's body and passes rules through unchanged", async () => {
    const rules = [
      {
        type: "pull_request",
        parameters: { required_approving_review_count: 1 },
      },
    ];
    const { gh, seen } = fakeGitHub([
      on("POST", /\/orgs\/acme\/rulesets$/, () => json(full, 201)),
    ]);
    const out = await rulesetOps(gh).create.invoke({
      org: "acme",
      name: "Protect dev",
      target: "branch",
      enforcement: "evaluate",
      include: ["~DEFAULT_BRANCH"],
      conditions: { repository_name: { include: ["~ALL"], exclude: [] } },
      bypassActors: [{ actorType: "OrganizationAdmin" }],
      rules,
    });
    expect(seen[0]?.body).toEqual({
      name: "Protect dev",
      target: "branch",
      enforcement: "evaluate",
      conditions: {
        repository_name: { include: ["~ALL"], exclude: [] },
        ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] },
      },
      bypass_actors: [
        {
          actor_id: null,
          actor_type: "OrganizationAdmin",
          bypass_mode: "always",
        },
      ],
      rules,
    });
    expect(out).toMatchObject({ org: "acme", id: 11760031 });
  });

  test("edit of one ref side keeps the other side from the current ruleset", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /\/rulesets\/11760031$/, () => json(full)),
      on("PUT", /\/rulesets\/11760031$/, () => json(full)),
    ]);
    await rulesetOps(gh).edit.invoke({
      id: 11760031,
      include: ["refs/heads/main"],
    });
    expect(seen.map((r) => r.method)).toEqual(["GET", "PUT"]);
    expect(seen[1]?.body).toEqual({
      conditions: {
        ref_name: { include: ["refs/heads/main"], exclude: ["refs/heads/x"] },
      },
    });
  });

  test("edit without condition changes skips the read; with no fields it sends nothing", async () => {
    const { gh, seen } = fakeGitHub([
      on("PUT", /\/rulesets\/7$/, () => json(full)),
    ]);
    const ops = rulesetOps(gh);
    await ops.edit.invoke({ id: 7, enforcement: "disabled" });
    expect(seen.map((r) => [r.method, r.body])).toEqual([
      ["PUT", { enforcement: "disabled" }],
    ]);
    expect(await kindOf(ops.edit.invoke({ id: 7 }))).toBe("usage");
    expect(seen).toHaveLength(1);
  });

  test("delete removes the ruleset by id", async () => {
    const { gh, seen } = fakeGitHub([
      on(
        "DELETE",
        /\/repos\/acme\/widgets\/rulesets\/7$/,
        () => new Response(null, { status: 204 }),
      ),
    ]);
    expect(await rulesetOps(gh).delete.invoke({ id: 7 })).toEqual({
      repo: "acme/widgets",
      id: 7,
      deleted: true,
    });
    expect(seen).toHaveLength(1);
  });
});
