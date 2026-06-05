/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPlatformPackageCandidates } from "./platform.js";

const testRoots: string[] = [];

afterEach(async () => {
  await Promise.all(testRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("lazycodex bin wrapper", () => {
  test("runs the platform package launcher through Node", async () => {
    // #given
    const fixture = await createLazyCodexFixture();
    const nodePath = Bun.which("node") ?? "node";

    // #when
    const result = spawnSync(nodePath, [fixture.lazycodexBin, "install", "--no-tui"], {
      encoding: "utf8",
      env: createWrapperTestEnv(fixture),
    });

    // #then
    expect(result.status).toBe(23);
    expect((await readFile(join(fixture.captureDir, "env"), "utf8")).trim()).toBe("lazycodex");
    expect(await canonicalizePackageRootCapture(fixture)).toBe(await realpath(fixture.root));
    expect(await realpath((await readFile(join(fixture.captureDir, "exec-path"), "utf8")).trim())).toBe(await realpath(nodePath));
    expect((await readFile(join(fixture.captureDir, "args"), "utf8")).trim().split("\n")).toEqual([
      "install",
      "--no-tui",
    ]);
  });

  test("runs the platform binary when published under an npm scope", async () => {
    // #given
    const fixture = await createLazyCodexFixture({ packageName: "@code-yeongyu/lazycodex" });
    const nodePath = Bun.which("node") ?? "node";

    // #when
    const result = spawnSync(nodePath, [fixture.lazycodexBin, "install", "--no-tui"], {
      encoding: "utf8",
      env: createWrapperTestEnv(fixture),
    });

    // #then
    expect(result.status).toBe(23);
    expect((await readFile(join(fixture.captureDir, "env"), "utf8")).trim()).toBe("lazycodex");
    expect(await canonicalizePackageRootCapture(fixture)).toBe(await realpath(fixture.root));
    expect((await readFile(join(fixture.captureDir, "args"), "utf8")).trim().split("\n")).toEqual([
      "install",
      "--no-tui",
    ]);
  });

  test("routes the lazycodex-ai package to the Codex installer via the oh-my-openagent platform family", async () => {
    // #given
    const fixture = await createLazyCodexFixture({ packageName: "lazycodex-ai", wrapperFileName: "lazycodex-ai" });
    const nodePath = Bun.which("node") ?? "node";

    // #when
    const result = spawnSync(nodePath, [fixture.wrapperBin, "install", "--no-tui"], {
      encoding: "utf8",
      env: createWrapperTestEnv(fixture),
    });

    // #then
    expect(result.status).toBe(23);
    expect((await readFile(join(fixture.captureDir, "env"), "utf8")).trim()).toBe("lazycodex-ai");
    expect(await canonicalizePackageRootCapture(fixture)).toBe(await realpath(fixture.root));
    expect((await readFile(join(fixture.captureDir, "args"), "utf8")).trim().split("\n")).toEqual([
      "install",
      "--no-tui",
    ]);
  });

  test("routes npm shim execution from the lazycodex package to the Codex installer", async () => {
    // #given
    const fixture = await createLazyCodexFixture({ wrapperFileName: "oh-my-opencode.js" });
    const nodePath = Bun.which("node") ?? "node";

    // #when
    const result = spawnSync(nodePath, [fixture.wrapperBin, "install", "--no-tui"], {
      encoding: "utf8",
      env: createWrapperTestEnv(fixture),
    });

    // #then
    expect(result.status).toBe(23);
    expect((await readFile(join(fixture.captureDir, "env"), "utf8")).trim()).toBe("lazycodex");
    expect(await canonicalizePackageRootCapture(fixture)).toBe(await realpath(fixture.root));
    expect((await readFile(join(fixture.captureDir, "args"), "utf8")).trim().split("\n")).toEqual([
      "install",
      "--no-tui",
    ]);
  });

  test("routes lazycodex update to the Node installer before platform binary resolution", async () => {
    // #given
    const fixture = await createLazyCodexFixture();
    const nodePath = Bun.which("node") ?? "node";

    // #when
    const result = spawnSync(nodePath, [fixture.lazycodexBin, "update", "--dry-run"], {
      encoding: "utf8",
      env: createWrapperTestEnv(fixture, {
        CAPTURE_DIR: fixture.captureDir,
        LAZYCODEX_CURRENT_VERSION: "1.0.0",
        LAZYCODEX_LATEST_VERSION: "1.0.1",
        PATH: fixture.fakeBinDir,
      }),
    });

    // #then
    expect(result.status).toBe(19);
    expect((await readFile(join(fixture.captureDir, "node-installer-args"), "utf8")).trim().split("\n")).toEqual([
      "update",
      "--dry-run",
    ]);
  });

  test("routes lazycodex uninstall to the Node installer before platform binary resolution", async () => {
    // #given
    const fixture = await createLazyCodexFixture();
    const nodePath = Bun.which("node") ?? "node";

    // #when
    const result = spawnSync(nodePath, [fixture.lazycodexBin, "uninstall", "--dry-run", "--project", "/tmp/lazycodex-qa"], {
      encoding: "utf8",
      env: createWrapperTestEnv(fixture),
    });

    // #then
    expect(result.status).toBe(19);
    expect((await readFile(join(fixture.captureDir, "node-installer-args"), "utf8")).trim().split("\n")).toEqual([
      "uninstall",
      "--dry-run",
      "--project",
      "/tmp/lazycodex-qa",
    ]);
  });
});

function createWrapperTestEnv(
  fixture: { readonly captureDir: string; readonly fakeBinDir: string },
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const { OMO_INVOCATION_NAME: _invocationName, OMO_WRAPPER_PACKAGE_ROOT: _wrapperPackageRoot, ...baseEnv } = process.env;
  return {
    ...baseEnv,
    CAPTURE_DIR: fixture.captureDir,
    PATH: fixture.fakeBinDir,
    ...overrides,
  };
}

async function createLazyCodexFixture(options: { packageName?: string; wrapperFileName?: string } = {}) {
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

  const wrapperFileName = options.wrapperFileName ?? "lazycodex";
  const wrapperBin = join(binDir, wrapperFileName);
  await cp(fileURLToPath(new URL("./oh-my-opencode.js", import.meta.url)), wrapperBin);
  if (wrapperFileName !== "lazycodex") {
    await symlink(wrapperFileName, join(binDir, "lazycodex"));
  }
  await cp(fileURLToPath(new URL("./platform.js", import.meta.url)), join(binDir, "platform.js"));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: options.packageName ?? "lazycodex", type: "module" }));
  await writeFile(distCli, "#!/usr/bin/env bun\n");
  await writeNodeInstallerFixture(root);
  await writePlatformPackages(root);

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
    root,
    wrapperBin,
  };
}

