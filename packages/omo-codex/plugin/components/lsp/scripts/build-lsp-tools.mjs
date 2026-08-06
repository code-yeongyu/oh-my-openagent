#!/usr/bin/env node
// Build the repository-level lsp-tools-mcp package used by codex-lsp.
import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const force = process.argv.includes("--force");

// Ordered candidate list:
// (1) 5-up repo sibling — has package.json, can be built (repo checkout layout)
// (2) 2-up components sibling — bundled dist-only inside the installed plugin cache
const candidates = [
	join(__dirname, "..", "..", "..", "..", "..", "lsp-tools-mcp"),
	join(__dirname, "..", "..", "lsp-tools-mcp"),
];

function requiredOutputs(dir) {
	return [
		join(dir, "dist", "cli.js"),
		join(dir, "dist", "tools.js"),
		join(dir, "dist", "lsp", "manager.js"),
	];
}

// Phase 1: find the first buildable candidate (package.json present).
// --force skips the freshness check but does NOT prevent using a buildable candidate.
for (const dir of candidates) {
	const packageJson = join(dir, "package.json");
	if (existsSync(packageJson)) {
		const outputs = requiredOutputs(dir);
		if (!force && isBuildFresh(packageJson, outputs)) {
			process.exit(0);
		}
		console.log("Installing repository lsp-tools-mcp dependencies...");
		execSync("npm ci", { cwd: dir, stdio: "inherit" });
		console.log("Building repository lsp-tools-mcp...");
		execSync("npm run build", { cwd: dir, stdio: "inherit" });
		console.log("Done.");
		process.exit(0);
	}
}

// Phase 2: find the first candidate with all required outputs already present.
// Bundled dist is accepted even under --force — a dist-only layout cannot be rebuilt.
for (const dir of candidates) {
	const outputs = requiredOutputs(dir);
	if (outputs.every((p) => existsSync(p))) {
		console.log(`Using bundled lsp-tools-mcp dist at ${dir}.`);
		process.exit(0);
	}
}

// Phase 3: no usable candidate found — enumerate every probed path.
// Keep the primary-candidate error on the first line so the issue's grep stays valid.
const probedPaths = candidates.map((dir) => join(dir, "package.json")).join(", ");
console.error(
	`lsp-tools-mcp package metadata is missing at ${join(candidates[0], "package.json")}; build packages/lsp-tools-mcp before codex-lsp`,
);
console.error(`probed: ${probedPaths}`);
process.exit(1);

function isBuildFresh(inputPath, outputPaths) {
	if (!existsSync(inputPath)) return false;
	if (outputPaths.some((path) => !existsSync(path))) return false;
	const inputMtime = statSync(inputPath).mtimeMs;
	return outputPaths.every((path) => statSync(path).mtimeMs >= inputMtime);
}
