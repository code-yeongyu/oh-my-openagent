import { describe, expect, test } from "bun:test";
import { mcpHandler } from "../vendor/surface/index.ts";
import { createClient, surface } from "../sdk.ts";
import { fakeDeps, json, on, TOKEN } from "./fake.ts";

const rollup = {
  data: {
    repository: {
      pullRequest: {
        headRefOid: "abc123",
        commits: {
          nodes: [
            {
              commit: {
                statusCheckRollup: {
                  state: "FAILURE",
                  contexts: {
                    pageInfo: { hasNextPage: false, endCursor: null },
                    nodes: [
                      {
                        __typename: "CheckRun",
                        name: "test",
                        status: "COMPLETED",
                        conclusion: "FAILURE",
                        isRequired: true,
                        detailsUrl: "d",
                        checkSuite: {
                          workflowRun: {
                            databaseId: 77,
                            workflow: { name: "CI" },
                          },
                        },
                      },
                      {
                        __typename: "CheckRun",
                        name: "lint",
                        status: "COMPLETED",
                        conclusion: "SUCCESS",
                        isRequired: false,
                      },
                      {
                        __typename: "CheckRun",
                        name: "e2e",
                        status: "IN_PROGRESS",
                        conclusion: null,
                        isRequired: false,
                      },
                      {
                        __typename: "StatusContext",
                        context: "deploy",
                        state: "PENDING",
                        targetUrl: null,
                        isRequired: false,
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    },
  },
};

describe("operations", () => {
  test("pr checks buckets like gh and filters by bucket", async () => {
    const { deps } = fakeDeps([on("POST", /\/graphql/, () => json(rollup))]);
    const res = await createClient(deps).pr.checks({
      number: 5,
      only: ["fail"],
    });
    expect(res.counts).toEqual({
      pass: 1,
      fail: 1,
      pending: 2,
      skipping: 0,
      cancel: 0,
    });
    expect(res.checks).toEqual([
      expect.objectContaining({
        name: "test",
        bucket: "fail",
        required: true,
        runId: 77,
        workflow: "CI",
      }),
    ]);
    expect(res.headSha).toBe("abc123");
  });

  test("pr merge pins the head SHA and reports a moved head as conflict", async () => {
    const { deps, seen } = fakeDeps([
      on("PUT", /\/pulls\/5\/merge$/, () =>
        json({ message: "Head branch was modified" }, 409),
      ),
    ]);
    const err = await createClient(deps)
      .pr.merge({ number: 5, matchHeadSha: "abc123" })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(Reflect.get(Object(err), "kind")).toBe("conflict");
    expect(seen[0]?.body).toEqual({ merge_method: "merge", sha: "abc123" });
  });

  test("issue list drops pull requests and keeps paging until it has enough", async () => {
    const issue = (n: number, pr = false) => ({
      number: n,
      title: "t",
      state: "open",
      labels: [{ name: "bug" }],
      html_url: "u",
      ...(pr ? { pull_request: {} } : {}),
    });
    const { deps } = fakeDeps([
      on("GET", /\/issues\?.*per_page=2(&|$)/, () =>
        json([issue(1), issue(2, true)]),
      ),
      on("GET", /\/issues\?.*per_page=4(&|$)/, () =>
        json([issue(1), issue(2, true), issue(3), issue(4)]),
      ),
    ]);
    const { items } = await createClient(deps).issue.list({ limit: 2 });
    expect(items.map((i) => i.number)).toEqual([1, 3]);
    expect(items[0]?.labels).toEqual(["bug"]);
  });

  test("run logs follow the redirect without the token and keep only failed jobs", async () => {
    const jobs = {
      jobs: [
        {
          id: 1,
          name: "build",
          status: "completed",
          conclusion: "success",
          steps: [],
        },
        {
          id: 2,
          name: "test",
          status: "completed",
          conclusion: "failure",
          steps: [{ name: "bun test", conclusion: "failure" }],
        },
      ],
    };
    const { deps, seen } = fakeDeps([
      on("GET", /\/runs\/9\/jobs/, () => json(jobs)),
      on(
        "GET",
        /\/jobs\/2\/logs$/,
        () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://blob.example/log" },
          }),
      ),
      (req) =>
        req.url === "https://blob.example/log"
          ? new Response(
              "2026-11-25T01:02:03.4567890Z ok\n2026-11-25T01:02:04.0000000Z error: boom\n",
            )
          : undefined,
    ]);
    const [log] = await createClient(deps).run.logs({
      runId: 9,
      grep: "error",
    });
    expect(log?.name).toBe("test");
    expect(log?.lines).toEqual(["error: boom"]);
    expect(
      seen.find((r) => r.url.startsWith("https://blob.example"))?.auth,
    ).toBeNull();
    expect(seen.some((r) => r.url.includes("/jobs/1/"))).toBe(false);
    expect(JSON.stringify(log)).not.toContain(TOKEN);
  });

  test("the MCP server lists every operation, and read-only mode drops the writers", () => {
    const names = mcpHandler(surface).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "pr_view",
        "pr_checks",
        "pr_merge",
        "issue_close",
        "run_logs",
        "api_graphql",
      ]),
    );
    const readOnly = mcpHandler(surface, { readOnly: true }).tools.map(
      (t) => t.name,
    );
    expect(readOnly).toContain("pr_view");
    expect(readOnly).not.toContain("pr_merge");
    expect(readOnly).not.toContain("api_rest");
  });
});