async function writeNodeInstallerFixture(root: string): Promise<void> {
  const installerPath = join(root, "packages", "omo-codex", "scripts", "install-local.mjs");
  await mkdir(dirname(installerPath), { recursive: true });
  await writeFile(
    installerPath,
    [
      "#!/usr/bin/env node",
      'import { writeFileSync } from "node:fs";',
      'writeFileSync(`${process.env.CAPTURE_DIR}/node-installer-args`, `${process.argv.slice(2).join("\\n")}\\n`);',
      "process.exit(19);",
      "",
    ].join("\n"),
  );
  await chmod(installerPath, 0o755);
}

async function canonicalizePackageRootCapture(fixture: { readonly captureDir: string }): Promise<string> {
  return realpath((await readFile(join(fixture.captureDir, "wrapper-root"), "utf8")).trim());
}

async function writePlatformPackages(root: string): Promise<void> {
  const packages = getPlatformPackageCandidates({
    platform: process.platform,
    arch: process.arch,
    libcFamily: process.platform === "linux" ? "glibc" : undefined,
    packageBaseName: "oh-my-openagent",
  });
  for (const packageName of packages) {
    const binaryPath = join(root, "node_modules", packageName, "bin", "oh-my-opencode.js");
    await mkdir(dirname(binaryPath), { recursive: true });
    await writeFile(
      binaryPath,
      [
        "#!/usr/bin/env node",
        'import { writeFileSync } from "node:fs";',
        'writeFileSync(`${process.env.CAPTURE_DIR}/env`, `${process.env.OMO_INVOCATION_NAME}\\n`);',
        'writeFileSync(`${process.env.CAPTURE_DIR}/wrapper-root`, `${process.env.OMO_WRAPPER_PACKAGE_ROOT}\\n`);',
        'writeFileSync(`${process.env.CAPTURE_DIR}/exec-path`, `${process.execPath}\\n`);',
        'writeFileSync(`${process.env.CAPTURE_DIR}/args`, `${process.argv.slice(2).join("\\n")}\\n`);',
        "process.exit(23);",
        "",
      ].join("\n"),
    );
    await chmod(binaryPath, 0o755);
  }

  if (process.platform === "linux") {
    const detectLibcPath = join(root, "node_modules", "detect-libc", "index.js");
    await mkdir(dirname(detectLibcPath), { recursive: true });
    await writeFile(detectLibcPath, 'exports.familySync = () => "glibc";\n');
  }
}
