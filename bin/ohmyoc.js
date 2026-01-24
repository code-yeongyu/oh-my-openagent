#!/usr/bin/env node
// bin/ohmyoc.js
// Convenience wrapper for oh-my-opencode in isolated mode
// Automatically sets OH_MY_OPENCODE_CONFIG_DIR before spawning

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { getPlatformPackage, getBinaryPath } from "./platform.js";

const require = createRequire(import.meta.url);

/**
 * Detect libc family on Linux
 * @returns {string | null | undefined} 'glibc', 'musl', or null if detection fails
 */
function getLibcFamily() {
  if (process.platform !== "linux") {
    return undefined;
  }

  try {
    const detectLibc = require("detect-libc");
    return detectLibc.familySync();
  } catch {
    return undefined;
  }
}

function main() {
  const { platform, arch } = process;
  const libcFamily = getLibcFamily();

  // Set isolated config directory
  const isolatedConfigDir = require("node:os").homedir();
  const configPath = require("node:path").join(isolatedConfigDir, ".config", "oh-my-opencode");
  process.env.OH_MY_OPENCODE_CONFIG_DIR = configPath;

  // Get platform package
  let pkg;
  try {
    pkg = getPlatformPackage({ platform, arch, libcFamily });
  } catch (error) {
    console.error(`\nohmyoc: ${error.message}\n`);
    process.exit(1);
  }

  // Resolve binary path
  const binRelPath = getBinaryPath(pkg, platform);
  let binPath;
  try {
    binPath = require.resolve(binRelPath);
  } catch {
    console.error(`\nohmyoc: Platform binary not installed.`);
    console.error(`\nYour platform: ${platform}-${arch}${libcFamily === "musl" ? "-musl" : ""}`);
    console.error(`Expected package: ${pkg}`);
    console.error(`\nTo fix, run:\n  npm install ${pkg}\n`);
    process.exit(1);
  }

  // Spawn the binary with all arguments passed through
  const result = spawnSync(binPath, process.argv.slice(2), {
    stdio: "inherit",
  });

  // Handle spawn errors
  if (result.error) {
    console.error(`\nohmyoc: Failed to execute binary.`);
    console.error(`Error: ${result.error.message}\n`);
    process.exit(2);
  }

  // Handle signals
  if (result.signal) {
    const signalNum = result.signal === "SIGTERM" ? 15 :
                      result.signal === "SIGKILL" ? 9 :
                      result.signal === "SIGINT" ? 2 : 1;
    process.exit(128 + signalNum);
  }

  process.exit(result.status ?? 1);
}

main();
