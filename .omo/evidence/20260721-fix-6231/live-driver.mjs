// Live-surface driver for issue #6231 (run with: bun .omo/evidence/20260721-fix-6231/live-driver.mjs)
//
// Reproduces exactly how a platform package ships and how node loads the launcher on the
// failing path: writes the REAL createPlatformLauncherSource() output as bin/oh-my-opencode.js
// inside a directory whose package.json does NOT declare "type": "module" (the shipped
// oh-my-openagent-<os>-<arch> layout), then loads it with `node --no-experimental-detect-module`
// (the CJS interpretation used by node < 22.7 / detection-off, where the reporter hit the crash).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { createPlatformLauncherSource } from "../../../script/build-binaries.ts";

const dir = mkdtempSync(join(tmpdir(), "omo-6231-live-"));
writeFileSync(
	join(dir, "package.json"),
	JSON.stringify({ name: "oh-my-openagent-windows-x64", version: "0.0.0", os: ["win32"], cpu: ["x64"], files: ["bin"] }),
);
const launcher = join(dir, "oh-my-opencode.js");
writeFileSync(launcher, createPlatformLauncherSource());

console.log("launcher import line:", createPlatformLauncherSource().split("\n")[1]);
const r = spawnSync("node", ["--no-experimental-detect-module", launcher], {
	encoding: "utf8",
	env: { PATH: process.env.PATH ?? "" },
});
console.log("node exit    :", r.status);
console.log("node stderr  :", (r.stderr || "").trim().split(/\r?\n/).slice(0, 3).join(" | "));

const noSyntaxError = !(r.stderr || "").includes("Cannot use import statement outside a module");
const reachedGuard = (r.stderr || "").includes("OMO_WRAPPER_PACKAGE_ROOT is required");
const ok = noSyntaxError && reachedGuard;
console.log(ok ? "RESULT: PASS - launcher loads under node and reaches its own guard" : "RESULT: FAIL - launcher crashed with a module SyntaxError before running");
rmSync(dir, { recursive: true, force: true });
process.exitCode = ok ? 0 : 1;
