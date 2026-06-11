/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPlatformLauncherSource } from "./build-binaries";

type LauncherFixture = {
  readonly launcherPath: string;
  readonly wrapperPackageRoot: string;
  readonly root: string;
};

async function createLauncherFixture({ withNodeCli }: { readonly withNodeCli: boolean }): Promise<LauncherFixture> {
  const root = await mkdtemp(join(tmpdir(), "launcher-fixture-"));
  const wrapperPackageRoot = join(root, "pkg");
  await mkdir(join(wrapperPackageRoot, "dist", "cli"), { recursive: true });
  await writeFile(join(wrapperPackageRoot, "dist", "cli", "index.js"), 'console.log("BUN_CLI_RAN");\n');
  if (withNodeCli) {
    await mkdir(join(wrapperPackageRoot, "dist", "cli-node"), { recursive: true });
    await writeFile(
      join(wrapperPackageRoot, "dist", "cli-node", "index.js"),
      'console.log("OMO_NODE_OK", process.argv.slice(2).join(" "));\n',
    );
  }
  const launcherPath = join(root, "launcher.mjs");
  await writeFile(launcherPath, createPlatformLauncherSource());
  return { launcherPath, wrapperPackageRoot, root };
}

function runLauncher(fixture: LauncherFixture, env: Record<string, string>, args: readonly string[] = ["--help"]) {
  return spawnSync("node", [fixture.launcherPath, ...args], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      OMO_WRAPPER_PACKAGE_ROOT: fixture.wrapperPackageRoot,
      ...env,
    },
  });
}

describe("platform launcher runtime fallback (lazycodex#47)", () => {
  it("#given bun missing entirely #when launching #then falls back to the node CLI", async () => {
    const fixture = await createLauncherFixture({ withNodeCli: true });

    const result = runLauncher(fixture, { BUN_BINARY: "/nonexistent/bun" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("OMO_NODE_OK --help");
    expect(result.stderr).toContain("node CLI");
  });

  it("#given bun dies with SIGILL (unsupported CPU) #when launching #then explains the CPU limitation and falls back", async () => {
    const fixture = await createLauncherFixture({ withNodeCli: true });
    const sigillBun = join(fixture.root, "sigill-bun.sh");
    await writeFile(sigillBun, "#!/bin/sh\nkill -ILL $$\n");
    await chmod(sigillBun, 0o755);

    const result = runLauncher(fixture, { BUN_BINARY: sigillBun });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("OMO_NODE_OK --help");
    expect(result.stderr.toLowerCase()).toContain("cpu");
  });

  it("#given a working bun #when launching #then bun stays the preferred runtime", async () => {
    const fixture = await createLauncherFixture({ withNodeCli: true });
    const fakeBun = join(fixture.root, "fake-bun.sh");
    await writeFile(fakeBun, '#!/bin/sh\necho "BUN_OK $2"\n');
    await chmod(fakeBun, 0o755);

    const result = runLauncher(fixture, { BUN_BINARY: fakeBun });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("BUN_OK");
    expect(result.stdout).not.toContain("OMO_NODE_OK");
  });

  it("#given OMO_RUNTIME=node #when launching #then skips bun even when it works", async () => {
    const fixture = await createLauncherFixture({ withNodeCli: true });
    const fakeBun = join(fixture.root, "fake-bun.sh");
    await writeFile(fakeBun, '#!/bin/sh\necho "BUN_OK"\n');
    await chmod(fakeBun, 0o755);

    const result = runLauncher(fixture, { BUN_BINARY: fakeBun, OMO_RUNTIME: "node" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("OMO_NODE_OK --help");
    expect(result.stdout).not.toContain("BUN_OK");
  });

  it("#given bun missing and no node CLI bundle #when launching #then keeps the original bun error", async () => {
    const fixture = await createLauncherFixture({ withNodeCli: false });

    const result = runLauncher(fixture, { BUN_BINARY: "/nonexistent/bun" });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("failed to execute Bun");
  });
});
