import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mcpPackageManifestPaths = ["../../lsp-tools-mcp/package.json", "../../ast-grep-mcp/package.json", "../../git-bash-mcp/package.json"];
const mcpPackageManifestExists = await Promise.all(mcpPackageManifestPaths.map(exists));

async function readJson(relativePath) {
	return JSON.parse(await readFile(join(root, relativePath), "utf8"));
}

async function exists(relativePath) {
	try {
		await stat(join(root, relativePath));
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}

async function readComponentHookManifests() {
	const components = await readdir(join(root, "components"), { withFileTypes: true });
	const manifests = [];
	for (const entry of components) {
		if (!entry.isDirectory()) continue;
		const source = join("components", entry.name, "hooks", "hooks.json");
		if (!(await exists(source))) continue;
		manifests.push({ source, hooks: await readJson(source) });
	}
	return manifests.sort((left, right) => left.source.localeCompare(right.source));
}

function collectCommandHooks(hooks, source) {
	const config = hooks.hooks;
	if (typeof config !== "object" || config === null || Array.isArray(config)) {
		throw new TypeError(`Invalid hooks manifest: ${source}`);
	}
	const commandHooks = [];
	for (const [eventName, groups] of Object.entries(config)) {
		if (!Array.isArray(groups)) {
			throw new TypeError(`Invalid hook groups in ${source}:${eventName}`);
		}
		groups.forEach((group, groupIndex) => {
			if (typeof group !== "object" || group === null || !Array.isArray(group.hooks)) {
				throw new TypeError(`Invalid hook group in ${source}:${eventName}:${groupIndex}`);
			}
			group.hooks.forEach((handler, handlerIndex) => {
				if (typeof handler !== "object" || handler === null || handler.type !== "command") return;
				commandHooks.push({ source, eventName, groupIndex, handlerIndex, handler });
			});
		});
	}
	return commandHooks;
}

function hookLocation({ source, eventName, groupIndex, handlerIndex, handler }) {
	return `${source}:${eventName}:${groupIndex}:${handlerIndex}:${handler.command}`;
}

function findSpawnAgentTypes(content) {
	const agentTypes = new Set();
	const regex = /spawn_agent\(agent_type="([^"]+)"/g;
	for (const match of content.matchAll(regex)) {
		agentTypes.add(match[1]);
	}
	return [...agentTypes].sort();
}

function findRoleSpecificSpawnsWithoutForkTurnsNone(content) {
	const missingForkTurns = [];
	const regex = /spawn_agent\(agent_type="([^"]+)"[^)]*\)/g;
	for (const match of content.matchAll(regex)) {
		const call = match[0];
		if (!call.includes('fork_turns="none"')) {
			missingForkTurns.push(call);
		}
	}
	return missingForkTurns;
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

test("#given aggregate plugin metadata #when inspected #then ulw-loop is the public loop name", async () => {
	// given
	const manifestText = await readFile(join(root, ".codex-plugin", "plugin.json"), "utf8");
	const manifest = JSON.parse(manifestText);

	// when
	const longDescription = String(manifest.interface?.longDescription ?? "");

	// then
	assert.match(longDescription, /ulw-loop/);
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
		"components/start-work-continuation/dist/cli.js",
		"components/telemetry/dist/cli.js",
		"components/ulw-loop/dist/cli.js",
		"components/ultrawork/dist/cli.js",
		"scripts/auto-update.mjs",
	];

	// then
	for (const marker of componentMarkers) {
		assert.match(text, new RegExp(marker.replaceAll("/", "\\/")));
	}
	assert.doesNotMatch(text, /codex-(comment-checker|lsp|rules|telemetry|ulw-loop|ultrawork)@/);
	assert.equal(await exists("scripts/migrate-codex-config.mjs"), true);
});

test("#given aggregate PostCompact hooks #when hooks are inspected #then LSP diagnostics cache reset is registered", async () => {
	// given
	const hooks = await readJson("hooks/hooks.json");

	// when
	const lspPostCompactHooks = collectCommandHooks(hooks, "hooks/hooks.json").filter(
		(hook) =>
			hook.eventName === "PostCompact" &&
			hook.handler.command === 'node "${PLUGIN_ROOT}/components/lsp/dist/cli.js" hook post-compact',
	);

	// then
	assert.equal(lspPostCompactHooks.length, 1);
	assert.equal(lspPostCompactHooks[0]?.handler.statusMessage, "LazyCodex(0.1.0): Resetting LSP Diagnostics Cache");
});

