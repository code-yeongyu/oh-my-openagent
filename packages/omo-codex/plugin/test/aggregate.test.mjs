import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function readJson(relativePath) {
	return JSON.parse(await readFile(join(root, relativePath), "utf8"));
}

function findSpawnAgentTypes(content) {
	const agentTypes = new Set();
	const regex = /spawn_agent\(agent_type="([^"]+)"/g;
	for (const match of content.matchAll(regex)) {
		agentTypes.add(match[1]);
	}
	return [...agentTypes].sort();
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

test("#given component directories #when scanned #then only intentional resource roots declare plugin manifests", async () => {
	// given
	const components = await readdir(join(root, "components"), { withFileTypes: true });
	const expectedComponentManifests = new Map([["rules", { hooks: "./hooks/hooks.json" }]]);

	// when
	const componentNames = components.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

	// then
	assert.deepEqual(componentNames, ["comment-checker", "lsp", "rules", "telemetry", "ultragoal", "ultrawork"]);
	for (const name of componentNames) {
		const expectedManifest = expectedComponentManifests.get(name);
		if (expectedManifest !== undefined) {
			assert.deepEqual(await readJson(join("components", name, ".codex-plugin", "plugin.json")), expectedManifest);
			continue;
		}

		await assert.rejects(
			readFile(join(root, "components", name, ".codex-plugin", "plugin.json"), "utf8"),
			/code: 'ENOENT'|ENOENT/,
		);
	}
});

test("#given bundled Codex agents #when components/ultrawork/agents directory is scanned #then explorer librarian and reviewer TOMLs are present and match expected schema keys", async () => {
	const agentsDir = join(root, "components", "ultrawork", "agents");
	const entries = (await readdir(agentsDir, { withFileTypes: true }))
		.filter((entry) => entry.isFile() && entry.name.endsWith(".toml"))
		.map((entry) => entry.name)
		.sort();

	assert.deepEqual(entries, [
		"codex-ultrawork-reviewer.toml",
		"explorer.toml",
		"librarian.toml",
		"plan.toml",
	]);

	for (const fileName of entries) {
		const content = await readFile(join(agentsDir, fileName), "utf8");
		assert.match(content, /^name\s*=\s*".+"$/m);
		assert.match(content, /^description\s*=\s*".+"$/m);
		assert.match(content, /^nickname_candidates\s*=\s*\[.+\]$/m);
		assert.match(content, /^model\s*=\s*".+"$/m);
		assert.match(content, /^model_reasoning_effort\s*=\s*".+"$/m);
		assert.match(content, /^developer_instructions\s*=\s*"""/m);
	}
});

test("#given synced skills with Codex compatibility guidance #when explorer/librarian agent_type is referenced #then a matching TOML is bundled", async () => {
	const skillsDir = join(root, "skills");
	const skillEntries = await readdir(skillsDir, { withFileTypes: true });
	const skillFiles = skillEntries
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(skillsDir, entry.name, "SKILL.md"));

	const referencedAgentTypes = new Set();
	for (const skillPath of skillFiles) {
		const content = await readFile(skillPath, "utf8");
		for (const agentType of findSpawnAgentTypes(content)) {
			if (agentType === "worker" || agentType === "codex-ultrawork-reviewer") {
				continue;
			}
			referencedAgentTypes.add(agentType);
		}
	}

	const expected = [...referencedAgentTypes].sort();
	assert.deepEqual(expected, ["explorer", "librarian", "plan"]);

	for (const agentType of expected) {
		const tomlPath = join(root, "components", "ultrawork", "agents", `${agentType}.toml`);
		const fileStat = await stat(tomlPath);
		assert.equal(fileStat.isFile(), true);
		assert.equal(basename(tomlPath), `${agentType}.toml`);
	}
});
