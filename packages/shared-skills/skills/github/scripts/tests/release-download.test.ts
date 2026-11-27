import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { releaseWriteOps } from "../src/release-write.ts";
import { fakeGitHub, json, on } from "./fake.ts";

const rel = {
  id: 1,
  tag_name: "v1.2.0",
  html_url: "https://github.com/acme/widgets/releases/tag/v1.2.0",
  assets: [
    { id: 5, name: "app-linux.tar.gz" },
    { id: 6, name: "app-mac.zip" },
  ],
};
const routes = [
  on("GET", /\/releases\/latest$/, () => json(rel)),
  on("GET", /\/releases\/tags\/v1\.2\.0$/, () => json(rel)),
  on("GET", /\/releases\/assets\/5$/, () => new Response("linux")),
  on("GET", /\/releases\/assets\/6$/, () => new Response("mac")),
  on("GET", /\/zipball\/v1\.2\.0$/, () => new Response("source")),
];
const kindOf = async (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e: unknown) => String(Reflect.get(Object(e), "kind")),
  );

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "release-download-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("release download", () => {
  test("only assets matching the patterns are fetched and land in dir", async () => {
    const { gh, seen } = fakeGitHub(routes);
    const out = await releaseWriteOps(gh).download.invoke({
      patterns: ["*.tar.gz"],
      dir,
    });
    expect(seen.map((r) => new URL(r.url).pathname)).toEqual([
      "/repos/acme/widgets/releases/latest",
      "/repos/acme/widgets/releases/assets/5",
    ]);
    expect(out).toEqual({
      repo: "acme/widgets",
      tag: "v1.2.0",
      files: [{ path: join(dir, "app-linux.tar.gz"), size: 5 }],
      skipped: [],
    });
    expect(await Bun.file(join(dir, "app-linux.tar.gz")).text()).toBe("linux");
  });

  test("archive alone fetches only the source zipball, named repo-version", async () => {
    const { gh } = fakeGitHub(routes);
    const out = await releaseWriteOps(gh).download.invoke({
      tag: "v1.2.0",
      archive: "zip",
      dir,
    });
    expect(out.files).toEqual([
      { path: join(dir, "widgets-1.2.0.zip"), size: 6 },
    ]);
  });

  test("an existing file is a conflict unless skipExisting or clobber", async () => {
    await Bun.write(join(dir, "app-mac.zip"), "stale");
    const { gh, seen } = fakeGitHub(routes);
    const ops = releaseWriteOps(gh);
    expect(await kindOf(ops.download.invoke({ tag: "v1.2.0", dir }))).toBe(
      "conflict",
    );
    expect(seen).toHaveLength(1);
    const skip = await ops.download.invoke({
      tag: "v1.2.0",
      dir,
      skipExisting: true,
    });
    expect(skip.skipped).toEqual([join(dir, "app-mac.zip")]);
    expect(await Bun.file(join(dir, "app-mac.zip")).text()).toBe("stale");
    await ops.download.invoke({ tag: "v1.2.0", dir, clobber: true });
    expect(await Bun.file(join(dir, "app-mac.zip")).text()).toBe("mac");
  });

  test("latest without patterns or archive, and a pattern matching nothing, are refused", async () => {
    const { gh, seen } = fakeGitHub(routes);
    const ops = releaseWriteOps(gh);
    expect(await kindOf(ops.download.invoke({ dir }))).toBe("usage");
    expect(seen).toHaveLength(0);
    expect(
      await kindOf(ops.download.invoke({ patterns: ["*.exe"], dir })),
    ).toBe("not_found");
  });
});
