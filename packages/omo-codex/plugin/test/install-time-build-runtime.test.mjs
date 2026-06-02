import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("#given aggregate build scripts #when inspected #then install-time build does not invoke Bun", async () => {
	// given
	const buildComponentsScript = await readFile(join(root, "scripts", "build-components.mjs"), "utf8");
	const buildBundledMcpRuntimesScript = await readFile(join(root, "scripts", "build-bundled-mcp-runtimes.mjs"), "utf8");

	// when
	const installTimeBuildScripts = [buildComponentsScript, buildBundledMcpRuntimesScript].join("\n");

	// then
	assert.doesNotMatch(installTimeBuildScripts, /spawnSync\("bun"/);
	assert.doesNotMatch(installTimeBuildScripts, /\bbun\s+run\b/);
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
