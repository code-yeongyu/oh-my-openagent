import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoContentOps } from "../src/repo-content.ts";
import { fakeGitHub, json, on } from "./fake.ts";
import { calls, kindOf, repoJson } from "./repo-fixture.ts";

const file = (
  content: Uint8Array | string,
  over: Readonly<Record<string, unknown>> = {},
) =>
  json({
    type: "file",
    sha: "s1",
    size: Buffer.from(content).byteLength,
    encoding: "base64",
    content: Buffer.from(content).toString("base64"),
    ...over,
  });

let dir: string | undefined;
afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("repo readDir", () => {
  test("lists the root at a ref", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /^\/repos\/acme\/widgets\/contents\?ref=dev$/, () =>
        json([{ name: "src", path: "src", type: "dir", size: 0, sha: "d1" }]),
      ),
    ]);
    expect(await repoContentOps(gh).readDir.invoke({ ref: "dev" })).toEqual({
      repo: "acme/widgets",
      path: "",
      ref: "dev",
      items: [{ name: "src", path: "src", type: "dir", size: 0, sha: "d1" }],
    });
    expect(seen).toHaveLength(1);
  });

  test("a file path is refused", async () => {
    const { gh } = fakeGitHub([
      on("GET", /\/contents\/a\.txt$/, () => file("x")),
    ]);
    expect(
      await kindOf(repoContentOps(gh).readDir.invoke({ path: "a.txt" })),
    ).toBe("usage");
  });
});

describe("repo readFile", () => {
  test("returns decoded text, with each path segment encoded", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /\/contents\/docs\/a%20b\.md$/, () => file("héllo\n")),
    ]);
    const out = await repoContentOps(gh).readFile.invoke({
      path: "docs/a b.md",
    });
    expect(out).toEqual({
      repo: "acme/widgets",
      path: "docs/a b.md",
      ref: null,
      sha: "s1",
      size: 7,
      content: "héllo\n",
    });
    expect(calls(seen)).toEqual([
      "GET /repos/acme/widgets/contents/docs/a%20b.md",
    ]);
  });

  test("a file over 1 MB is fetched again as raw bytes at the same ref", async () => {
    const { gh, seen } = fakeGitHub([
      on("GET", /\/contents\/big\.txt\?ref=v1$/, (req) =>
        seen.length === 1
          ? file("", { encoding: "none", content: "", size: 2_000_000 })
          : new Response(`raw ${req.method}`),
      ),
    ]);
    const out = await repoContentOps(gh).readFile.invoke({
      path: "big.txt",
      ref: "v1",
    });
    expect(out).toMatchObject({ size: 2_000_000, content: "raw GET" });
    expect(seen).toHaveLength(2);
  });

  test("binary content needs output, which is written and not overwritten without clobber", async () => {
    dir = await mkdtemp(join(tmpdir(), "repo-content-"));
    const bytes = new Uint8Array([137, 80, 78, 71, 0, 1]);
    const { gh } = fakeGitHub([
      on("GET", /\/contents\/logo\.png$/, () => file(bytes)),
    ]);
    const read = repoContentOps(gh).readFile;
    expect(await kindOf(read.invoke({ path: "logo.png" }))).toBe("usage");
    const output = join(dir, "logo.png");
    expect(await read.invoke({ path: "logo.png", output })).toMatchObject({
      output,
      size: 6,
    });
    expect([...(await Bun.file(output).bytes())]).toEqual([...bytes]);
    await Bun.write(output, "keep");
    expect(await kindOf(read.invoke({ path: "logo.png", output }))).toBe(
      "usage",
    );
    expect(await Bun.file(output).text()).toBe("keep");
    await read.invoke({ path: "logo.png", output, clobber: true });
    expect((await Bun.file(output).bytes()).byteLength).toBe(6);
  });

  test("a directory or symlink is refused", async () => {
    const { gh } = fakeGitHub([
      on("GET", /\/contents\/src$/, () => json([])),
      on("GET", /\/contents\/link$/, () =>
        json({ type: "symlink", target: "x", sha: "s", size: 1 }),
      ),
    ]);
    const read = repoContentOps(gh).readFile;
    expect(await kindOf(read.invoke({ path: "src" }))).toBe("usage");
    expect(await kindOf(read.invoke({ path: "link" }))).toBe("usage");
  });
});

describe("repo clone", () => {
  test("a fork is cloned with its parent added and fetched as upstream", async () => {
    const { gh, gitCalls } = fakeGitHub([
      on("GET", /^\/repos\/acme\/widgets$/, () =>
        json(
          repoJson({
            fork: true,
            parent: { full_name: "up/widgets", default_branch: "trunk" },
          }),
        ),
      ),
    ]);
    const out = await repoContentOps(gh).clone.invoke({
      repo: "acme/widgets",
      dir: "/w/widgets",
      gitFlags: ["--depth", "1"],
    });
    expect(out).toEqual({
      repo: "acme/widgets",
      dir: "/w/widgets",
      upstream: { remote: "upstream", repo: "up/widgets" },
    });
    expect(gitCalls).toEqual([
      {
        args: [
          "clone",
          "--depth",
          "1",
          "--",
          "https://github.com/acme/widgets.git",
          "/w/widgets",
        ],
        cwd: process.cwd(),
      },
      {
        args: [
          "remote",
          "add",
          "-t",
          "trunk",
          "upstream",
          "https://github.com/up/widgets.git",
        ],
        cwd: "/w/widgets",
      },
      { args: ["fetch", "upstream"], cwd: "/w/widgets" },
      {
        args: ["config", "remote.upstream.gh-resolved", "base"],
        cwd: "/w/widgets",
      },
    ]);
  });

  test("a non-fork, or noUpstream, runs only the clone; a relative dir runs nothing", async () => {
    const { gh, gitCalls } = fakeGitHub([
      on("GET", /^\/repos\/acme\/widgets$/, () => json(repoJson())),
      on("GET", /^\/repos\/acme\/forked$/, () =>
        json(
          repoJson({
            full_name: "acme/forked",
            fork: true,
            parent: { full_name: "up/forked", default_branch: "main" },
          }),
        ),
      ),
    ]);
    const clone = repoContentOps(gh).clone;
    expect(
      await clone.invoke({
        repo: "acme/forked",
        dir: "/w/f",
        noUpstream: true,
      }),
    ).toMatchObject({ upstream: null });
    expect(await clone.invoke({ repo: "acme/widgets", dir: "/w/x" })).toEqual({
      repo: "acme/widgets",
      dir: "/w/x",
      upstream: null,
    });
    expect(
      await kindOf(clone.invoke({ repo: "acme/widgets", dir: "rel/x" })),
    ).toBe("usage");
    expect(gitCalls.map((c) => c.args[0])).toEqual(["clone", "clone"]);
  });
});
