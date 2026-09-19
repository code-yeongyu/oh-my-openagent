#!/usr/bin/env node
/**
 * Structural validation of the generated CodeBuddy plugin.
 *
 * This is the hermetic half of the CodeBuddy QA gate: it proves the plugin
 * manifest, hook wiring, skills, agents, commands and MCP config are internally
 * consistent and parseable. The live half (`codebuddy --plugin-dir …` driving a
 * real session) lives in the `codebuddy-qa` skill.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const REQUIRED_PLUGIN_FIELDS = ["name", "description", "version"];

export function validatePlugin(pluginRoot) {
	const problems = [];
	const check = (condition, message) => {
		if (!condition) problems.push(message);
	};

	const manifestPath = join(pluginRoot, ".codebuddy-plugin", "plugin.json");
	check(existsSync(manifestPath), "missing .codebuddy-plugin/plugin.json");
	let manifest = null;
	if (existsSync(manifestPath)) {
		manifest = readJson(manifestPath, problems);
		if (manifest !== null) {
			for (const field of REQUIRED_PLUGIN_FIELDS) {
				check(typeof manifest[field] === "string" && manifest[field].length > 0, `plugin.json: missing ${field}`);
			}
		}
	}

	const hooksPath = join(pluginRoot, "hooks", "hooks.json");
	check(existsSync(hooksPath), "missing hooks/hooks.json");
	if (existsSync(hooksPath)) {
		const hooks = readJson(hooksPath, problems);
		const events = hooks?.hooks ?? {};
		check(Object.keys(events).length > 0, "hooks/hooks.json declares no events");
		for (const [event, entries] of Object.entries(events)) {
			check(Array.isArray(entries) && entries.length > 0, `hooks/hooks.json: ${event} has no entries`);
			for (const entry of Array.isArray(entries) ? entries : []) {
				const commands = Array.isArray(entry?.hooks) ? entry.hooks : [];
				check(commands.length > 0, `hooks/hooks.json: ${event} entry has no hooks`);
				for (const hook of commands) {
					check(hook?.type === "command", `hooks/hooks.json: ${event} hook is not type=command`);
					const command = typeof hook?.command === "string" ? hook.command : "";
					check(
						command.includes("${CODEBUDDY_PLUGIN_ROOT}"),
						`hooks/hooks.json: ${event} command does not use \${CODEBUDDY_PLUGIN_ROOT}`,
					);
				}
			}
		}
	}

	const hookScript = join(pluginRoot, "hooks", "scripts", "hook.mjs");
	check(existsSync(hookScript), "missing hooks/scripts/hook.mjs (run the hook build)");

	const skillNames = listDirs(join(pluginRoot, "skills"));
	check(skillNames.length > 0, "no skills were generated");
	for (const name of skillNames) {
		const skillPath = join(pluginRoot, "skills", name, "SKILL.md");
		if (!existsSync(skillPath)) {
			problems.push(`skills/${name}: missing SKILL.md`);
			continue;
		}
		const frontmatter = readFrontmatter(skillPath);
		check(frontmatter.has("name"), `skills/${name}/SKILL.md: frontmatter missing name`);
		check(frontmatter.has("description"), `skills/${name}/SKILL.md: frontmatter missing description`);
	}

	const agentFiles = listFiles(join(pluginRoot, "agents"), ".md");
	check(agentFiles.length > 0, "no agents were generated");
	for (const file of agentFiles) {
		const frontmatter = readFrontmatter(join(pluginRoot, "agents", file));
		check(frontmatter.has("name"), `agents/${file}: frontmatter missing name`);
		check(frontmatter.has("description"), `agents/${file}: frontmatter missing description`);
	}

	const commandFiles = listFiles(join(pluginRoot, "commands"), ".md");
	check(commandFiles.length > 0, "no commands were generated");
	for (const file of commandFiles) {
		const frontmatter = readFrontmatter(join(pluginRoot, "commands", file));
		check(frontmatter.has("description"), `commands/${file}: frontmatter missing description`);
	}

	const mcpPath = join(pluginRoot, ".mcp.json");
	check(existsSync(mcpPath), "missing .mcp.json");
	if (existsSync(mcpPath)) {
		const mcp = readJson(mcpPath, problems);
		check(mcp?.mcpServers !== undefined, ".mcp.json: missing mcpServers");
	}

	return { ok: problems.length === 0, problems, summary: { skills: skillNames.length, agents: agentFiles.length, commands: commandFiles.length } };
}

function readJson(path, problems) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		problems.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
		return null;
	}
}

function listDirs(dir) {
	if (!existsSync(dir)) return [];
	return readdirSyncSafe(dir).filter((entry) => isDirectory(join(dir, entry)));
}

function listFiles(dir, extension) {
	if (!existsSync(dir)) return [];
	return readdirSyncSafe(dir).filter((entry) => entry.endsWith(extension));
}

function readdirSyncSafe(dir) {
	try {
		return readdirSync(dir);
	} catch {
		return [];
	}
}

function isDirectory(path) {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function readFrontmatter(path) {
	const keys = new Set();
	try {
		const content = readFileSync(path, "utf8");
		if (!content.startsWith("---\n")) return keys;
		const end = content.indexOf("\n---", 4);
		if (end === -1) return keys;
		for (const line of content.slice(4, end).split(/\r?\n/)) {
			const match = /^([A-Za-z0-9_-]+)\s*:/.exec(line);
			if (match) keys.add(match[1]);
		}
	} catch {
		// unreadable file is reported by the caller's existence check
	}
	return keys;
}

if (import.meta.main) {
	const pluginRoot = process.argv[2] ?? join(import.meta.dirname, "..", "plugin");
	const result = validatePlugin(pluginRoot);
	if (!result.ok) {
		console.error(`plugin validation failed (${result.problems.length}):`);
		for (const problem of result.problems) console.error(` - ${problem}`);
		process.exit(1);
	}
	console.log(
		`plugin validation passed: ${result.summary.skills} skills, ${result.summary.agents} agents, ${result.summary.commands} commands`,
	);
}
