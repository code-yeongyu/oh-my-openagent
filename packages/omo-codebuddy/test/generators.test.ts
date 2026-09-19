import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { adaptSkillForCodeBuddy, insertCodeBuddyCompatibility, stripSection } from "../scripts/sync-skills.mjs";
import { extractPrompt, stripRuntimeInterpolations } from "../scripts/generate-agents.mjs";
import { buildMcpConfig } from "../scripts/generate-mcp.mjs";
import { parseArgs, marketplaceDir, installedPluginDir, settingsPathFor } from "../scripts/install-local.mjs";
import { validatePlugin } from "../scripts/validate-plugin.mjs";

const pluginRoot = join(import.meta.dirname, "..", "plugin");

describe("skill adaptation", () => {
	test("strips other harnesses' compatibility sections", () => {
		const content = [
			"# Skill",
			"",
			"body",
			"",
			"## Codex Harness Tool Compatibility",
			"",
			"old guidance",
			"",
			"## Next",
			"",
			"tail",
		].join("\n");
		const stripped = stripSection(content, "## Codex Harness Tool Compatibility");
		expect(stripped).not.toContain("old guidance");
		expect(stripped).toContain("## Next");
		expect(stripped).toContain("tail");
	});

	test("inserts the CodeBuddy section only for OpenCode vocabulary", () => {
		const pure = "# Skill\n\nplain prose about editing files\n";
		expect(insertCodeBuddyCompatibility(pure)).toBe(pure);

		const opencode = "# Skill\n\ncall call_omo_agent(subagent_type=\"explore\")\n";
		const adapted = insertCodeBuddyCompatibility(opencode);
		expect(adapted).toContain("## CodeBuddy Harness Tool Compatibility");
		expect(adapted.indexOf("## CodeBuddy")).toBeLessThan(adapted.indexOf("call_omo_agent"));
	});

	test("normalizes harness session prefixes and skill invocations", () => {
		const adapted = adaptSkillForCodeBuddy("# S\n\nrecord under `codex:<session_id>` and `senpi:<session_id>`; see `/skill:ulw-plan`\n");
		expect(adapted).toContain("`codebuddy:<session_id>`");
		expect(adapted).not.toContain("codex:");
		expect(adapted).toContain("`/omo:ulw-plan`");
	});

	test("is idempotent", () => {
		const once = adaptSkillForCodeBuddy("# S\n\ncall_omo_agent(...)\n");
		expect(adaptSkillForCodeBuddy(once)).toBe(once);
	});

	test("is idempotent with a mid-file section and no frontmatter", () => {
		const source = [
			"# Skill",
			"",
			"intro",
			"",
			"## CodeBuddy Harness Tool Compatibility",
			"",
			"old guidance",
			"",
			"## Usage",
			"",
			"call_omo_agent(...)",
		].join("\n");
		const once = adaptSkillForCodeBuddy(source);
		expect(adaptSkillForCodeBuddy(once)).toBe(once);
		expect(once).toContain("## Usage");
		expect(once).not.toContain("old guidance");
	});

	test("is idempotent on the shipped artifacts", () => {
		for (const name of ["init-deep", "refactor", "review-work", "ulw-execute", "ultrawork"]) {
			const path = join(pluginRoot, "skills", name, "SKILL.md");
			if (!existsSync(path)) continue;
			const content = readFileSync(path, "utf8");
			expect(adaptSkillForCodeBuddy(content)).toBe(content);
		}
	});
});

describe("agent extraction", () => {
	test("reads a const template literal", () => {
		const source = 'const X = `line one\nline two`;\nconst Y = 1;';
		expect(extractPrompt(source, { kind: "const", symbol: "X" })).toBe("line one\nline two");
	});

	test("reads a prompt field", () => {
		const source = 'export const a = { prompt: `hi ${name}` };';
		expect(extractPrompt(source, { kind: "field", field: "prompt" })).toBe("hi ${name}");
	});

	test("returns null when the symbol is missing", () => {
		expect(extractPrompt("const Other = `x`;", { kind: "const", symbol: "X" })).toBeNull();
	});

	test("drops runtime interpolations and collapses the gap", () => {
		expect(stripRuntimeInterpolations("a\n${build()}\nb\n\n\n\nc  \n")).toBe("a\n\nb\n\nc");
	});
});

describe("mcp config", () => {
	test("always declares the remote servers", () => {
		const config = buildMcpConfig();
		expect(Object.keys(config.mcpServers)).toEqual(["context7", "grep_app"]);
	});

	test("declares local servers only when staged", () => {
		const servers = buildMcpConfig({ hasLsp: true, hasAstGrep: true }).mcpServers as Record<
			string,
			{ command?: string; args?: string[] }
		>;
		expect(servers.lsp?.command).toBe("node");
		expect(servers.lsp?.args?.[0]).toContain("${CODEBUDDY_PLUGIN_ROOT}");
		expect(servers.ast_grep).toBeDefined();
	});
});

describe("installer paths", () => {
	test("derives the marketplace and plugin paths from the root", () => {
		expect(marketplaceDir("/tmp/cb")).toBe("/tmp/cb/plugins/omo-local");
		expect(installedPluginDir("/tmp/cb")).toBe("/tmp/cb/plugins/omo-local/plugins/omo");
	});

	test("resolves the settings file per scope", () => {
		expect(settingsPathFor("user", "/tmp/cb", "/proj")).toBe("/tmp/cb/settings.json");
		expect(settingsPathFor("project", "/tmp/cb", "/proj")).toBe("/proj/.codebuddy/settings.json");
		expect(settingsPathFor("local", "/tmp/cb", "/proj")).toBe("/proj/.codebuddy/settings.local.json");
	});

	test("parses arguments and rejects unknown scopes", () => {
		const parsed = parseArgs(["install", "--root", "/tmp/x", "--scope", "project", "--copy"]);
		expect(parsed.root).toBe("/tmp/x");
		expect(parsed.scope).toBe("project");
		expect(parsed.copy).toBe(true);
		expect(() => parseArgs(["install", "--scope", "galaxy"])).toThrow();
		expect(() => parseArgs(["install", "--nope"])).toThrow();
	});
});

describe("plugin validation", () => {
	test("accepts the built plugin", () => {
		if (!existsSync(join(pluginRoot, "hooks", "scripts", "hook.mjs"))) {
			// The build is a prerequisite; skip rather than fail on a clean checkout.
			return;
		}
		const result = validatePlugin(pluginRoot);
		expect(result.problems).toEqual([]);
		expect(result.ok).toBe(true);
		expect(result.summary.skills).toBeGreaterThan(10);
		expect(result.summary.agents).toBe(7);
		expect(result.summary.commands).toBeGreaterThanOrEqual(9);
	});

	test("reports what is missing for an empty plugin", () => {
		const empty = mkdtempSync(join(tmpdir(), "omo-codebuddy-empty-"));
		try {
			const result = validatePlugin(empty);
			expect(result.ok).toBe(false);
			expect(result.problems.join("\n")).toContain("plugin.json");
			expect(result.problems.join("\n")).toContain("hooks/hooks.json");
		} finally {
			rmSync(empty, { recursive: true, force: true });
		}
	});
});
