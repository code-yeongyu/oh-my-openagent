#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const workspaces = Array.isArray(packageJson.workspaces) ? packageJson.workspaces : [];
const workspaceSet = new Set(workspaces);
const builtinModuleNames = new Set(builtinModules.filter((moduleName) => !moduleName.startsWith("_")));

for (const workspace of workspaces) {
	if (typeof workspace !== "string" || !workspace.startsWith("components/")) continue;
	if (!(await hasBuildScript(workspace))) continue;

	console.log(`Building ${workspace}`);
	run("npm", ["run", "--workspace", workspace, "build"], root);
	await bundleCli(workspace);
}

for (const componentName of await readStandaloneComponentNames()) {
	const componentPath = `components/${componentName}`;
	if (!(await hasBuildScript(componentPath))) continue;

	console.log(`Building ${componentPath} (standalone)`);
	run("npm", ["run", "build"], join(root, componentPath));
	await bundleCli(componentPath);
}

async function readStandaloneComponentNames() {
	const entries = await readdir(join(root, "components"), { withFileTypes: true });
	return entries
		.filter((entry) => entry.isDirectory() && !workspaceSet.has(`components/${entry.name}`))
		.map((entry) => entry.name)
		.sort();
}

async function hasBuildScript(relativePath) {
	let manifest;
	try {
		manifest = JSON.parse(await readFile(join(root, relativePath, "package.json"), "utf8"));
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
	return typeof manifest.scripts?.build === "string";
}

async function bundleCli(workspace) {
	const entry = join(root, workspace, "src", "cli.ts");
	const output = join(root, workspace, "dist", "cli.js");
	console.log(`Bundling ${workspace}/dist/cli.js`);
	run("bun", ["build", entry, "--target", "node", "--format", "esm", "--outfile", output], root);
	await normalizeBuiltinImports(output);
}

function run(command, args, cwd) {
	const result = spawnSync(command, args, {
		cwd,
		shell: process.platform === "win32",
		stdio: "inherit",
	});
	if (result.error !== undefined) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

async function normalizeBuiltinImports(output) {
	const bundled = await readFile(output, "utf8");
	const normalized = bundled.replace(/(from\s+["']|import\s*\(\s*["'])([^"']+)(["'])/g, (match, prefix, specifier, suffix) => {
		if (specifier.startsWith("node:")) return match;
		if (!builtinModuleNames.has(specifier)) return match;
		return `${prefix}node:${specifier}${suffix}`;
	});
	if (normalized !== bundled) {
		await writeFile(output, normalized);
	}
}