test("#given aggregate hook commands #when inspected #then every command exposes a Codex status message", async () => {
	// given
	const hooks = await readJson("hooks/hooks.json");

	// when
	const commandHooks = collectCommandHooks(hooks, "hooks/hooks.json");
	const missingStatusMessages = commandHooks
		.filter(({ handler }) => typeof handler.statusMessage !== "string" || handler.statusMessage.trim() === "")
		.map(hookLocation);

	// then
	assert.deepEqual(missingStatusMessages, []);
});

test("#given component hook commands #when inspected #then standalone packages expose Codex status messages", async () => {
	// given
	const componentHooks = await readComponentHookManifests();

	// when
	const missingStatusMessages = componentHooks
		.flatMap(({ source, hooks }) => collectCommandHooks(hooks, source))
		.filter(({ handler }) => typeof handler.statusMessage !== "string" || handler.statusMessage.trim() === "")
		.map(hookLocation);

	// then
	assert.deepEqual(missingStatusMessages, []);
});

test("#given hook status messages #when inspected #then labels describe OMO responsibilities instead of the hook runner", async () => {
	// given
	const aggregateHooks = await readJson("hooks/hooks.json");
	const componentHooks = await readComponentHookManifests();

	// when
	const commandHooks = [
		...collectCommandHooks(aggregateHooks, "hooks/hooks.json"),
		...componentHooks.flatMap(({ source, hooks }) => collectCommandHooks(hooks, source)),
	];
	const genericStatusMessages = commandHooks
		.filter(({ handler }) => typeof handler.statusMessage !== "string" || /\bhook\b/i.test(handler.statusMessage))
		.map(hookLocation);

	// then
	assert.deepEqual(genericStatusMessages, []);
});

test("#given aggregate OMO plugin is enabled #when hooks are inspected #then shell guidance and ulw-loop guard are registered", async () => {
	// given
	const hooks = await readJson("hooks/hooks.json");
	const text = JSON.stringify(hooks);

	// when
	const preToolUseGroups = hooks.hooks.PreToolUse;

	// then
	assert.match(text, /components\/git-bash\/dist\/cli\.js/);
	assert.match(text, /Recommending Git Bash Mcp/);
	assert.match(text, /hook post-compact/);
	assert.match(text, /Resetting Git Bash Mcp Reminder/);
	assert.match(text, /components\/ulw-loop\/dist\/cli\.js/);
	assert.match(text, /hook pre-tool-use/);
	assert.deepEqual(preToolUseGroups.map((group) => group.matcher), ["^Bash$", "^create_goal$"]);
});

test("#given aggregate SessionStart hooks #when inspected #then LazyCodex auto-update is registered", async () => {
	// given
	const hooks = await readJson("hooks/hooks.json");
	const text = JSON.stringify(hooks);

	// when
	const sessionStartCommands = collectCommandHooks(hooks, "hooks/hooks.json")
		.filter(({ eventName }) => eventName === "SessionStart")
		.map(({ handler }) => handler.command);
	const autoUpdateGroup = hooks.hooks.SessionStart.find((group) => JSON.stringify(group).includes("scripts/auto-update.mjs"));

	// then
	assert.equal(autoUpdateGroup?.matcher, "^startup$");
	assert.match(text, /scripts\/auto-update\.mjs/);
	assert.match(text, /Checking Auto Update/);
	assert(sessionStartCommands.some((command) => command.includes("scripts/auto-update.mjs")));
});

test("#given aggregate MCP config #when inspected #then code MCPs reference package runtimes without package names", async () => {
	// given
	const packageJson = await readJson("package.json");
	const mcp = await readJson(".mcp.json");
	const lspSources = await readdir(join(root, "components", "lsp", "src"));
	const bundledMcpBuildScript = await readFile(join(root, "scripts", "build-bundled-mcp-runtimes.mjs"), "utf8");

	// when
	const lspServer = mcp.mcpServers.lsp;
	const astGrepServer = mcp.mcpServers.ast_grep;
	const gitBashServer = mcp.mcpServers.git_bash;
	const codeMcpNames = Object.keys(mcp.mcpServers)
		.filter((name) => name === "lsp" || name === "ast_grep" || name === "git_bash")
		.sort();
	const componentLocalMcpSources = lspSources.filter((name) => name.startsWith("lazy-mcp") || name === "lazy-lsp-mcp.ts");

	// then
	assert.deepEqual(codeMcpNames, ["ast_grep", "git_bash", "lsp"]);
	assert.equal(packageJson.workspaces.includes("components/lsp/packages/lsp-tools-mcp"), false);
	assert.equal(packageJson.workspaces.includes("components/ast-grep/packages/ast-grep-mcp"), false);
	assert.deepEqual(packageJson.dependencies, { "@oh-my-opencode/shared-skills": "file:../../shared-skills" });
	assert.match(bundledMcpBuildScript, /ast-grep-mcp/);
	assert.match(bundledMcpBuildScript, /git-bash-mcp/);
	assert.doesNotMatch(packageJson.scripts.build, /--workspaces/);
	assert.equal(lspServer.command, "node");
	assert.deepEqual(lspServer.args, ["../../lsp-tools-mcp/dist/cli.js", "mcp"]);
	assert.equal(lspServer.cwd, ".");
	assert.equal(astGrepServer.command, "node");
	assert.deepEqual(astGrepServer.args, ["../../ast-grep-mcp/dist/cli.js", "mcp"]);
	assert.equal(astGrepServer.cwd, ".");
	assert.equal(gitBashServer.command, "node");
	assert.deepEqual(gitBashServer.args, ["../../git-bash-mcp/dist/cli.js", "mcp"]);
	assert.equal(gitBashServer.cwd, ".");
	assert.deepEqual(componentLocalMcpSources, []);
});

