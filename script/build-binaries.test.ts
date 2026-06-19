// script/build-binaries.test.ts
// Tests for platform binary build configuration

import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Import PLATFORMS from build-binaries.ts
// We need to export it first, but for now we'll test the expected structure
const EXPECTED_BASELINE_TARGETS = [
  "bun-linux-x64-baseline",
  "bun-linux-x64-musl-baseline",
  "bun-darwin-x64-baseline",
  "bun-windows-x64-baseline",
];

async function writeFakeCli(tempDir: string): Promise<void> {
  const cliPath = join(tempDir, "dist", "cli", "index.js");
  await mkdir(join(tempDir, "dist", "cli"), { recursive: true });
  await writeFile(
    cliPath,
    [
      "#!/usr/bin/env node",
      "console.log(`bun-cli ${process.argv.slice(1).join(\" \")}`);",
      "",
    ].join("\n"),
  );
  await chmod(cliPath, 0o755);
}

function normalizeOutputPath(output: string): string {
  return output.replace(/\\/g, "/");
}

describe("build-binaries", () => {
  describe("PLATFORMS array", () => {
    it("includes baseline variants for non-AVX2 CPU support", async () => {
      // given
      const module = await import("./build-binaries.ts");
      const platforms = (module as { PLATFORMS: { target: string }[] }).PLATFORMS;
      const targets = platforms.map((p) => p.target);

      // when
      const hasAllBaselineTargets = EXPECTED_BASELINE_TARGETS.every((baseline) =>
        targets.includes(baseline)
      );

      // then
      expect(hasAllBaselineTargets).toBe(true);
      for (const baseline of EXPECTED_BASELINE_TARGETS) {
        expect(targets).toContain(baseline);
      }
    });

    it("uses exact package names as platform package directories", async () => {
      // given
      const module = await import("./build-binaries.ts");
      const platforms = (module as { PLATFORMS: { packageName: string; packageDir: string }[] }).PLATFORMS;

      // when
      const packageNames = platforms.map((p) => p.packageName);
      const packageDirs = platforms.map((p) => p.packageDir);

      // then
      expect(packageDirs).toEqual(packageNames);
      expect(packageDirs).toContain("oh-my-opencode-linux-x64-baseline");
      expect(packageDirs).toContain("oh-my-opencode-linux-x64-musl-baseline");
      expect(packageDirs).toContain("oh-my-opencode-darwin-x64-baseline");
      expect(packageDirs).toContain("oh-my-opencode-windows-x64-baseline");
      expect(packageDirs).toContain("oh-my-opencode-windows-arm64");
    });

    it("includes a windows-arm64 entry for Windows-on-ARM hosts", async () => {
      // given
      const module = await import("./build-binaries.ts");
      const platforms = (module as { PLATFORMS: { platform: string; packageName: string; packageDir: string }[] }).PLATFORMS;

      // when
      const windowsArm64 = platforms.find((p) => p.platform === "windows-arm64");

      // then
      expect(windowsArm64?.packageName).toBe("oh-my-opencode-windows-arm64");
      expect(windowsArm64?.packageDir).toBe("oh-my-opencode-windows-arm64");
    });

    it("uses JavaScript launcher names for baseline platforms", async () => {
      // given
      const module = await import("./build-binaries.ts");
      const platforms = (module as { PLATFORMS: { packageDir: string; target: string; binary: string }[] }).PLATFORMS;

      // when
      const windowsBaseline = platforms.find((p) => p.target === "bun-windows-x64-baseline");
      const linuxBaseline = platforms.find((p) => p.target === "bun-linux-x64-baseline");

      // then
      expect(windowsBaseline?.binary).toBe("oh-my-opencode.js");
      expect(linuxBaseline?.binary).toBe("oh-my-opencode.js");
    });

    it("launcher routes lazycodex install through the Node installer before requiring Bun", async () => {
      // given
      const module = await import("./build-binaries.ts");
      const createPlatformLauncherSource = (module as { createPlatformLauncherSource: () => string }).createPlatformLauncherSource;

      // when
      const source = createPlatformLauncherSource();

      // then
      expect(source).toContain("OMO_WRAPPER_PACKAGE_ROOT");
      expect(source).toContain('join(wrapperPackageRoot, "packages", "omo-codex", "scripts", "install-local.mjs")');
      expect(source).toContain('spawnSync(process.execPath, [lazyCodexInstallerPath, ...process.argv.slice(2)]');
      expect(source).toContain('join(wrapperPackageRoot, "dist", "cli", "index.js")');
      expect(source).toContain('spawnSync(bunBinary, [cliPath, ...process.argv.slice(2)]');
    });

    it("launcher can print lazycodex help when Bun is unavailable", async () => {
      // given
      const module = await import("./build-binaries.ts");
      const createPlatformLauncherSource = (module as { createPlatformLauncherSource: () => string }).createPlatformLauncherSource;
      const root = fileURLToPath(new URL("..", import.meta.url));
      const tempDir = await mkdtemp(join(tmpdir(), "lazycodex-launcher-"));
      const launcherPath = join(tempDir, "oh-my-opencode.js");
      await writeFile(launcherPath, createPlatformLauncherSource());
      await chmod(launcherPath, 0o755);

      // when
      const result = spawnSync(process.execPath, [launcherPath, "--help"], {
        encoding: "utf8",
        env: {
          ...process.env,
          BUN_BINARY: join(tempDir, "missing-bun"),
          OMO_INVOCATION_NAME: "lazycodex-ai",
          OMO_WRAPPER_PACKAGE_ROOT: root,
        },
      });

      // then
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Usage: lazycodex-ai install");
      expect(result.stderr).not.toContain("failed to execute Bun");
    });

    it("launcher routes omo codex-only install through the Node installer before requiring Bun", async () => {
      // given
      const module = await import("./build-binaries.ts");
      const createPlatformLauncherSource = (module as { createPlatformLauncherSource: () => string }).createPlatformLauncherSource;
      const tempDir = await mkdtemp(join(tmpdir(), "omo-codex-only-launcher-"));
      const launcherPath = join(tempDir, "oh-my-opencode.js");
      const installerPath = join(tempDir, "packages", "omo-codex", "scripts", "install-local.mjs");
      await mkdir(join(tempDir, "packages", "omo-codex", "scripts"), { recursive: true });
      await writeFile(launcherPath, createPlatformLauncherSource());
      await chmod(launcherPath, 0o755);
      await writeFile(
        installerPath,
        [
          "#!/usr/bin/env node",
          "console.log(`node-installer ${process.argv.slice(2).join(\" \")}`);",
          "",
        ].join("\n"),
      );
      await chmod(installerPath, 0o755);

      // when
      const result = spawnSync(process.execPath, [launcherPath, "install", "--platform=codex", "--no-tui"], {
        encoding: "utf8",
        env: {
          ...process.env,
          BUN_BINARY: join(tempDir, "missing-bun"),
          OMO_INVOCATION_NAME: "omo",
          OMO_WRAPPER_PACKAGE_ROOT: tempDir,
        },
      });

      // then
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("node-installer install --platform=codex --no-tui");
      expect(result.stderr).not.toContain("failed to execute Bun");
    });

    it("launcher preserves lazycodex explicit both-platform install on the Bun CLI path", async () => {
      // given
      const module = await import("./build-binaries.ts");
      const createPlatformLauncherSource = (module as { createPlatformLauncherSource: () => string }).createPlatformLauncherSource;
      const tempDir = await mkdtemp(join(tmpdir(), "lazycodex-both-launcher-"));
      const launcherPath = join(tempDir, "oh-my-opencode.js");
      const installerPath = join(tempDir, "packages", "omo-codex", "scripts", "install-local.mjs");
      await mkdir(join(tempDir, "packages", "omo-codex", "scripts"), { recursive: true });
      await writeFile(launcherPath, createPlatformLauncherSource());
      await chmod(launcherPath, 0o755);
      await writeFakeCli(tempDir);
      await writeFile(installerPath, "#!/usr/bin/env node\nconsole.log('node-installer');\n");
      await chmod(installerPath, 0o755);

      // when
      const result = spawnSync(process.execPath, [launcherPath, "--platform=both", "install", "--no-tui"], {
        encoding: "utf8",
        env: {
          ...process.env,
          BUN_BINARY: process.execPath,
          OMO_INVOCATION_NAME: "lazycodex-ai",
          OMO_WRAPPER_PACKAGE_ROOT: tempDir,
        },
      });

      // then
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("bun-cli");
      expect(normalizeOutputPath(result.stdout)).toContain("dist/cli/index.js --platform=both install --no-tui");
      expect(result.stdout).not.toContain("node-installer");
    });

    it("launcher routes lazycodex sparkshell through the Bun CLI instead of the installer", async () => {
      // given
      const module = await import("./build-binaries.ts");
      const createPlatformLauncherSource = (module as { createPlatformLauncherSource: () => string }).createPlatformLauncherSource;
      const tempDir = await mkdtemp(join(tmpdir(), "lazycodex-sparkshell-launcher-"));
      const launcherPath = join(tempDir, "oh-my-opencode.js");
      await writeFile(launcherPath, createPlatformLauncherSource());
      await chmod(launcherPath, 0o755);
      await writeFakeCli(tempDir);

      // when
      const result = spawnSync(process.execPath, [launcherPath, "sparkshell", "printf", "ok"], {
        encoding: "utf8",
        env: {
          ...process.env,
          BUN_BINARY: process.execPath,
          OMO_INVOCATION_NAME: "lazycodex-ai",
          OMO_WRAPPER_PACKAGE_ROOT: tempDir,
        },
      });

      // then
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("bun-cli");
      expect(normalizeOutputPath(result.stdout)).toContain("dist/cli/index.js sparkshell printf ok");
      expect(result.stdout).not.toContain("Unsupported lazycodex-ai command");
    });

    it("has descriptions mentioning no AVX2 for baseline platforms", async () => {
      // given
      const module = await import("./build-binaries.ts");
      const platforms = (module as { PLATFORMS: { target: string; description: string }[] }).PLATFORMS;

      // when
      const baselinePlatforms = platforms.filter((p) => p.target.includes("baseline"));

      // then
      for (const platform of baselinePlatforms) {
        expect(platform.description).toContain("no AVX2");
      }
    });

    it("keeps platform packages internal without direct public bins", () => {
      // given
      const packagesDir = new URL("../packages/", import.meta.url);
      const platformPackageNames = readdirSync(packagesDir)
        .filter((entry) => entry.startsWith("oh-my-opencode-"))
        .sort();

      // when
      const platformPackageJsons = platformPackageNames.map((packageName) => ({
        packageName,
        manifest: readFileSync(new URL(`${packageName}/package.json`, packagesDir), "utf8"),
      }));

      // then
      expect(platformPackageNames.length).toBeGreaterThan(0);
      for (const { packageName, manifest } of platformPackageJsons) {
        expect(manifest).toContain('"files"');
        expect(manifest).toContain('"bin"');
        expect(manifest, `${packageName} must not expose a public package.json bin`).not.toContain('"bin": {');
      }
    });
  });
});
