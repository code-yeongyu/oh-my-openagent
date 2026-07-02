import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "bun:test";
import { packageRoot } from "./installer-test-support";

export function createLinkedNpmBin(
  globalModulesDir: string,
  linkedPackageRoot: string,
  symlinkedBin: string,
  binRelativePath: string,
): string {
  const setup = spawnSync(
    process.execPath,
    [
      "-e",
      `
const { mkdirSync, symlinkSync } = require("node:fs");
const { join } = require("node:path");
const [globalModulesDir, packageRoot, linkedPackageRoot, symlinkedBin, binRelativePath] = process.argv.slice(1);
mkdirSync(globalModulesDir, { recursive: true });
symlinkSync(packageRoot, linkedPackageRoot, process.platform === "win32" ? "junction" : "dir");
const target = join(linkedPackageRoot, binRelativePath);
if (process.platform === "win32") {
  console.log(target);
  process.exit(0);
}
symlinkSync(target, symlinkedBin, "file");
console.log(symlinkedBin);
`,
      globalModulesDir,
      packageRoot,
      linkedPackageRoot,
      symlinkedBin,
      binRelativePath,
    ],
    { encoding: "utf8" },
  );
  expect(setup.status).toBe(0);
  expect(setup.stderr.trim()).toBe("");
  return setup.stdout.trim();
}

export function createFakeSenpi(fakeSenpiDir: string, capturePath: string): void {
  mkdirSync(fakeSenpiDir, { recursive: true });
  const senpiPath = join(fakeSenpiDir, process.platform === "win32" ? "senpi.cmd" : "senpi");
  if (process.platform === "win32") {
    writeFileSync(
      senpiPath,
      `@echo off\r\n"${process.execPath}" -e "require('node:fs').writeFileSync(process.argv[1], JSON.stringify({ argv: process.argv.slice(2) }))" "${capturePath}" %*\r\n`,
      "utf8",
    );
  } else {
    writeFileSync(
      senpiPath,
      `#!/bin/sh\nexec "${process.execPath}" -e 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({ argv: process.argv.slice(2) }))' "${capturePath}" "$@"\n`,
      "utf8",
    );
    const chmod = spawnSync("chmod", ["755", senpiPath], { encoding: "utf8" });
    expect(chmod.status).toBe(0);
    expect(chmod.stderr.trim()).toBe("");
  }
}
