#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const componentRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const bundlePath = join(componentRoot, "dist", "cli.js");

const result = spawnSync(
	"bun",
	["x", "esbuild", "src/cli.ts", "--bundle", "--platform=node", "--format=esm", "--outfile=dist/cli.js"],
	{
		cwd: componentRoot,
		shell: process.platform === "win32",
		stdio: "inherit",
	},
);

if (result.error === undefined && result.status === 0) {
	process.exit(0);
}

if (hasBundledDist()) {
	console.log("Using bundled bootstrap dist");
	process.exit(0);
}

console.error(`Bootstrap bundle failed and no bundled dist exists at ${bundlePath}.`);
console.error("Install Bun (used via `bun x esbuild`) or ship a prebuilt dist/cli.js.");
process.exit(result.status === null || result.status === undefined || result.status === 0 ? 1 : result.status);

function hasBundledDist() {
	return existsSync(bundlePath) && statSync(bundlePath).size > 0;
}
