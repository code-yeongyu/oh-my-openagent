#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findPackageRoot } from "../senpi-compat/package-root.mjs";

export function main(argv = process.argv.slice(2)) {
  const packageRoot = findPackageRoot(import.meta.url);
  const result = spawnSync("senpi", ["-e", packageRoot, ...argv], {
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`omoai failed to launch senpi: ${result.error.message}`);
    return 1;
  }
  if (result.signal) {
    console.error(`omoai senpi exited from signal ${result.signal}`);
    return 1;
  }
  return result.status ?? 1;
}

function isMainModule() {
  const invokedPath = process.argv[1];
  return invokedPath !== undefined && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(invokedPath);
}

if (isMainModule()) {
  process.exitCode = main();
}
