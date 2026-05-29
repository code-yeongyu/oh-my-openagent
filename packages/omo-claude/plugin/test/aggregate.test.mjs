import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test("hooks.json is valid JSON and Claude-Code shaped", () => {
	const raw = readFileSync(join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf8");
	const parsed = JSON.parse(raw);
	assert.ok(parsed.hooks, "has top-level hooks key");
	const events = Object.keys(parsed.hooks);
	for (const event of ["SessionStart", "UserPromptSubmit", "PostToolUse", "PostCompact", "Stop", "SubagentStop"]) {
		assert.ok(events.includes(event), `aggregate registers ${event}`);
	}
	assert.ok(!events.includes("PreToolUse"), "no PreToolUse block (ultragoal create_goal guard not registered)");
	assert.ok(raw.includes("${CLAUDE_PLUGIN_ROOT}"), "hook commands use ${CLAUDE_PLUGIN_ROOT}");
	assert.ok(!/\$\{PLUGIN_ROOT\}/.test(raw), "no bare ${PLUGIN_ROOT} left");
	assert.ok(!raw.includes("create_goal"), "no create_goal matcher in the aggregate");
});

test("14 skills are aggregated", () => {
	const skills = readdirSync(join(PLUGIN_ROOT, "skills"), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
	assert.equal(skills.length, 14, `expected 14 skills, got ${skills.length}: ${skills.join(", ")}`);
});

test("harness-tool skills carry the Claude Code compatibility block", () => {
	const expected = ["init-deep", "planing-prometheustic", "refactor", "remove-ai-slops", "review-work", "start-work"];
	for (const skill of expected) {
		const body = readFileSync(join(PLUGIN_ROOT, "skills", skill, "SKILL.md"), "utf8");
		assert.ok(
			body.includes("## Claude Code Harness Tool Compatibility"),
			`${skill} carries the Claude Code Harness Tool Compatibility block`,
		);
	}
	const startWork = readFileSync(join(PLUGIN_ROOT, "skills", "start-work", "SKILL.md"), "utf8");
	assert.ok(
		!/^## Codex Harness Tool Compatibility/m.test(startWork),
		"start-work's embedded Codex compatibility heading is demoted, not authoritative",
	);
});

test(".mcp.json references ${CLAUDE_PLUGIN_ROOT} with no parent-relative paths", () => {
	const raw = readFileSync(join(PLUGIN_ROOT, ".mcp.json"), "utf8");
	const parsed = JSON.parse(raw);
	assert.ok(parsed.mcpServers.ast_grep, "ast_grep MCP server declared");
	assert.ok(parsed.mcpServers.lsp, "lsp MCP server declared");
	assert.ok(raw.includes("${CLAUDE_PLUGIN_ROOT}"), ".mcp.json uses ${CLAUDE_PLUGIN_ROOT}");
	assert.ok(!raw.includes("../"), ".mcp.json has no parent-relative paths");
});
