import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	type CodexPostToolUseInput,
	type CodexSessionStartInput,
	type CodexUserPromptSubmitInput,
	runPostToolUseHook,
	runSessionStartHook,
	runUserPromptSubmitHook,
} from "../src/codex-hook.js";

const tempDirectories: string[] = [];
const PROJECT_ONLY_ENV = {
	CODEX_RULES_ENABLED_SOURCES: "CONTEXT.md,.omo/rules",
};

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("codex rules per-event injection budgets", () => {
	it("#given an oversized glob rule #when PostToolUse injects dynamically #then the block is truncated to the dynamic budget", async () => {
		// given
		const { root, pluginData } = makeProject({ dynamicRuleChars: 30_000 });

		// when
		const output = await runPostToolUseHook(postToolUseInput(root, path.join(root, "src", "app.ts")), {
			pluginDataRoot: pluginData,
			env: PROJECT_ONLY_ENV,
		});

		// then
		const context = readAdditionalContext(output);
		expect(context).toContain("[Truncated. Full:");
		expect(context.length).toBeLessThan(11_000);
	});

	it("#given a mid-sized static rule #when SessionStart injects #then the body is not truncated", async () => {
		// given
		const { root, pluginData } = makeProject({ staticRuleChars: 8_000 });

		// when
		const output = await runSessionStartHook(sessionStartInput(root), {
			pluginDataRoot: pluginData,
			env: PROJECT_ONLY_ENV,
		});

		// then
		const context = readAdditionalContext(output);
		expect(context).not.toContain("[Truncated. Full:");
		expect(context.length).toBeGreaterThan(8_000);
	});

	it("#given the same mid-sized static rule #when UserPromptSubmit injects on a fresh session #then the body is truncated to the prompt budget", async () => {
		// given
		const { root, pluginData } = makeProject({ staticRuleChars: 8_000 });

		// when
		const output = await runUserPromptSubmitHook(userPromptSubmitInput(root), {
			pluginDataRoot: pluginData,
			env: PROJECT_ONLY_ENV,
		});

		// then
		const context = readAdditionalContext(output);
		expect(context).toContain("[Truncated. Full:");
		expect(context.length).toBeLessThan(7_000);
	});

	it("#given dynamic budget env overrides #when PostToolUse injects #then the override budget wins", async () => {
		// given
		const { root, pluginData } = makeProject({ dynamicRuleChars: 30_000 });

		// when
		const output = await runPostToolUseHook(postToolUseInput(root, path.join(root, "src", "app.ts")), {
			pluginDataRoot: pluginData,
			env: {
				...PROJECT_ONLY_ENV,
				CODEX_RULES_DYNAMIC_MAX_RULE_CHARS: "1000",
				CODEX_RULES_DYNAMIC_MAX_RESULT_CHARS: "1500",
			},
		});

		// then
		const context = readAdditionalContext(output);
		expect(context).toContain("[Truncated. Full:");
		expect(context.length).toBeLessThan(2_000);
	});
});

function makeProject(sizes: { staticRuleChars?: number; dynamicRuleChars?: number }): {
	root: string;
	pluginData: string;
} {
	const root = mkdtempSync(path.join(tmpdir(), "codex-rules-event-budget-project-"));
	const pluginData = mkdtempSync(path.join(tmpdir(), "codex-rules-event-budget-data-"));
	tempDirectories.push(root, pluginData);
	writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture" }));
	writeFileSync(path.join(root, "CONTEXT.md"), `Project rule\n${"A".repeat(sizes.staticRuleChars ?? 100)}`);
	mkdirSync(path.join(root, ".omo", "rules"), { recursive: true });
	writeFileSync(
		path.join(root, ".omo", "rules", "typescript.md"),
		["---", 'globs: "**/*.ts"', "---", "", `TypeScript rule\n${"B".repeat(sizes.dynamicRuleChars ?? 100)}`].join(
			"\n",
		),
	);
	mkdirSync(path.join(root, "src"), { recursive: true });
	writeFileSync(path.join(root, "src", "app.ts"), "export const app = 1;\n");
	return { root, pluginData };
}

function sessionStartInput(root: string): CodexSessionStartInput {
	return {
		session_id: `session-budget-${path.basename(root)}`,
		transcript_path: null,
		cwd: root,
		hook_event_name: "SessionStart",
		model: "gpt-5.5",
		permission_mode: "default",
		source: "startup",
	};
}

function userPromptSubmitInput(root: string): CodexUserPromptSubmitInput {
	return {
		session_id: `session-budget-${path.basename(root)}`,
		turn_id: "turn-1",
		transcript_path: null,
		cwd: root,
		hook_event_name: "UserPromptSubmit",
		model: "gpt-5.5",
		permission_mode: "default",
		prompt: "continue",
	};
}

function postToolUseInput(root: string, filePath: string): CodexPostToolUseInput {
	return {
		session_id: `session-budget-${path.basename(root)}`,
		turn_id: "turn-tool",
		transcript_path: null,
		cwd: root,
		hook_event_name: "PostToolUse",
		model: "gpt-5.5",
		permission_mode: "default",
		tool_name: "apply_patch",
		tool_input: { path: filePath },
		tool_response: {},
		tool_use_id: "tool-use-1",
	};
}

function readAdditionalContext(output: string): string {
	if (output.trim().length === 0) {
		throw new Error("Expected hook output to include additional context.");
	}
	const parsed: unknown = JSON.parse(output);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "";
	const hookSpecificOutput = (parsed as Record<string, unknown>)["hookSpecificOutput"];
	if (typeof hookSpecificOutput !== "object" || hookSpecificOutput === null) return "";
	const additionalContext = (hookSpecificOutput as Record<string, unknown>)["additionalContext"];
	return typeof additionalContext === "string" ? additionalContext : "";
}
