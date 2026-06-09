#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const lspDaemonDir = join(here, "..", "..", "..", "..", "..", "lsp-daemon");
const packageJson = join(lspDaemonDir, "package.json");
const requiredOutputs = [
	join(lspDaemonDir, "dist", "cli.js"),
	join(lspDaemonDir, "dist", "index.js"),
	join(lspDaemonDir, "dist", "index.d.ts"),
];
const force = process.argv.includes("--force");

if (!force && isBuildFresh(packageJson, requiredOutputs)) {
	process.exit(0);
}

if (!existsSync(packageJson)) {
	if (!force && requiredOutputs.every((path) => existsSync(path))) {
		console.log("Using bundled lsp-daemon dist.");
		process.exit(0);
	}
	console.error(`lsp-daemon package metadata is missing at ${packageJson}; build packages/lsp-daemon before codex-lsp`);
	process.exit(1);
}

console.log("Installing repository lsp-daemon dependencies...");
execSync("npm ci", { cwd: lspDaemonDir, stdio: "inherit" });

console.log("Building repository lsp-daemon...");
execSync("npm run build", { cwd: lspDaemonDir, stdio: "inherit" });

console.log("Done.");

function isBuildFresh(inputPath, outputPaths) {
	if (!existsSync(inputPath)) return false;
	if (outputPaths.some((path) => !existsSync(path))) return false;
	const inputMtime = statSync(inputPath).mtimeMs;
	return outputPaths.every((path) => statSync(path).mtimeMs >= inputMtime);
}
