import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	type CodexPostCompactInput,
	type CodexPostToolUseInput,
	type CodexSessionStartInput,
	type CodexUserPromptSubmitInput,
	runPostCompactHook,
	runPostToolUseHook,
	runSessionStartHook,
	runUserPromptSubmitHook,
} from "../src/codex-hook.js";

const tempDirectories: string[] = [];
const PROJECT_ONLY_ENV = {
	CODEX_RULES_ENABLED_SOURCES: "CONTEXT.md,.omo/rules",
};
const SESSION_ID = "session-post-compact-directive";

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("codex rules post-compaction read directive", () => {
	it("#given injected rules dropped by compaction #when UserPromptSubmit recovers #then it lists rule paths in a mandatory read directive instead of bodies", async () => {
		// given
		const { root, pluginData } = makeProject();
		await runSessionStartHook(sessionStartInput(root), { pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV });
		const dynamicOutput = await runPostToolUseHook(postToolUseInput(root, path.join(root, "src", "app.ts")), {
			pluginDataRoot: pluginData,
			env: PROJECT_ONLY_ENV,
		});
		const transcriptPath = writeCompactedTranscript(root, "summary that dropped every injected rule");
		await runPostCompactHook(
			{ ...postCompactInput(root), transcript_path: transcriptPath },
			{ pluginDataRoot: pluginData },
		);

		// when
		const output = await runUserPromptSubmitHook(userPromptSubmitInput(root, transcriptPath), {
			pluginDataRoot: pluginData,
			env: PROJECT_ONLY_ENV,
		});

		// then
		expect(dynamicOutput).toContain("TypeScript rule");
		const context = readAdditionalContext(output);
		expect(context).toContain("MUST READ");
		expect(context).toContain("NO EXCUSES");
		expect(context).toContain("CONTEXT.md");
		expect(context).toContain(".omo/rules/typescript.md");
		expect(context).not.toContain("A".repeat(50));
		expect(context).not.toContain("B".repeat(50));
		expect(context.length).toBeLessThan(2_000);
	});

	it("#given recovery directive already emitted #when UserPromptSubmit runs again #then it emits nothing", async () => {
		// given
		const { root, pluginData } = makeProject();
		await runSessionStartHook(sessionStartInput(root), { pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV });
		const transcriptPath = writeCompactedTranscript(root, "summary that dropped every injected rule");
		await runPostCompactHook(
			{ ...postCompactInput(root), transcript_path: transcriptPath },
			{ pluginDataRoot: pluginData },
		);
		await runUserPromptSubmitHook(userPromptSubmitInput(root, transcriptPath), {
			pluginDataRoot: pluginData,
			env: PROJECT_ONLY_ENV,
		});

		// when
		const secondOutput = await runUserPromptSubmitHook(userPromptSubmitInput(root, transcriptPath), {
			pluginDataRoot: pluginData,
			env: PROJECT_ONLY_ENV,
		});

		// then
		expect(secondOutput).toBe("");
	});

	it("#given rules retained in compacted replacement #when UserPromptSubmit recovers #then it emits nothing", async () => {
		// given
		const { root, pluginData } = makeProject();
		const firstOutput = await runSessionStartHook(sessionStartInput(root), {
			pluginDataRoot: pluginData,
			env: PROJECT_ONLY_ENV,
		});
		const transcriptPath = writeCompactedTranscript(root, readAdditionalContext(firstOutput));
		await runPostCompactHook(
			{ ...postCompactInput(root), transcript_path: transcriptPath },
			{ pluginDataRoot: pluginData },
		);

		// when
		const output = await runUserPromptSubmitHook(userPromptSubmitInput(root, transcriptPath), {
			pluginDataRoot: pluginData,
			env: PROJECT_ONLY_ENV,
		});

		// then
		expect(output).toBe("");
	});

	it("#given bundled hephaestus rule dropped by compaction #when compact SessionStart recovers #then hephaestus body is re-injected in full alongside the directive", async () => {
		// given
		const { root, pluginData } = makeProject();
		const env = { CODEX_RULES_ENABLED_SOURCES: "CONTEXT.md,plugin-bundled" };
		await runSessionStartHook(sessionStartInput(root), { pluginDataRoot: pluginData, env });
		const transcriptPath = writeCompactedTranscript(root, "summary that dropped every injected rule");
		await runPostCompactHook(
			{ ...postCompactInput(root), transcript_path: transcriptPath },
			{ pluginDataRoot: pluginData },
		);

		// when
		const output = await runSessionStartHook(compactSessionStartInput(root, transcriptPath), {
			pluginDataRoot: pluginData,
			env,
		});

		// then
		const context = readAdditionalContext(output);
		expect(context).toContain("You are Hephaestus");
		expect(context).not.toContain("[Truncated. Full:");
		expect(context).toContain("MUST READ");
		expect(context).toContain("CONTEXT.md");
	});
});

function makeProject(): { root: string; pluginData: string } {
	const root = mkdtempSync(path.join(tmpdir(), "codex-rules-directive-project-"));
	const pluginData = mkdtempSync(path.join(tmpdir(), "codex-rules-directive-data-"));
	tempDirectories.push(root, pluginData);
	writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture" }));
	writeFileSync(path.join(root, "CONTEXT.md"), `Project rule\n${"A".repeat(8_000)}`);
	mkdirSync(path.join(root, ".omo", "rules"), { recursive: true });
	writeFileSync(
		path.join(root, ".omo", "rules", "typescript.md"),
		["---", 'globs: "**/*.ts"', "---", "", `TypeScript rule\n${"B".repeat(2_000)}`].join("\n"),
	);
	mkdirSync(path.join(root, "src"), { recursive: true });
	writeFileSync(path.join(root, "src", "app.ts"), "export const app = 1;\n");
	return { root, pluginData };
}

function sessionStartInput(root: string): CodexSessionStartInput {
	return {
		session_id: SESSION_ID,
		transcript_path: null,
		cwd: root,
		hook_event_name: "SessionStart",
		model: "gpt-5.5",
		permission_mode: "default",
		source: "startup",
	};
}

function compactSessionStartInput(root: string, transcriptPath: string): CodexSessionStartInput {
	return {
		session_id: SESSION_ID,
		transcript_path: transcriptPath,
		cwd: root,
		hook_event_name: "SessionStart",
		model: "gpt-5.5",
		permission_mode: "default",
		source: "compact",
	};
}

function postCompactInput(root: string): CodexPostCompactInput {
	return {
		session_id: SESSION_ID,
		turn_id: "turn-compact",
		transcript_path: null,
		cwd: root,
		hook_event_name: "PostCompact",
		model: "gpt-5.5",
		trigger: "auto",
	};
}

function userPromptSubmitInput(root: string, transcriptPath: string): CodexUserPromptSubmitInput {
	return {
		session_id: SESSION_ID,
		turn_id: "turn-after-compact",
		transcript_path: transcriptPath,
		cwd: root,
		hook_event_name: "UserPromptSubmit",
		model: "gpt-5.5",
		permission_mode: "default",
		prompt: "continue",
	};
}

function postToolUseInput(root: string, filePath: string): CodexPostToolUseInput {
	return {
		session_id: SESSION_ID,
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

function writeCompactedTranscript(root: string, retainedText: string): string {
	const transcriptPath = path.join(root, "transcript-compacted.jsonl");
	writeFileSync(
		transcriptPath,
		`${JSON.stringify({
			type: "compacted",
			payload: {
				message: "summary",
				replacement_history: [{ type: "message", role: "user", content: retainedText }],
			},
		})}\n`,
	);
	return transcriptPath;
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
