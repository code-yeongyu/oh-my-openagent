import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  agentFile,
  cleanupAgentFixture,
  createEmptyAgentFixture,
  packageRoot,
} from "./installer-test-support";
import { createFakeSenpi, createLinkedNpmBin } from "./installer-npm-bin-test-support";

describe("omo-ai omoai npm launcher", () => {
  it("uses a shell-free Windows cmd shim request while keeping POSIX direct", async () => {
    const launcherPath = join(packageRoot, "src/cli/omoai.mjs");
    const launcher = await import(launcherPath);

    expect(typeof launcher.createSenpiLaunchRequest).toBe("function");

    const binDir = createEmptyAgentFixture();
    const binWithSpaces = agentFile(binDir, "bin with spaces");
    const senpiCmd = join(binWithSpaces, "senpi.cmd");
    const dangerousArg = "name && echo pwned";
    const secretArg = "%OMO_AI_SECRET%";
    const env = {
      ...process.env,
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
      PATH: `${binWithSpaces};C:\\Windows\\System32`,
      PATHEXT: ".cmd;.exe",
    };

    try {
      mkdirSync(binWithSpaces, { recursive: true });
      writeFileSync(senpiCmd, "@echo off\r\n", "utf8");

      const windowsLaunch = launcher.createSenpiLaunchRequest([dangerousArg, secretArg], "win32", env);
      expect(windowsLaunch.command).toBe(env.ComSpec);
      const expectedInner = [
        `"${senpiCmd}"`,
        "-e",
        packageRoot,
        `"${dangerousArg}"`,
        "\"\"^%\"OMO_AI_SECRET\"^%\"\"",
      ].join(" ");
      expect(windowsLaunch.args).toEqual(["/d", "/s", "/c", `"${expectedInner}"`]);
      const innerLine = windowsLaunch.args[3].slice(1, -1);
      expect(innerLine).toContain(`"${senpiCmd}"`);
      expect(innerLine).toContain(`"${dangerousArg}"`);
      expect(innerLine.includes(secretArg)).toBe(false);
      expect(innerLine).toContain("OMO_AI_SECRET");
      expect(innerLine.match(/\^%/g)?.length).toBe(2);
      expect(windowsLaunch.options).toEqual({
        env,
        shell: false,
        stdio: "inherit",
        windowsHide: true,
        windowsVerbatimArguments: true,
      });
      expect(windowsLaunch.options.windowsVerbatimArguments).toBe(true);
      expect(windowsLaunch.options.shell).toBe(false);

      const senpiExe = join(binWithSpaces, "senpi.exe");
      const exeEnv = { ...env, PATHEXT: ".exe;.cmd" };
      writeFileSync(senpiExe, "", "utf8");
      const exeLaunch = launcher.createSenpiLaunchRequest(["list"], "win32", exeEnv);
      expect(exeLaunch).toEqual({
        command: senpiExe,
        args: ["-e", packageRoot, "list"],
        options: {
          env: exeEnv,
          shell: false,
          stdio: "inherit",
          windowsHide: true,
        },
      });
      expect("windowsVerbatimArguments" in exeLaunch.options).toBe(false);
      expect(exeLaunch.options.shell).toBe(false);
    } finally {
      cleanupAgentFixture(binDir);
    }

    const posixLaunch = launcher.createSenpiLaunchRequest([dangerousArg], "linux", env);
    expect(posixLaunch).toEqual({
      command: "senpi",
      args: ["-e", packageRoot, dangerousArg],
      options: {
        env,
        shell: false,
        stdio: "inherit",
      },
    });
    expect("windowsVerbatimArguments" in posixLaunch.options).toBe(false);
    expect(posixLaunch.options.shell).toBe(false);
  });

  it("launches senpi through the shipped omoai npm bin with an invocation-local package root", () => {
    // Given: npm global install exposes an omoai linked bin and senpi is available on PATH.
    const binDir = createEmptyAgentFixture();
    const globalModulesDir = agentFile(binDir, "lib/node_modules");
    const linkedPackageRoot = join(globalModulesDir, "omo-ai");
    const symlinkedBin = agentFile(binDir, "omoai");
    const fakeSenpiDir = agentFile(binDir, "fake-bin");
    const capturePath = agentFile(binDir, "senpi-argv.json");

    try {
      const invokedBin = createLinkedNpmBin(
        globalModulesDir,
        linkedPackageRoot,
        symlinkedBin,
        "src/cli/omoai.mjs",
      );
      createFakeSenpi(fakeSenpiDir, capturePath);

      // When: the installed omoai launcher is invoked with original Senpi args.
      const launched = spawnSync(process.execPath, [invokedBin, "list", "--no-approve"], {
        cwd: packageRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeSenpiDir}${process.platform === "win32" ? ";" : ":"}${process.env["PATH"] ?? ""}`,
        },
      });

      // Then: omoai delegates to senpi -e <packageRoot> while preserving the original args.
      expect(launched.status).toBe(0);
      expect(launched.stderr.trim()).toBe("");
      expect(JSON.parse(readFileSync(capturePath, "utf8"))).toEqual({
        argv: ["-e", packageRoot, "list", "--no-approve"],
      });
    } finally {
      cleanupAgentFixture(binDir);
    }
  });
});
