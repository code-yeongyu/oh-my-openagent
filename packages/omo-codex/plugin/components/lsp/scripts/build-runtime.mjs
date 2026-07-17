#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { builtinModules } from "node:module";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = 1;
const componentRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(componentRoot, "dist");
const manifestPath = join(distDir, ".omo-runtime-manifest.json");
const builtinSpecifiers = new Set([
	...builtinModules,
	...builtinModules.map((name) => `node:${name}`),
]);

if (!existsSync(join(componentRoot, "src"))) {
	validateDistOnlyManifest();
	process.exit(0);
}

if (isManifestFresh()) {
	process.exit(0);
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
run("tsc", ["-p", "tsconfig.build.json"]);
run("bun", [
	"build",
	"src/cli.ts",
	"--target",
	"node",
	"--format",
	"esm",
	"--outfile",
	"dist/cli.js",
]);
assertBuiltinOnlyCli();
writeManifest();
validateManifest({ requireFreshInputs: true });

function run(command, args) {
	const result = spawnSync(command, args, {
		cwd: componentRoot,
		shell: process.platform === "win32",
		stdio: "inherit",
	});
	if (result.error !== undefined) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

function isManifestFresh() {
	try {
		validateManifest({ requireFreshInputs: true });
		return true;
	} catch (error) {
		if (error instanceof Error) return false;
		throw error;
	}
}

function validateDistOnlyManifest() {
	try {
		validateManifest({ requireFreshInputs: false });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Invalid installed codex-lsp runtime manifest: ${message}`);
		process.exit(1);
	}
}

function validateManifest({ requireFreshInputs }) {
	const manifest = readManifest();
	if (manifest.schemaVersion !== SCHEMA_VERSION) throw new Error("unsupported manifest schemaVersion");
	if (manifest.version !== packageVersion()) throw new Error("manifest version is stale");
	if (requireFreshInputs && manifest.inputDigest !== inputDigest()) throw new Error("manifest inputDigest is stale");
	const outputs = [...manifest.outputs].sort((left, right) => left.path.localeCompare(right.path));
	if (JSON.stringify(outputs) !== JSON.stringify(manifest.outputs)) throw new Error("manifest outputs are not sorted");
	for (const output of outputs) {
		const outputPath = join(distDir, output.path);
		if (!existsSync(outputPath)) throw new Error(`manifest output is missing: ${output.path}`);
		if (sha256File(outputPath) !== output.sha256) throw new Error(`manifest output hash mismatch: ${output.path}`);
	}
}

function readManifest() {
	if (!existsSync(manifestPath)) throw new Error("manifest is missing");
	const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
	if (!isRecord(parsed)) throw new Error("manifest must be an object");
	if (parsed.schemaVersion !== SCHEMA_VERSION) throw new Error("manifest schemaVersion must be 1");
	if (typeof parsed.version !== "string") throw new Error("manifest version must be a string");
	if (typeof parsed.inputDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(parsed.inputDigest)) {
		throw new Error("manifest inputDigest must be sha256:<64hex>");
	}
	if (!Array.isArray(parsed.outputs) || !parsed.outputs.every(isManifestOutput)) {
		throw new Error("manifest outputs are malformed");
	}
	return parsed;
}

function isManifestOutput(value) {
	return (
		isRecord(value) &&
		typeof value.path === "string" &&
		value.path.length > 0 &&
		!value.path.includes("..") &&
		typeof value.sha256 === "string" &&
		/^[0-9a-f]{64}$/.test(value.sha256)
	);
}

function writeManifest() {
	const manifest = {
		schemaVersion: SCHEMA_VERSION,
		version: packageVersion(),
		inputDigest: inputDigest(),
		outputs: outputFiles().map((path) => ({ path, sha256: sha256File(join(distDir, path)) })),
	};
	manifest.outputs.sort((left, right) => left.path.localeCompare(right.path));
	const tempPath = join(distDir, `.omo-runtime-manifest.${process.pid}.tmp`);
	writeFileSync(tempPath, `${JSON.stringify(manifest, null, 2)}\n`);
	renameSync(tempPath, manifestPath);
}

function inputDigest() {
	const hash = createHash("sha256");
	for (const path of inputFiles()) {
		hash.update(path);
		hash.update("\0");
		hash.update(sha256File(join(componentRoot, path)));
		hash.update("\0");
	}
	return `sha256:${hash.digest("hex")}`;
}

function inputFiles() {
	return [
		"package.json",
		"tsconfig.json",
		"tsconfig.build.json",
		"scripts/build-runtime.mjs",
		...walk(join(componentRoot, "src")).map((path) => relative(componentRoot, path)),
	].sort();
}

function outputFiles() {
	return walk(distDir)
		.map((path) => relative(distDir, path))
		.filter((path) => path !== ".omo-runtime-manifest.json")
		.sort();
}

function walk(root) {
	const entries = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			entries.push(...walk(path));
		} else if (entry.isFile()) {
			entries.push(path);
		}
	}
	return entries;
}

function assertBuiltinOnlyCli() {
	const source = readFileSync(join(distDir, "cli.js"), "utf8");
	const specifiers = [
		...source.matchAll(/\bimport\s+(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g),
		...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
	].map((match) => match[1]);
	const invalid = specifiers.filter((specifier) => !builtinSpecifiers.has(specifier));
	if (invalid.length > 0) {
		throw new Error(`dist/cli.js has non-builtin runtime imports: ${invalid.join(", ")}`);
	}
}

function packageVersion() {
	const parsed = JSON.parse(readFileSync(join(componentRoot, "package.json"), "utf8"));
	if (!isRecord(parsed) || typeof parsed.version !== "string") throw new Error("package.json version is missing");
	return parsed.version;
}

function sha256File(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
