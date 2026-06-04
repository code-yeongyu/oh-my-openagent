#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const workspaces = Array.isArray(packageJson.workspaces) ? packageJson.workspaces : [];

for (const workspace of workspaces) {
	if (typeof workspace !== "string" || !workspace.startsWith("components/")) continue;
	const workspacePackageJson = JSON.parse(await readFile(join(root, workspace, "package.json"), "utf8"));
	if (typeof workspacePackageJson.scripts?.build !== "string") continue;

	console.log(`Building ${workspace}`);
	const result = spawnSync("npm", ["run", "--workspace", workspace, "build"], {
		cwd: root,
		shell: process.platform === "win32",
		stdio: "inherit",
	});
	if (result.error !== undefined) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}
