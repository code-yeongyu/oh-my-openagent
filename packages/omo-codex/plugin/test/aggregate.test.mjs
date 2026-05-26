import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function readJson(relativePath) {
	return JSON.parse(await readFile(join(root, relativePath), "utf8"));
}

test("#given aggregate plugin manifest #when inspected #then it owns the omo namespace", async () => {
	// given
	const manifest = await readJson(".codex-plugin/plugin.json");

	// when
	const hookPath = manifest.hooks;
	const skillsPath = manifest.skills;
	const mcpPath = manifest.mcpServers;

	// then
	assert.equal(manifest.name, "omo");
	assert.equal(hookPath, "./hooks/hooks.json");
	assert.equal(skillsPath, "./skills/");
	assert.equal(mcpPath, "./.mcp.json");
});

test("#given isolated components #when hooks are inspected #then commands stay inside component roots", async () => {
	// given
	const hooks = await readJson("hooks/hooks.json");
	const text = JSON.stringify(hooks);

	// when
	const componentMarkers = [
		"components/comment-checker/dist/cli.js",
		"components/lsp/dist/cli.js",
		"components/rules/dist/cli.js",
		"components/telemetry/dist/cli.js",
		"components/ultragoal/dist/cli.js",
		"components/ultrawork/hooks/sync-agents.py",
		"components/ultrawork/hooks/ultrawork-detector.py",
	];

	// then
	for (const marker of componentMarkers) {
		assert.match(text, new RegExp(marker.replaceAll("/", "\\/")));
	}
	assert.doesNotMatch(text, /codex-(comment-checker|lsp|rules|telemetry|ultragoal|ultrawork)@/);
});

test("#given aggregate MCP config #when inspected #then lsp server stays component isolated", async () => {
	// given
	const mcp = await readJson(".mcp.json");

	// when
	const server = mcp.mcpServers.lsp;

	// then
	assert.equal(server.command, "node");
	assert.deepEqual(server.args, ["./components/lsp/packages/lsp-tools-mcp/dist/cli.js", "mcp"]);
	assert.equal(server.cwd, ".");
});

test("#given aggregate plugin build script #when inspected #then telemetry sync runs before workspace builds", async () => {
	// given
	const packageJson = await readJson("package.json");
	const telemetrySyncScript = await readFile(join(root, "..", "scripts", "sync-telemetry-component.mjs"), "utf8");

	// when
	const buildScript = packageJson.scripts.build;

	// then
	assert.equal(buildScript, "node scripts/sync-skills.mjs && node ../scripts/sync-telemetry-component.mjs && npm run build --workspaces --if-present");
	assert.match(telemetrySyncScript, /syncTelemetryComponent/);
});

test("#given component directories #when scanned #then only root owns plugin identity", async () => {
	// given
	const components = await readdir(join(root, "components"), { withFileTypes: true });

	// when
	const componentNames = components.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

	// then
	assert.deepEqual(componentNames, ["comment-checker", "lsp", "rules", "telemetry", "ultragoal", "ultrawork"]);
	for (const name of componentNames) {
		await assert.rejects(
			readFile(join(root, "components", name, ".codex-plugin", "plugin.json"), "utf8"),
			/code: 'ENOENT'|ENOENT/,
		);
	}
});
