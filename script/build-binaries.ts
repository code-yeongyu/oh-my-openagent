#!/usr/bin/env bun
// script/build-binaries.ts
// Build platform-specific binaries for CLI distribution

import { $ } from "bun";
import { existsSync } from "node:fs";
import { join } from "node:path";

interface PlatformTarget {
  dir: string;
  target: string;
  binary: string;
  description: string;
}

export const PLATFORMS: PlatformTarget[] = [
  { dir: "darwin-arm64", target: "bun-darwin-arm64", binary: "oh-my-opencode", description: "macOS ARM64" },
  { dir: "darwin-x64", target: "bun-darwin-x64", binary: "oh-my-opencode", description: "macOS x64" },
  { dir: "darwin-x64-baseline", target: "bun-darwin-x64-baseline", binary: "oh-my-opencode", description: "macOS x64 (no AVX2)" },
  { dir: "linux-x64", target: "bun-linux-x64", binary: "oh-my-opencode", description: "Linux x64 (glibc)" },
  { dir: "linux-x64-baseline", target: "bun-linux-x64-baseline", binary: "oh-my-opencode", description: "Linux x64 (glibc, no AVX2)" },
  { dir: "linux-arm64", target: "bun-linux-arm64", binary: "oh-my-opencode", description: "Linux ARM64 (glibc)" },
  { dir: "linux-x64-musl", target: "bun-linux-x64-musl", binary: "oh-my-opencode", description: "Linux x64 (musl)" },
  { dir: "linux-x64-musl-baseline", target: "bun-linux-x64-musl-baseline", binary: "oh-my-opencode", description: "Linux x64 (musl, no AVX2)" },
  { dir: "linux-arm64-musl", target: "bun-linux-arm64-musl", binary: "oh-my-opencode", description: "Linux ARM64 (musl)" },
  { dir: "windows-x64", target: "bun-windows-x64", binary: "oh-my-opencode.exe", description: "Windows x64" },
  { dir: "windows-x64-baseline", target: "bun-windows-x64-baseline", binary: "oh-my-opencode.exe", description: "Windows x64 (no AVX2)" },
];

const ENTRY_POINT = "src/cli/index.ts";

async function buildPlatform(platform: PlatformTarget): Promise<boolean> {
  const outfile = join("packages", platform.dir, "bin", platform.binary);

  console.log(`\n📦 Building ${platform.description}...`);
  console.log(`   Target: ${platform.target}`);
  console.log(`   Output: ${outfile}`);

  try {
    await $`bun build --compile --minify --sourcemap --bytecode --target=${platform.target} ${ENTRY_POINT} --outfile=${outfile}`;

    // Verify binary exists
    if (!existsSync(outfile)) {
      console.error(`   ❌ Binary not found after build: ${outfile}`);
      return false;
    }

    // Verify binary with file command (skip on Windows host for non-Windows targets)
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
  console.log("🔨 Building oh-my-opencode platform binaries");
  console.log(`   Entry point: ${ENTRY_POINT}`);
  console.log(`   Platforms: ${PLATFORMS.length}`);

  // Verify entry point exists
  if (!existsSync(ENTRY_POINT)) {
    console.error(`\n❌ Entry point not found: ${ENTRY_POINT}`);
    process.exit(1);
  }

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

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
