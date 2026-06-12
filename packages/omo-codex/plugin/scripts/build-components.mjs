#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const workspaces = Array.isArray(packageJson.workspaces) ? packageJson.workspaces : [];
const workspaceSet = new Set(workspaces);

for (const workspace of workspaces) {
	if (typeof workspace !== "string" || !workspace.startsWith("components/")) continue;
	if (!(await hasBuildScript(workspace))) continue;

	console.log(`Building ${workspace}`);
	runBuild(["run", "--workspace", workspace, "build"], root);
}

for (const componentName of await readStandaloneComponentNames()) {
	const componentPath = `components/${componentName}`;
	if (!(await hasBuildScript(componentPath))) continue;

	console.log(`Building ${componentPath} (standalone)`);
	runBuild(["run", "build"], join(root, componentPath));
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

function runBuild(npmArgs, cwd) {
	const result = spawnSync("npm", npmArgs, {
		cwd,
		shell: process.platform === "win32",
		stdio: "inherit",
	});
	if (result.error !== undefined) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}
