import { describe, expect, test } from "bun:test";
import { workflowOps } from "../src/workflows.ts";
import { fakeGitHub, json, on, type Seen } from "./fake.ts";

const wf = (id: number, name: string, state = "active") => ({
  id,
  name,
  path: `.github/workflows/${name.toLowerCase()}.yml`,
  state,
  html_url: `https://github.com/acme/widgets/actions/workflows/${name.toLowerCase()}.yml`,
  updated_at: "2026-11-01T00:00:00Z",
});
const run = {
  id: 70,
  name: "CI",
  display_title: "fix",
  status: "completed",
  conclusion: "success",
  event: "push",
  head_branch: "main",
  head_sha: "abc",
  run_attempt: 1,
  created_at: "2026-11-02T00:00:00Z",
  html_url: "https://github.com/acme/widgets/actions/runs/70",
};
const list = on("GET", /\/actions\/workflows\?/, () =>
  json({
    total_count: 3,
    workflows: [
      wf(1, "CI"),
      wf(2, "Release", "disabled_manually"),
      wf(3, "ci"),
    ],
  }),
);
const pathOf = (req: Seen | undefined) =>
  req === undefined ? "" : new URL(req.url).pathname + new URL(req.url).search;
const kindOf = async (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e: unknown) => String(Reflect.get(Object(e), "kind")),
  );

describe("workflows", () => {
  test("list hides disabled workflows unless all is set", async () => {
    const { gh } = fakeGitHub([list]);
    const ops = workflowOps(gh);
    const active = await ops.list.invoke({});
    expect(active.items.map((w) => w.id)).toEqual([1, 3]);
    const every = await ops.list.invoke({ all: true, limit: 2 });
    expect(every).toEqual({
      repo: "acme/widgets",
      items: [
        {
          id: 1,
          name: "CI",
          path: ".github/workflows/ci.yml",
          state: "active",
          url: "https://github.com/acme/widgets/actions/workflows/ci.yml",
          updatedAt: "2026-11-01T00:00:00Z",
        },
        expect.objectContaining({ id: 2, state: "disabled_manually" }),
      ],
    });
  });

  test("view by file name returns the latest runs and, with yaml, the file at a ref", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /\/actions\/workflows\/ci\.yml$/, () => json(wf(1, "CI"))),
      on("GET", /\/workflows\/1\/runs/, () => json({ workflow_runs: [run] })),
      on(
        "GET",
        /\/contents\/\.github\/workflows\/ci\.yml\?ref=v1$/,
        () => new Response("on: push\n"),
      ),
    ]);
    const out = await workflowOps(gh).view.invoke({
      workflow: "ci.yml",
      yaml: true,
      ref: "v1",
      limit: 1,
    });
    expect(pathOf(seen[1])).toBe(
      "/repos/acme/widgets/actions/workflows/1/runs?per_page=1",
    );
    expect(out).toMatchObject({ id: 1, state: "active", yaml: "on: push\n" });
    expect(out.runs.map((r) => [r.id, r.conclusion])).toEqual([
      [70, "success"],
    ]);
  });

  test("a display name resolves through the list; an ambiguous or unknown name fails", async () => {
    const { gh } = fakeGitHub([
      list,
      on("GET", /\/workflows\/2\/runs/, () => json({ workflow_runs: [] })),
    ]);
    const ops = workflowOps(gh);
    expect(await ops.view.invoke({ workflow: "release" })).toMatchObject({
      id: 2,
      runs: [],
    });
    expect(await kindOf(ops.view.invoke({ workflow: "ci" }))).toBe("usage");
    expect(await kindOf(ops.view.invoke({ workflow: "Nope" }))).toBe(
      "not_found",
    );
  });

  test("enable and disable PUT the endpoint and return the re-read state", async () => {
    let state = "disabled_manually";
    const { gh, seen } = fakeGitHub([
      on("PUT", /\/workflows\/7\/(en|dis)able$/, (req) => {
        state = req.url.endsWith("/enable") ? "active" : "disabled_manually";
        return new Response(null, { status: 204 });
      }),
      on("GET", /\/actions\/workflows\/7$/, () =>
        json({ ...wf(7, "Nightly"), state }),
      ),
    ]);
    const ops = workflowOps(gh);
    expect(await ops.enable.invoke({ workflow: "7" })).toMatchObject({
      id: 7,
      state: "active",
    });
    expect(await ops.disable.invoke({ workflow: "7" })).toMatchObject({
      state: "disabled_manually",
    });
    expect(seen.filter((r) => r.method === "PUT").map(pathOf)).toEqual([
      "/repos/acme/widgets/actions/workflows/7/enable",
      "/repos/acme/widgets/actions/workflows/7/disable",
    ]);
  });
});
