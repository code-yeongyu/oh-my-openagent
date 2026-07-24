#!/usr/bin/env bun
// script/build-binaries.ts
// Build platform-specific binaries for CLI distribution

import { $ } from "bun";
import { existsSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface PlatformTarget {
  platform: string;
  packageName: string;
  packageDir: string;
  target: string;
  binary: string;
  description: string;
}

export const PLATFORMS: PlatformTarget[] = [
  { platform: "darwin-arm64", packageName: "oh-my-opencode-darwin-arm64", packageDir: "oh-my-opencode-darwin-arm64", target: "bun-darwin-arm64", binary: "oh-my-opencode.js", description: "macOS ARM64" },
  { platform: "darwin-x64", packageName: "oh-my-opencode-darwin-x64", packageDir: "oh-my-opencode-darwin-x64", target: "bun-darwin-x64", binary: "oh-my-opencode.js", description: "macOS x64" },
  { platform: "darwin-x64-baseline", packageName: "oh-my-opencode-darwin-x64-baseline", packageDir: "oh-my-opencode-darwin-x64-baseline", target: "bun-darwin-x64-baseline", binary: "oh-my-opencode.js", description: "macOS x64 (no AVX2)" },
  { platform: "linux-x64", packageName: "oh-my-opencode-linux-x64", packageDir: "oh-my-opencode-linux-x64", target: "bun-linux-x64", binary: "oh-my-opencode.js", description: "Linux x64 (glibc)" },
  { platform: "linux-x64-baseline", packageName: "oh-my-opencode-linux-x64-baseline", packageDir: "oh-my-opencode-linux-x64-baseline", target: "bun-linux-x64-baseline", binary: "oh-my-opencode.js", description: "Linux x64 (glibc, no AVX2)" },
  { platform: "linux-arm64", packageName: "oh-my-opencode-linux-arm64", packageDir: "oh-my-opencode-linux-arm64", target: "bun-linux-arm64", binary: "oh-my-opencode.js", description: "Linux ARM64 (glibc)" },
  { platform: "linux-x64-musl", packageName: "oh-my-opencode-linux-x64-musl", packageDir: "oh-my-opencode-linux-x64-musl", target: "bun-linux-x64-musl", binary: "oh-my-opencode.js", description: "Linux x64 (musl)" },
  { platform: "linux-x64-musl-baseline", packageName: "oh-my-opencode-linux-x64-musl-baseline", packageDir: "oh-my-opencode-linux-x64-musl-baseline", target: "bun-linux-x64-musl-baseline", binary: "oh-my-opencode.js", description: "Linux x64 (musl, no AVX2)" },
  { platform: "linux-arm64-musl", packageName: "oh-my-opencode-linux-arm64-musl", packageDir: "oh-my-opencode-linux-arm64-musl", target: "bun-linux-arm64-musl", binary: "oh-my-opencode.js", description: "Linux ARM64 (musl)" },
  { platform: "windows-x64", packageName: "oh-my-opencode-windows-x64", packageDir: "oh-my-opencode-windows-x64", target: "bun-windows-x64", binary: "oh-my-opencode.js", description: "Windows x64" },
  { platform: "windows-x64-baseline", packageName: "oh-my-opencode-windows-x64-baseline", packageDir: "oh-my-opencode-windows-x64-baseline", target: "bun-windows-x64-baseline", binary: "oh-my-opencode.js", description: "Windows x64 (no AVX2)" },
  { platform: "windows-arm64", packageName: "oh-my-opencode-windows-arm64", packageDir: "oh-my-opencode-windows-arm64", target: "bun-windows-x64", binary: "oh-my-opencode.js", description: "Windows ARM64 (x64 emulation / node fallback)" },
];

const CLI_DIST_ENTRY = "dist/cli/index.js";

export function createPlatformLauncherSource(): string {
  return `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join } = require("node:path");

const wrapperPackageRoot = process.env.OMO_WRAPPER_PACKAGE_ROOT;
const lazyCodexInvocationNames = new Set(["lazycodex", "lazycodex-ai"]);
const lazyCodexInstallerCommands = new Set(["install", "setup", "update", "uninstall", "cleanup"]);

if (!wrapperPackageRoot) {
  console.error("oh-my-opencode: OMO_WRAPPER_PACKAGE_ROOT is required to launch the packaged CLI.");
  process.exit(2);
}

function exitFromResult(result, failureLabel) {
  if (result.error) {
    console.error(\`oh-my-opencode: \${failureLabel}: \${result.error.message}\`);
    process.exit(2);
  }

  if (result.signal) {
    const signalCodes = { SIGINT: 2, SIGILL: 4, SIGKILL: 9, SIGTERM: 15 };
    process.exit(128 + (signalCodes[result.signal] ?? 1));
  }

  process.exit(result.status ?? 1);
}

function shouldRunLazyCodexInstaller() {
  const args = process.argv.slice(2);
  const command = readInstallerCommand(args);
  const platformArg = readPlatformArg(args);
  if (lazyCodexInvocationNames.has(process.env.OMO_INVOCATION_NAME ?? "")) {
    if ((command === "install" || command === "setup") && platformArg !== undefined && platformArg !== "codex") {
      return false;
    }
    return command === undefined ||
    command === "--help" ||
    command === "-h" ||
    command === "--version" ||
    command === "-v" ||
    lazyCodexInstallerCommands.has(command);
  }

  return (command === "install" || command === "setup") && platformArg === "codex";
}

function readInstallerCommand(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--platform" || arg === "--repo-root") {
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) continue;
    return arg;
  }
  return undefined;
}

function readPlatformArg(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--platform") {
      return args[index + 1];
    }
    if (arg.startsWith("--platform=")) {
      return arg.slice("--platform=".length);
    }
  }
  return undefined;
}

if (shouldRunLazyCodexInstaller()) {
  const lazyCodexInstallerPath = join(wrapperPackageRoot, "packages", "omo-codex", "scripts", "install-local.mjs");

  if (!existsSync(lazyCodexInstallerPath)) {
    console.error(\`oh-my-opencode: lazycodex installer not found at \${lazyCodexInstallerPath}\`);
    process.exit(2);
  }

  const result = spawnSync(process.execPath, [lazyCodexInstallerPath, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
  });
  exitFromResult(result, "failed to execute lazycodex Node installer");
}

const cliPath = join(wrapperPackageRoot, "dist", "cli", "index.js");
const nodeCliPath = join(wrapperPackageRoot, "dist", "cli-node", "index.js");

if (!existsSync(cliPath)) {
  console.error(\`oh-my-opencode: packaged CLI not found at \${cliPath}\`);
  process.exit(2);
}

function runNodeCli(reason) {
  if (!existsSync(nodeCliPath)) return;
  if (reason) {
    console.error(\`oh-my-opencode: \${reason}; falling back to the node CLI at \${nodeCliPath}\`);
  }
  const result = spawnSync(process.execPath, [nodeCliPath, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
  });
  exitFromResult(result, "failed to execute the node CLI");
}

if (process.env.OMO_RUNTIME === "node") {
  runNodeCli();
}

const bunBinary = process.env.BUN_BINARY || "bun";
const result = spawnSync(bunBinary, [cliPath, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  runNodeCli(\`bun is not available (\${result.error.message})\`);
}

if (result.signal === "SIGILL") {
  runNodeCli("bun crashed with SIGILL - this CPU lacks the instruction set bun requires (x86-64-v2/SSE4.2 or newer)");
}

exitFromResult(result, "failed to execute Bun");
`;
}

async function buildPlatform(platform: PlatformTarget): Promise<boolean> {
  const outfile = join("packages", platform.packageDir, "bin", platform.binary);

  console.log(`\n📦 Generating ${platform.description} launcher...`);
  console.log(`   Output: ${outfile}`);

  try {
    await mkdir(join("packages", platform.packageDir, "bin"), { recursive: true });
    await writeFile(outfile, createPlatformLauncherSource());
    await chmod(outfile, 0o755);

    if (!existsSync(outfile)) {
      console.error(`   ❌ Launcher not found after build: ${outfile}`);
      return false;
    }

    if (process.platform !== "win32") {
      const fileInfo = await $`file ${outfile}`.text();
      console.log(`   ✓ ${fileInfo.trim()}`);
    } else {
      console.log(`   ✓ Binary created successfully`);
    }

    return true;
  } catch (error) {
    console.error(`   ❌ Build failed: ${error}`);
    return false;
  }
}

async function main() {
  console.log("🔨 Building oh-my-opencode platform launchers");
  console.log(`   CLI entry: ${CLI_DIST_ENTRY}`);
  console.log(`   Platforms: ${PLATFORMS.length}`);

  const results: { platform: string; success: boolean }[] = [];

  for (const platform of PLATFORMS) {
    const success = await buildPlatform(platform);
    results.push({ platform: platform.description, success });
  }

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("Build Summary:");
  console.log("=".repeat(50));

  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  for (const result of results) {
    const icon = result.success ? "✓" : "✗";
    console.log(`  ${icon} ${result.platform}`);
  }

  console.log("=".repeat(50));
  console.log(`Total: ${succeeded} succeeded, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }

  console.log("\n✅ All platform binaries built successfully!\n");
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