test(
	"#given package-level MCP CLIs #when package metadata is inspected #then bin names use the omo prefix",
	{ skip: mcpPackageManifestExists.some((exists) => !exists) },
	async () => {
		// given
		const [lspPackageJson, astGrepPackageJson, gitBashPackageJson] = await Promise.all(
			mcpPackageManifestPaths.map((path) => readJson(path)),
		);

		// when
		const binNames = [
			...Object.keys(lspPackageJson.bin ?? {}),
			...Object.keys(astGrepPackageJson.bin ?? {}),
			...Object.keys(gitBashPackageJson.bin ?? {}),
		].sort();

		// then
		assert.deepEqual(binNames, ["omo-ast-grep", "omo-git-bash", "omo-lsp"]);
		for (const name of binNames) {
			assert.match(name, /^omo-/);
		}
	},
);

test("#given aggregate plugin build script #when inspected #then hook status and telemetry sync run before workspace builds", async () => {
	// given
	const packageJson = await readJson("package.json");
	const telemetrySyncScript = await readFile(join(root, "..", "scripts", "sync-telemetry-component.mjs"), "utf8");

	// when
	const buildScript = packageJson.scripts.build;

	// then
	assert.equal(
		buildScript,
		"node scripts/sync-hook-status-messages.mjs && node scripts/build-bundled-mcp-runtimes.mjs && node scripts/sync-skills.mjs && node ../scripts/sync-telemetry-component.mjs && node scripts/build-components.mjs",
	);
	assert.match(telemetrySyncScript, /syncTelemetryComponent/);
});

test("#given omo-codex package build script #when inspected #then delegates to the aggregate plugin package", async () => {
	// given
	const packageJson = JSON.parse(await readFile(join(root, "..", "package.json"), "utf8"));

	// when
	const buildPluginScript = packageJson.scripts["build:plugin"];

	// then
	assert.equal(buildPluginScript, "bun run --cwd plugin build");
});

