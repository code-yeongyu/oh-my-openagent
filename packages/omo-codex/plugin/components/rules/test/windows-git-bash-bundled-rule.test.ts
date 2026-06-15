import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { type CodexSessionStartInput, runSessionStartHook } from "../src/codex-hook.js";
import { findPluginBundledCandidates } from "@oh-my-opencode/rules-engine/engine";

const WINDOWS_RULE_DESCRIPTION = "Windows Git Bash guidance for Codex";
const WINDOWS_RULE_PATH = "bundled-rules/windows-git-bash.md";
const WINDOWS_GUIDANCE = "On Windows native Codex sessions, prefer Git Bash for shell commands.";
const BUNDLED_ONLY_ENV = {
	CODEX_RULES_ENABLED_SOURCES: "plugin-bundled",
};
const PROJECT_AND_BUNDLED_ENV = {
	CODEX_RULES_ENABLED_SOURCES: ".omo/rules,plugin-bundled",
};
const tempDirectories: string[] = [];
let originalPluginRoot: string | undefined;

afterEach(() => {
	restoreEnv("PLUGIN_ROOT", originalPluginRoot);
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function makeProject(): { readonly root: string; readonly pluginData: string } {
	originalPluginRoot = process.env["PLUGIN_ROOT"];
	process.env["PLUGIN_ROOT"] = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "codex-rules-windows-git-bash-project-"));
	const pluginData = mkdtempSync(join(tmpdir(), "codex-rules-windows-git-bash-data-"));
	tempDirectories.push(root, pluginData);
	writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture" }));
	return { root, pluginData };
}

function sessionStartInput(root: string): CodexSessionStartInput {
	return {
		session_id: "session-1",
		transcript_path: null,
		cwd: root,
		hook_event_name: "SessionStart",
		model: "gpt-5.5",
		permission_mode: "default",
		source: "startup",
	};
}

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = value;
}

function occurrenceCount(value: string, search: string): number {
	return value.split(search).length - 1;
}

describe("Windows Git Bash bundled rule content", () => {
	function readWindowsRuleBody(): string {
		return readFileSync(join(process.cwd(), WINDOWS_RULE_PATH), "utf8");
	}

	it("#given the bundled rule #when read #then it keeps valid frontmatter (description + alwaysApply)", () => {
		const body = readWindowsRuleBody();

		expect(body).toContain(`description: ${WINDOWS_RULE_DESCRIPTION}`);
		expect(body).toContain("alwaysApply: true");
	});

	it('#given the bundled rule #when read #then it NEVER recommends bare shell:"bash"', () => {
		const body = readWindowsRuleBody();

		expect(body).not.toContain('shell: "bash"');
	});

	it("#given the bundled rule #when read #then it warns that bare bash often resolves to WSL System32", () => {
		const body = readWindowsRuleBody();

		expect(body).toMatch(/WSL/i);
		expect(body).toMatch(/System32/i);
	});

	it("#given the bundled rule #when read #then it prefers the git_bash MCP and the absolute Git Bash path", () => {
		const body = readWindowsRuleBody();

		expect(body).toContain("git_bash");
		expect(body).toContain("OMO_CODEX_GIT_BASH_PATH");
		expect(body).toContain("C:\\Program Files\\Git\\bin\\bash.exe");
	});
});

describe("Windows Git Bash bundled rule", () => {
	it("#given packaged bundled rules #when discovering plugin-bundled candidates #then Windows Git Bash rule is included", () => {
		const candidates = findPluginBundledCandidates({ pluginRoot: process.cwd(), platform: "win32" });

		expect(candidates.map((candidate) => candidate.relativePath)).toContain(WINDOWS_RULE_PATH);
	});

	it("#given packaged bundled rules off Windows #when discovering plugin-bundled candidates #then Windows Git Bash rule is excluded", () => {
		const candidates = findPluginBundledCandidates({ pluginRoot: process.cwd(), platform: "darwin" });

		expect(candidates.map((candidate) => candidate.relativePath)).not.toContain(WINDOWS_RULE_PATH);
	});

	it("#given bundled rules enabled on Windows #when SessionStart runs #then Windows Git Bash guidance is injected once", async () => {
		const { root, pluginData } = makeProject();

		const output = await runSessionStartHook(sessionStartInput(root), {
			pluginDataRoot: pluginData,
			env: BUNDLED_ONLY_ENV,
			platform: "win32",
		});

		expect(occurrenceCount(output, `Instructions from: ${join(process.cwd(), WINDOWS_RULE_PATH)}`)).toBe(1);
		expect(output).toContain(WINDOWS_GUIDANCE);
	});

	it("#given bundled rules enabled off Windows #when SessionStart runs #then Windows Git Bash guidance is not injected", async () => {
		const { root, pluginData } = makeProject();

		const output = await runSessionStartHook(sessionStartInput(root), {
			pluginDataRoot: pluginData,
			env: BUNDLED_ONLY_ENV,
			platform: "darwin",
		});

		expect(output).not.toContain(WINDOWS_GUIDANCE);
		expect(output).not.toContain(WINDOWS_RULE_PATH);
	});

	it("#given project rule with same description on Windows #when static rules load #then project guidance file overrides bundled guidance", async () => {
		const { root, pluginData } = makeProject();
		const projectGuidance = "Project-specific Windows shell policy.";
		const projectRulePath = join(root, ".omo", "rules", "windows-git-bash.md");
		mkdirSync(join(root, ".omo", "rules"), { recursive: true });
		writeFileSync(
			projectRulePath,
			["---", `description: ${WINDOWS_RULE_DESCRIPTION}`, "alwaysApply: true", "---", "", projectGuidance].join(
				"\n",
			),
		);

		const output = await runSessionStartHook(sessionStartInput(root), {
			pluginDataRoot: pluginData,
			env: PROJECT_AND_BUNDLED_ENV,
			platform: "win32",
		});

		expect(output).toContain(`Instructions from: ${projectRulePath}`);
		expect(output).toContain(projectGuidance);
		expect(output).not.toContain(WINDOWS_GUIDANCE);
	});
});
