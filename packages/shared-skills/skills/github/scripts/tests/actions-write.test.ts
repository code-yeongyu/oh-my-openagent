import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actionWriteOps } from "../src/actions-write.ts";
import { fakeGitHub, json, on, type Seen } from "./fake.ts";
import { makeZip } from "./zip-fixture.ts";

const accepted = () => json({}, 202);
const pathOf = (req: Seen | undefined) =>
  req === undefined ? "" : new URL(req.url).pathname;
const kindOf = async (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e: unknown) => String(Reflect.get(Object(e), "kind")),
  );

describe("run writes", () => {
  test("cancel uses force-cancel only when forced", async () => {
    const { gh, seen } = fakeGitHub([
      on("POST", /\/(force-)?cancel$/, accepted),
    ]);
    const ops = actionWriteOps(gh);
    expect(await ops.cancel.invoke({ runId: 7 })).toEqual({
      repo: "acme/widgets",
      runId: 7,
      cancelled: true,
      force: false,
    });
    await ops.cancel.invoke({ runId: 7, force: true });
    expect(seen.map(pathOf)).toEqual([
      "/repos/acme/widgets/actions/runs/7/cancel",
      "/repos/acme/widgets/actions/runs/7/force-cancel",
    ]);
  });

  test("rerun picks the whole-run, failed-jobs or single-job endpoint and sends debug", async () => {
    const { gh, seen } = fakeGitHub([
      on("POST", /\/rerun/, () => json({}, 201)),
    ]);
    const ops = actionWriteOps(gh);
    await ops.rerun.invoke({ runId: 7 });
    await ops.rerun.invoke({ runId: 7, failed: true, debug: true });
    await ops.rerun.invoke({ jobId: 99 });
    expect(seen.map(pathOf)).toEqual([
      "/repos/acme/widgets/actions/runs/7/rerun",
      "/repos/acme/widgets/actions/runs/7/rerun-failed-jobs",
      "/repos/acme/widgets/actions/jobs/99/rerun",
    ]);
    expect(seen.map((r) => r.body)).toEqual([
      undefined,
      { enable_debug_logging: true },
      undefined,
    ]);
    for (const bad of [
      {},
      { runId: 7, jobId: 99 },
      { jobId: 99, failed: true },
    ])
      expect(await kindOf(ops.rerun.invoke(bad))).toBe("usage");
    expect(seen).toHaveLength(3);
  });

  test("delete removes the run", async () => {
    const { gh, seen } = fakeGitHub([
      on(
        "DELETE",
        /\/actions\/runs\/7$/,
        () => new Response(null, { status: 204 }),
      ),
    ]);
    expect(await actionWriteOps(gh).delete.invoke({ runId: 7 })).toEqual({
      repo: "acme/widgets",
      runId: 7,
      deleted: true,
    });
    expect(seen[0]?.method).toBe("DELETE");
  });
});

describe("run download", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "run-download-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const artifacts = [
    { id: 1, name: "logs", expired: false },
    { id: 2, name: "coverage", expired: false },
    { id: 3, name: "old", expired: true },
  ];
  const routes = [
    on("GET", /\/runs\/7\/artifacts/, () =>
      json({ total_count: 3, artifacts }),
    ),
    on(
      "GET",
      /\/artifacts\/1\/zip$/,
      () =>
        new Response(
          makeZip([{ name: "a/out.log", data: "log", deflate: true }]),
        ),
    ),
    on(
      "GET",
      /\/artifacts\/2\/zip$/,
      () => new Response(makeZip([{ name: "lcov.info", data: "cov" }])),
    ),
  ];

  test("every unexpired artifact extracts into its own folder", async () => {
    const { gh, seen } = fakeGitHub(routes);
    const out = await actionWriteOps(gh).download.invoke({ runId: 7, dir });
    expect(seen.map(pathOf)).not.toContain(
      "/repos/acme/widgets/actions/artifacts/3/zip",
    );
    expect(out.artifacts).toEqual([
      {
        id: 1,
        name: "logs",
        dir: join(dir, "logs"),
        files: [join(dir, "logs/a/out.log")],
      },
      {
        id: 2,
        name: "coverage",
        dir: join(dir, "coverage"),
        files: [join(dir, "coverage/lcov.info")],
      },
    ]);
    expect(await Bun.file(join(dir, "logs/a/out.log")).text()).toBe("log");
  });

  test("one named artifact extracts straight into dir; patterns keep per-artifact folders", async () => {
    const { gh } = fakeGitHub(routes);
    const ops = actionWriteOps(gh);
    await ops.download.invoke({ runId: 7, names: ["coverage"], dir });
    expect(await Bun.file(join(dir, "lcov.info")).text()).toBe("cov");
    const out = await ops.download.invoke({
      runId: 7,
      patterns: ["log*"],
      dir,
    });
    expect(out.artifacts.map((a) => a.dir)).toEqual([join(dir, "logs")]);
  });

  test("an existing file, an escaping entry or no match writes nothing", async () => {
    await Bun.write(join(dir, "lcov.info"), "keep");
    const { gh } = fakeGitHub(routes);
    const ops = actionWriteOps(gh);
    expect(
      await kindOf(ops.download.invoke({ runId: 7, names: ["coverage"], dir })),
    ).toBe("conflict");
    expect(await Bun.file(join(dir, "lcov.info")).text()).toBe("keep");
    expect(
      await kindOf(ops.download.invoke({ runId: 7, names: ["old"], dir })),
    ).toBe("not_found");

    const evil = fakeGitHub([
      on("GET", /\/runs\/7\/artifacts/, () =>
        json({ artifacts: [artifacts[0]] }),
      ),
      on(
        "GET",
        /\/artifacts\/1\/zip$/,
        () =>
          new Response(
            makeZip([
              { name: "ok.txt", data: "x" },
              { name: "../escape.txt", data: "x" },
            ]),
          ),
      ),
    ]);
    const sub = join(dir, "sub");
    expect(
      await kindOf(
        actionWriteOps(evil.gh).download.invoke({
          runId: 7,
          names: ["logs"],
          dir: sub,
        }),
      ),
    ).toBe("invalid_response");
    expect(await Bun.file(join(sub, "ok.txt")).exists()).toBe(false);
    expect(await Bun.file(join(dir, "escape.txt")).exists()).toBe(false);
  });
});