test("#given component directories #when scanned #then only intentional resource roots declare plugin manifests", async () => {
	// given
	const components = await readdir(join(root, "components"), { withFileTypes: true });
	const expectedComponentManifests = new Map([["rules", { hooks: "./hooks/hooks.json" }]]);

	// when
	const componentNames = [];
	for (const entry of components) {
		if (!entry.isDirectory()) continue;
		if (!(await exists(join("components", entry.name, "package.json")))) continue;
		componentNames.push(entry.name);
	}
	componentNames.sort();

	// then
	assert.deepEqual(componentNames, [
		"comment-checker",
		"git-bash",
		"lsp",
		"rules",
		"start-work-continuation",
		"telemetry",
		"ultrawork",
		"ulw-loop",
	]);
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

test("#given bundled Codex agents #when components/ultrawork/agents directory is scanned #then planner support TOMLs are present and match expected schema keys", async () => {
	const agentsDir = join(root, "components", "ultrawork", "agents");
	const entries = (await readdir(agentsDir, { withFileTypes: true }))
		.filter((entry) => entry.isFile() && entry.name.endsWith(".toml"))
		.map((entry) => entry.name)
		.sort();

	assert.deepEqual(entries, [
		"codex-ultrawork-reviewer.toml",
		"explorer.toml",
		"librarian.toml",
		"metis.toml",
		"momus.toml",
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

test("#given planner agent prompt #when inspected #then generated artifacts stay under .omo", async () => {
	const prompt = await readFile(join(root, "components", "ultrawork", "agents", "plan.toml"), "utf8");

	assert.match(prompt, /\.omo\/plans\/<slug>\.md/);
	assert.match(prompt, /\.omo\/evidence\/task-<N>-<slug>\.<ext>/);
	assert.doesNotMatch(prompt, /(?<!\.omo\/)plans\/<slug>\.md/);
	assert.doesNotMatch(prompt, /(?<!\.omo\/)evidence\/task-/);
});

test("#given reviewer agent prompt #when inspected #then default model is ChatGPT-account compatible", async () => {
	const prompt = await readFile(
		join(root, "components", "ultrawork", "agents", "codex-ultrawork-reviewer.toml"),
		"utf8",
	);

	assert.match(prompt, /^model\s*=\s*"gpt-5\.5"$/m);
	assert.match(prompt, /^model_reasoning_effort\s*=\s*"xhigh"$/m);
	assert.doesNotMatch(prompt, /^model\s*=\s*"gpt-5\.2"$/m);
	assert.match(prompt, /ChatGPT account/);
});

test("#given bundled model catalog #when inspected #then default verifier and worker roles are pinned", async () => {
	const catalog = JSON.parse(await readFile(join(root, "model-catalog.json"), "utf8"));

	assert.equal(catalog.current.model, "gpt-5.5");
	assert.equal(catalog.current.model_context_window, 400000);
	assert.equal(catalog.current.model_reasoning_effort, "high");
	assert.equal(catalog.current.plan_mode_reasoning_effort, "xhigh");
	assert.deepEqual(catalog.roles.default, catalog.current);
	assert.deepEqual(catalog.roles.verifier, {
		model: "gpt-5.5",
		model_reasoning_effort: "xhigh",
	});
	assert.deepEqual(catalog.roles.worker, {
		model: "gpt-5.4",
		model_reasoning_effort: "high",
	});
});

test("#given Codex-facing orchestration surfaces #when inspected #then retired ChatGPT-account model names are not recommended", async () => {
	const promptFiles = [
		join(root, "skills", "ulw-loop", "references", "full-workflow.md"),
		join(root, "components", "ulw-loop", "skills", "ulw-loop", "references", "full-workflow.md"),
		join(root, "components", "ultrawork", "README.md"),
		join(root, "components", "ultrawork", "CHANGELOG.md"),
		join(root, "components", "rules", "src", "post-compact-budget.ts"),
	];

	const staleReferences = [];
	for (const promptPath of promptFiles) {
		const content = await readFile(promptPath, "utf8");
		if (/gpt-5\.(?:2|3-codex)/i.test(content)) {
			staleReferences.push(`${basename(dirname(promptPath))}/${basename(promptPath)}`);
		}
	}

	assert.deepEqual(staleReferences, []);
});

test("#given synced skills with Codex compatibility guidance #when a bundled agent_type is referenced #then a matching TOML is bundled", async () => {
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
	assert.deepEqual(expected, ["explorer", "librarian", "metis", "momus", "plan"]);

	for (const agentType of expected) {
		const tomlPath = join(root, "components", "ultrawork", "agents", `${agentType}.toml`);
		const fileStat = await stat(tomlPath);
		assert.equal(fileStat.isFile(), true);
		assert.equal(basename(tomlPath), `${agentType}.toml`);
	}
});

test('#given synced skills and bundled rules #when role-specific agents are spawned #then they set fork_turns="none"', async () => {
	const skillsDir = join(root, "skills");
	const skillEntries = await readdir(skillsDir, { withFileTypes: true });
	const promptFiles = skillEntries
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(skillsDir, entry.name, "SKILL.md"));
	promptFiles.push(join(root, "components", "rules", "bundled-rules", "hephaestus.md"));

	const missingForkTurns = [];
	for (const promptPath of promptFiles) {
		const content = await readFile(promptPath, "utf8");
		for (const call of findRoleSpecificSpawnsWithoutForkTurnsNone(content)) {
			missingForkTurns.push(`${basename(dirname(promptPath))}/${basename(promptPath)}: ${call}`);
		}
	}

	assert.deepEqual(missingForkTurns, []);
});

test("#given long-running orchestration prompts #when waiting on child agents #then parent liveness is surfaced", async () => {
	const promptFiles = [
		join(root, "skills", "ulw-loop", "SKILL.md"),
		join(root, "skills", "ulw-loop", "references", "full-workflow.md"),
		join(root, "skills", "review-work", "SKILL.md"),
		join(root, "skills", "start-work", "SKILL.md"),
		join(root, "components", "rules", "bundled-rules", "hephaestus.md"),
	];

	const missingLivenessGuidance = [];
	for (const promptPath of promptFiles) {
		const content = await readFile(promptPath, "utf8");
		if (!content.includes("active subagent count") || !content.includes("last heartbeat")) {
			missingLivenessGuidance.push(`${basename(dirname(promptPath))}/${basename(promptPath)}`);
		}
	}

	assert.deepEqual(missingLivenessGuidance, []);
});
