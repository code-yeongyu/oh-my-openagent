import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const testRoots: string[] = [];

afterEach(async () => {
  await Promise.all(testRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("lazycodex bin wrapper", () => {
  test("runs the bundled Bun CLI instead of stale OMO platform binaries", async () => {
    // #given
    const fixture = await createLazyCodexFixture();
    const nodePath = Bun.which("node") ?? "node";

    // #when
    const result = spawnSync(nodePath, [fixture.lazycodexBin, "install", "--no-tui"], {
      encoding: "utf8",
      env: {
        ...process.env,
        CAPTURE_DIR: fixture.captureDir,
        PATH: `${fixture.fakeBinDir}:${process.env.PATH ?? ""}`,
      },
    });

    // #then
    expect(result.status).toBe(23);
    expect((await readFile(join(fixture.captureDir, "env"), "utf8")).trim()).toBe("lazycodex");
    expect((await readFile(join(fixture.captureDir, "args"), "utf8")).trim().split("\n")).toEqual([
      await realpath(fixture.bundledCli),
      "install",
      "--no-tui",
    ]);
  });
});

async function createLazyCodexFixture() {
  const root = await mkdtemp(join(tmpdir(), "lazycodex-bin-wrapper-"));
  testRoots.push(root);

  const binDir = join(root, "bin");
  const distCli = join(root, "dist", "cli", "index.js");
  const fakeBinDir = join(root, "fake-bin");
  const captureDir = join(root, "capture");
  await mkdir(binDir, { recursive: true });
  await mkdir(dirname(distCli), { recursive: true });
  await mkdir(fakeBinDir, { recursive: true });
  await mkdir(captureDir, { recursive: true });

  await cp(fileURLToPath(new URL("./oh-my-opencode.js", import.meta.url)), join(binDir, "lazycodex"));
  await cp(fileURLToPath(new URL("./platform.js", import.meta.url)), join(binDir, "platform.js"));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "lazycodex", type: "module" }));
  await writeFile(distCli, "#!/usr/bin/env bun\n");

  const fakeBun = join(fakeBinDir, "bun");
  await writeFile(
    fakeBun,
    [
      "#!/bin/sh",
      "printf '%s\\n' \"$OMO_INVOCATION_NAME\" > \"$CAPTURE_DIR/env\"",
      "printf '%s\\n' \"$@\" > \"$CAPTURE_DIR/args\"",
      "exit 23",
      "",
    ].join("\n"),
  );
  await chmod(fakeBun, 0o755);

  return {
    bundledCli: distCli,
    captureDir,
    fakeBinDir,
    lazycodexBin: join(binDir, "lazycodex"),
  };
}
