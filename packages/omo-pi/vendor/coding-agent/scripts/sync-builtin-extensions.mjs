#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listSourceFiles, transformVendoredSource } from "./vendor-transform.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const workspaceRoot = resolve(packageDir, "..", "..");
const defaultSourceRoot = resolve(workspaceRoot, "..", "pi-extensions");
const sourceRoot = resolve(process.env.SENPI_BUILTIN_EXTENSIONS_SOURCE ?? defaultSourceRoot);
const builtinRoot = join(packageDir, "src", "core", "extensions", "builtin");

// DIR_SYNCS auto-copy a package's src/ tree into builtin/<id>/, rewriting the standalone
// package's published-API imports to senpi internals via transformVendoredSource. Only
// packages whose senpi adaptation is FULLY captured by that mechanical transform belong here.
const DIR_SYNCS = [{ id: "bash-timeout", packageDir: "pi-bash-timeout" }];

// MANUAL_PACKAGES are vendored builtins whose senpi copy has diverged beyond the mechanical
// import transform, so re-copying would clobber hand-maintained changes. We still record their
// upstream version in external-versions.json (source-of-truth metadata + builtin-extension-sync
// test) without auto-overwriting the files. Port behavior changes manually.
//   - gpt-apply-patch (pi-apply-patch): senpi keeps a refactored multi-file layout vs the
//     upstream single-file monolith.
//   - todowrite (pi-todotools): senpi removed the todo continuation feature.
//   - goal (pi-goal): senpi resolves the agent dir via config (getAgentDir) and types via
//     ../../types.ts instead of the standalone package's local agentDir()/peer-dep imports.
//   - websearch/webfetch/nested-agents-md/rules: vendored with transformVendoredSource, then
//     hand-patched for senpi's erasableSyntaxOnly rule (no parameter properties) and the absence
//     of DOM globals (HeadersInit).
const MANUAL_PACKAGES = [
	{ id: "gpt-apply-patch", packageDir: "pi-apply-patch" },
	{ id: "todowrite", packageDir: "pi-todotools" },
	{ id: "goal", packageDir: "pi-goal" },
	{ id: "websearch", packageDir: "pi-websearch" },
	{ id: "webfetch", packageDir: "pi-webfetch" },
	{ id: "nested-agents-md", packageDir: "pi-nested-agents-md" },
	{ id: "rules", packageDir: "pi-rules" },
];

function readPackageMetadata(packageName) {
	const packageJsonPath = join(sourceRoot, packageName, "package.json");
	const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
	return {
		packageName: packageJson.name,
		version: packageJson.version,
		source: `../pi-extensions/${packageName}`,
	};
}

if (!existsSync(sourceRoot)) {
	console.log(`[sync-builtin-extensions] source not found, keeping vendored snapshot: ${sourceRoot}`);
	process.exit(0);
}

for (const entry of DIR_SYNCS) {
	const srcDir = join(sourceRoot, entry.packageDir, "src");
	if (!existsSync(srcDir)) {
		throw new Error(`missing source dir: ${srcDir}`);
	}
	for (const file of listSourceFiles(srcDir)) {
		const target = join(builtinRoot, entry.id, relative(srcDir, file));
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, transformVendoredSource(readFileSync(file, "utf-8"), target, builtinRoot), "utf-8");
	}
}

const manifest = { extensions: {} };
for (const packageEntry of [...DIR_SYNCS, ...MANUAL_PACKAGES]) {
	manifest.extensions[packageEntry.id] = readPackageMetadata(packageEntry.packageDir);
}
writeFileSync(join(builtinRoot, "external-versions.json"), `${JSON.stringify(manifest, null, "\t")}\n`, "utf-8");

console.log(`[sync-builtin-extensions] synced from ${sourceRoot}`);
