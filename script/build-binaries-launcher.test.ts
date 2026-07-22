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

async function createLauncherFixture(
  { withNodeCli, bunOutput }: {
    readonly withNodeCli: boolean;
    readonly bunOutput?: string;
  },
): Promise<LauncherFixture> {
  const root = await mkdtemp(join(tmpdir(), "launcher-fixture-"));
  const wrapperPackageRoot = join(root, "pkg");
  await mkdir(join(wrapperPackageRoot, "dist", "cli"), { recursive: true });
  await writeFile(
    join(wrapperPackageRoot, "dist", "cli", "index.js"),
    bunOutput ? `console.log(${JSON.stringify(bunOutput)})\n` : 'console.log("BUN_CLI_RAN");\n',
  );
  if (withNodeCli) {
    await mkdir(join(wrapperPackageRoot, "dist", "cli-node"), { recursive: true });
    await writeFile(
      join(wrapperPackageRoot, "dist", "cli-node", "index.js"),
      'console.log("OMO_NODE_OK", process.argv.slice(2).join(" "));\n',
    );
  }
  const launcherPath = join(root, "launcher.js");
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

async function writeFakeBun(
  dir: string,
  name: string,
  posixScript: string,
  winCmd: string,
): Promise<string> {
  if (process.platform === "win32") {
    const path = join(dir, `${name}.cmd`);
    await writeFile(path, `@echo off\r\n${winCmd}\r\n`);
    return path;
  }
  const path = join(dir, name);
  await writeFile(path, `#!/bin/sh\n${posixScript}\n`);
  await chmod(path, 0o755);
  return path;
}

describe("platform launcher runtime fallback (lazycodex#47)", () => {
  it("#given bun missing entirely #when launching #then falls back to the node CLI", async () => {
    const fixture = await createLauncherFixture({ withNodeCli: true });

    const result = runLauncher(fixture, { BUN_BINARY: "/nonexistent/bun" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("OMO_NODE_OK --help");
    expect(result.stderr).toContain("node CLI");
  });

  it("#given bun dies with SIGILL (unsupported CPU) #when launching #then falls back to node CLI", async () => {
    const fixture = await createLauncherFixture({ withNodeCli: true });

    if (process.platform === "win32") {
      // given: Windows cannot propagate SIGILL through spawnSync; exercise the error fallback path
      const result = runLauncher(fixture, { BUN_BINARY: join(fixture.root, "nonexistent-bun.exe") });

      // then: fallback to node CLI still works
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("OMO_NODE_OK --help");
      expect(result.stderr).toContain("node CLI");
      return;
    }

    // given: POSIX — simulate SIGILL with kill
    const sigillBun = join(fixture.root, "sigill-bun.sh");
    await writeFile(sigillBun, "#!/bin/sh\nkill -ILL $$\n");
    await chmod(sigillBun, 0o755);

    const result = runLauncher(fixture, { BUN_BINARY: sigillBun });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("OMO_NODE_OK --help");
    expect(result.stderr.toLowerCase()).toContain("cpu");
  });

  it("#given a working bun #when launching #then bun stays the preferred runtime", async () => {
    if (process.platform === "win32") {
      // given: Windows spawnSync without shell:true cannot run .sh or .cmd as a bun stand-in;
      // use node (process.execPath) as the fake bun binary, which the launcher invokes as
      // spawnSync(node, [cliPath, ...args]) — effectively running the CLI with node instead of bun
      const fixture = await createLauncherFixture({ withNodeCli: true, bunOutput: "BUN_OK" });

      const result = runLauncher(fixture, { BUN_BINARY: process.execPath });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("BUN_OK");
      expect(result.stdout).not.toContain("OMO_NODE_OK");
      return;
    }

    // given: POSIX — use a shell script fake bun
    const fixture = await createLauncherFixture({ withNodeCli: true, bunOutput: "BUN_OK" });
    const fakeBun = await writeFakeBun(fixture.root, "fake-bun", 'echo "BUN_OK $2"', "echo BUN_OK %2");

    const result = runLauncher(fixture, { BUN_BINARY: fakeBun });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("BUN_OK");
    expect(result.stdout).not.toContain("OMO_NODE_OK");
  });

  it("#given OMO_RUNTIME=node #when launching #then skips bun even when it works", async () => {
    const fixture = await createLauncherFixture({ withNodeCli: true });
    const fakeBun = await writeFakeBun(
      fixture.root,
      "fake-bun",
      'echo "BUN_OK"',
      "echo BUN_OK",
    );

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

describe("platform launcher module system (#6231)", () => {
  it("#given the launcher shipped as .js in a package without type:module #when node loads it directly #then it parses as a module instead of throwing a SyntaxError", async () => {
    // given: the launcher written with the production filename (bin/oh-my-opencode.js) in a
    // directory with no package.json - exactly how each platform package ships it, since the
    // platform package.json does not declare "type": "module"
    const dir = await mkdtemp(join(tmpdir(), "omo-launcher-modsys-"));
    const launcherPath = join(dir, "oh-my-opencode.js");
    await writeFile(launcherPath, createPlatformLauncherSource());

    // when: node loads the file directly, as the Windows npm/bunx wrapper does.
    // --no-experimental-detect-module reproduces the CJS interpretation used by node < 22.7
    // (and any node with syntax detection disabled), which is where the SyntaxError manifests.
    const result = spawnSync("node", ["--no-experimental-detect-module", launcherPath], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
    });

    // then: it must not fail to parse as a module, and must reach its own missing-root guard
    expect(result.stderr).not.toContain("Cannot use import statement outside a module");
    expect(result.stderr).toContain("OMO_WRAPPER_PACKAGE_ROOT is required");
    expect(result.status).toBe(2);
  });
});
