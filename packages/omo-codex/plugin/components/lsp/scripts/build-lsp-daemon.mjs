#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync, statSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const componentRoot = join(here, "..");
const force = process.argv.includes("--force");

// Ordered candidate list:
// (1) 5-up repo sibling — has package.json, can be built (repo checkout layout)
// (2) 2-up components sibling — bundled dist-only inside the installed plugin cache
const candidates = [
	join(here, "..", "..", "..", "..", "..", "lsp-daemon"),
	join(here, "..", "..", "lsp-daemon"),
];

function requiredOutputs(dir) {
	return [
		join(dir, "dist", "cli.js"),
		join(dir, "dist", "client.js"),
		join(dir, "dist", "client.d.ts"),
		join(dir, "dist", "index.js"),
		join(dir, "dist", "index.d.ts"),
	];
}

// Phase 1: find the first buildable candidate (package.json present).
// --force skips the freshness check but does NOT prevent using a buildable candidate.
for (const dir of candidates) {
	const packageJson = join(dir, "package.json");
	if (existsSync(packageJson)) {
		const outputs = requiredOutputs(dir);
		if (!force && isBuildFresh(packageJson, outputs)) {
			ensureComponentPackageLink(dir);
			process.exit(0);
		}
		console.log("Installing repository lsp-daemon dependencies...");
		execSync("npm ci", { cwd: dir, stdio: "inherit" });
		console.log("Building repository lsp-daemon...");
		execSync("npm run build", { cwd: dir, stdio: "inherit" });
		ensureComponentPackageLink(dir);
		console.log("Done.");
		process.exit(0);
	}
}

// Phase 2: find the first candidate with all required outputs already present.
// Bundled dist is accepted even under --force — a dist-only layout cannot be rebuilt.
for (const dir of candidates) {
	const outputs = requiredOutputs(dir);
	if (outputs.every((p) => existsSync(p))) {
		ensureComponentPackageLink(dir);
		console.log(`Using bundled lsp-daemon dist at ${dir}.`);
		process.exit(0);
	}
}

// Phase 3: no usable candidate found — enumerate every probed path.
// Keep the primary-candidate error on the first line so the issue's grep stays valid.
const probedPaths = candidates.map((dir) => join(dir, "package.json")).join(", ");
console.error(
	`lsp-daemon package metadata is missing at ${join(candidates[0], "package.json")}; build packages/lsp-daemon before codex-lsp`,
);
console.error(`probed: ${probedPaths}`);
process.exit(1);

function isBuildFresh(inputPath, outputPaths) {
	if (!existsSync(inputPath)) return false;
	if (outputPaths.some((path) => !existsSync(path))) return false;
	const inputMtime = statSync(inputPath).mtimeMs;
	return outputPaths.every((path) => statSync(path).mtimeMs >= inputMtime);
}

function ensureComponentPackageLink(packageDir) {
	const scopeDir = join(componentRoot, "node_modules", "@code-yeongyu");
	const linkPath = join(scopeDir, "lsp-daemon");
	mkdirSync(scopeDir, { recursive: true });
	if (isSymlinkToUsablePackage(linkPath, packageDir)) return;
	rmSync(linkPath, { recursive: true, force: true });
	symlinkSync(packageDir, linkPath, "junction");
}

function isSymlinkToUsablePackage(linkPath, packageDir) {
	try {
		const stat = lstatSync(linkPath);
		return (
			stat.isSymbolicLink() &&
			existsSync(packageDir) &&
			realpathSync(linkPath) === realpathSync(packageDir) &&
			requiredOutputs(linkPath).every((path) => existsSync(path))
		);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}
