import { describe, expect, test } from "bun:test";
import { createClient } from "../sdk.ts";
import { fakeDeps, json, on } from "./fake.ts";

type Ctx = { name: string; bucket: "pass" | "fail" | "pending" };

const rollup = (head: string, checks: readonly Ctx[]) =>
  json({
    data: {
      repository: {
        pullRequest: {
          headRefOid: head,
          commits: {
            nodes: [
              {
                commit: {
                  statusCheckRollup: {
                    state: "PENDING",
                    contexts: {
                      pageInfo: { hasNextPage: false, endCursor: null },
                      nodes: checks.map((c) => ({
                        __typename: "CheckRun",
                        name: c.name,
                        status:
                          c.bucket === "pending" ? "IN_PROGRESS" : "COMPLETED",
                        conclusion:
                          c.bucket === "pending"
                            ? null
                            : c.bucket === "pass"
                              ? "SUCCESS"
                              : "FAILURE",
                        isRequired: true,
                      })),
                    },
                  },
                },
              },
            ],
          },
        },
      },
    },
  });

const clocked = (polls: readonly (() => Response)[]) => {
  let clock = 0;
  let i = 0;
  const fake = fakeDeps([
    on(
      "POST",
      /\/graphql/,
      () =>
        (polls[Math.min(i++, polls.length - 1)] ?? polls[0])?.() ?? json({}),
    ),
  ]);
  const client = createClient({
    ...fake.deps,
    now: () => clock,
    sleep: (ms) => {
      clock += ms;
      fake.slept.push(ms);
      return Promise.resolve();
    },
  });
  return { client, slept: fake.slept };
};

describe("waiting", () => {
  test("pr.wait polls until pending checks pass", async () => {
    const { client, slept } = clocked([
      () => rollup("h1", [{ name: "test", bucket: "pending" }]),
      () => rollup("h1", [{ name: "test", bucket: "pending" }]),
      () => rollup("h1", [{ name: "test", bucket: "pass" }]),
    ]);
    const res = await client.pr.wait({
      repo: "acme/widgets",
      number: 1,
      intervalSeconds: 30,
    });
    expect(res.verdict).toBe("pass");
    expect(res.polls).toBe(3);
    expect(slept).toEqual([30_000, 30_000]);
  });

  test("pr.wait fails fast on the first failure while others are still pending", async () => {
    const { client } = clocked([
      () =>
        rollup("h1", [
          { name: "lint", bucket: "fail" },
          { name: "e2e", bucket: "pending" },
        ]),
    ]);
    const res = await client.pr.wait({ repo: "acme/widgets", number: 1 });
    expect(res.verdict).toBe("fail");
    expect(res.failing.map((c) => c.name)).toEqual(["lint"]);
    expect(res.pending).toEqual(["e2e"]);
  });

  test("pr.wait rides out a just-pushed head that the PR does not show yet", async () => {
    const { client } = clocked([
      () => rollup("old", [{ name: "test", bucket: "pass" }]),
      () => rollup("h1", [{ name: "test", bucket: "pass" }]),
    ]);
    const res = await client.pr.wait({
      repo: "acme/widgets",
      number: 1,
      headSha: "h1",
    });
    expect(res.verdict).toBe("pass");
    expect(res.headSha).toBe("h1");
  });

  test("pr.wait reports head_moved when the head still differs after the grace period", async () => {
    const { client } = clocked([
      () => rollup("h2", [{ name: "test", bucket: "pending" }]),
    ]);
    const res = await client.pr.wait({
      repo: "acme/widgets",
      number: 1,
      headSha: "h1",
      graceSeconds: 60,
      intervalSeconds: 30,
    });
    expect(res.verdict).toBe("head_moved");
    expect(res.polls).toBe(3);
  });

  test("pr.wait times out on the clock and no_checks after the grace period", async () => {
    const pending = clocked([
      () => rollup("h1", [{ name: "test", bucket: "pending" }]),
    ]);
    const t = await pending.client.pr.wait({
      repo: "acme/widgets",
      number: 1,
      timeoutMinutes: 2,
      intervalSeconds: 60,
    });
    expect(t.verdict).toBe("timeout");
    expect(t.pending).toEqual(["test"]);

    const empty = clocked([() => rollup("h1", [])]);
    expect(
      (
        await empty.client.pr.wait({
          repo: "acme/widgets",
          number: 1,
          graceSeconds: 60,
          intervalSeconds: 30,
        })
      ).verdict,
    ).toBe("no_checks");
  });

  test("run.wait returns the conclusion and the failed jobs once the run completes", async () => {
    let calls = 0;
    const run = (status: string, conclusion: string | null) => ({
      id: 9,
      name: "CI",
      status,
      conclusion,
      event: "push",
      head_sha: "s",
      created_at: "t",
      html_url: "u",
    });
    const fake = fakeDeps([
      on("GET", /\/actions\/runs\/9$/, () =>
        json(
          ++calls < 2 ? run("in_progress", null) : run("completed", "failure"),
        ),
      ),
      on("GET", /\/runs\/9\/jobs/, () =>
        json({
          jobs: [
            {
              id: 1,
              name: "test",
              status: "completed",
              conclusion: "failure",
              steps: [{ name: "bun test", conclusion: "failure" }],
            },
          ],
        }),
      ),
    ]);
    const res = await createClient(fake.deps).run.wait({
      repo: "acme/widgets",
      runId: 9,
    });
    expect(res.verdict).toBe("fail");
    expect(res.failedJobs).toEqual([
      { id: 1, name: "test", conclusion: "failure", failedSteps: ["bun test"] },
    ]);
    expect(fake.slept).toEqual([30_000]);
  });
});
