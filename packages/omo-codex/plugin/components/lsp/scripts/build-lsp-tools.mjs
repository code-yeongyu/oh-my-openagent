#!/usr/bin/env node
// Build the repository-level lsp-tools-mcp package used by codex-lsp.
import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const lspToolsDir = join(__dirname, "..", "..", "..", "..", "..", "lsp-tools-mcp");
const packageJson = join(lspToolsDir, "package.json");
const requiredOutputPaths = ["dist/cli.js", "dist/tools.js", "dist/lsp/manager.js"];
const requiredOutputs = requiredOutputPaths.map((path) => join(lspToolsDir, path));
const force = process.argv.includes("--force");

if (!force && isBuildFresh(packageJson, requiredOutputs)) {
	process.exit(0);
}

if (!existsSync(packageJson)) {
	const bundledRuntimeRoot = findBundledRuntimeRoot();
	if (!force && bundledRuntimeRoot) {
		console.log(`Using bundled lsp-tools-mcp dist at ${bundledRuntimeRoot}.`);
		process.exit(0);
	}
	console.error(
		`lsp-tools-mcp package metadata is missing at ${packageJson}; checked bundled runtime dist candidates: ${getBundledRuntimeRootCandidates().join(", ")}; build packages/lsp-tools-mcp before codex-lsp`,
	);
	process.exit(1);
}

console.log("Installing repository lsp-tools-mcp dependencies...");
execSync("npm ci", { cwd: lspToolsDir, stdio: "inherit" });

console.log("Building repository lsp-tools-mcp...");
execSync("npm run build", { cwd: lspToolsDir, stdio: "inherit" });

console.log("Done.");

function isBuildFresh(inputPath, outputPaths) {
	if (!existsSync(inputPath)) return false;
	if (outputPaths.some((path) => !existsSync(path))) return false;
	const inputMtime = statSync(inputPath).mtimeMs;
	return outputPaths.every((path) => statSync(path).mtimeMs >= inputMtime);
}

function findBundledRuntimeRoot() {
	return getBundledRuntimeRootCandidates().find((root) => requiredOutputPaths.every((path) => existsSync(join(root, path))));
}

function getBundledRuntimeRootCandidates() {
	return [
		lspToolsDir,
		join(__dirname, "..", "..", "lsp-tools-mcp"),
		join(__dirname, "..", "..", "..", "mcp", "lsp"),
	];
}
