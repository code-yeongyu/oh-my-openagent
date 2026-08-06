import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("#given aggregate build scripts #when inspected #then component CLIs are bundled with Bun", async () => {
	// given
	const buildComponentsScript = await readFile(join(root, "scripts", "build-components.mjs"), "utf8");

	// when
	const componentBuildScript = buildComponentsScript;

	// then
	assert.match(componentBuildScript, /"bun", \["build", entry, "--target", "node", "--format", "esm", "--outfile", output\]/);
	assert.doesNotMatch(componentBuildScript, /\bbun\s+run\b/);
});

test("#given aggregate build scripts #when inspected #then npm subprocesses resolve on Windows", async () => {
	// given
	const buildComponentsScript = await readFile(join(root, "scripts", "build-components.mjs"), "utf8");
	const buildBundledMcpRuntimesScript = await readFile(join(root, "scripts", "build-bundled-mcp-runtimes.mjs"), "utf8");

	// when
	const installTimeBuildScripts = [buildComponentsScript, buildBundledMcpRuntimesScript].join("\n");

	// then
	assert.match(installTimeBuildScripts, /process\.platform === "win32"/);
	assert.match(installTimeBuildScripts, /shell: process\.platform === "win32"/);
	assert.doesNotMatch(installTimeBuildScripts, /npm\.cmd/);
});

test("#given bundled MCP runtime builds #when a locked runtime has no node_modules #then npm ci bootstraps it before build", async () => {
	// given
	const buildBundledMcpRuntimesScript = await readFile(join(root, "scripts", "build-bundled-mcp-runtimes.mjs"), "utf8");

	// then
	assert.match(buildBundledMcpRuntimesScript, /package-lock\.json/);
	assert.match(buildBundledMcpRuntimesScript, /spawnSync\("npm", \["ci"\]/);
	assert.match(buildBundledMcpRuntimesScript, /!existsSync\(join\(runtime\.packageRoot, "node_modules"\)\)/);
});
