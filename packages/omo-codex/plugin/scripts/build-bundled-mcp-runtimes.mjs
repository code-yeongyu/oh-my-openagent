#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoPackagesRoot = join(pluginRoot, "..", "..");

const runtimes = [
	{
		label: "lsp-tools-mcp",
		packageRoot: join(repoPackagesRoot, "lsp-tools-mcp"),
		requiredOutputs: ["dist/cli.js", "dist/tools.js"],
	},
	{
		label: "ast-grep-mcp",
		packageRoot: join(repoPackagesRoot, "ast-grep-mcp"),
		requiredOutputs: ["dist/cli.js"],
	},
];

for (const runtime of runtimes) {
	buildRuntime(runtime);
}

function buildRuntime(runtime) {
	if (!existsSync(join(runtime.packageRoot, "package.json"))) {
		assertBundledDist(runtime);
		console.log(`Using bundled ${runtime.label} dist`);
		return;
	}

	const result = spawnSync("bun", ["run", "build"], {
		cwd: runtime.packageRoot,
		stdio: "inherit",
	});
	if (result.error !== undefined) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

function assertBundledDist(runtime) {
	const missingOutputs = runtime.requiredOutputs.filter((output) => !existsSync(join(runtime.packageRoot, output)));
	if (missingOutputs.length === 0) return;
	console.error(`Missing bundled ${runtime.label} outputs:`);
	for (const output of missingOutputs) {
		console.error(`  ${join(runtime.packageRoot, output)}`);
	}
	process.exit(1);
}
