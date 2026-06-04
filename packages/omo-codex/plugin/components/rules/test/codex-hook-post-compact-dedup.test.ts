import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	type CodexPostCompactInput,
	type CodexPostToolUseInput,
	type CodexSessionStartInput,
	runPostCompactHook,
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

describe("codex rules PostCompact deduplication", () => {
	it("#given compacted replacement already retained static context #when UserPromptSubmit runs after PostCompact #then it emits no duplicate static context", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		const firstOutput = await runSessionStartHook(sessionStartInput(root), {
			pluginDataRoot: pluginData,
			env: PROJECT_ONLY_ENV,
		});
		const transcriptPath = writeTranscriptWithCompactedReplacement(root, readAdditionalContext(firstOutput));
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

	it("#given compacted replacement already retained dynamic context #when PostToolUse runs after PostCompact #then it emits no duplicate dynamic context", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		const filePath = path.join(root, "src", "app.ts");
		const input = postToolUseInput(root, filePath);
		const firstOutput = await runPostToolUseHook(input, { pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV });
		const transcriptPath = writeTranscriptWithCompactedReplacement(root, readAdditionalContext(firstOutput));
		await runPostCompactHook(
			{ ...postCompactInput(root), transcript_path: transcriptPath },
			{ pluginDataRoot: pluginData },
		);

		// when
		const output = await runPostToolUseHook(
			{ ...input, transcript_path: transcriptPath },
			{ pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV },
		);

		// then
		expect(output).toBe("");
	});

	it("#given malformed transcript with repeated compactions retaining context #when UserPromptSubmit runs after PostCompact #then it emits no duplicate static context", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		const firstOutput = await runSessionStartHook(sessionStartInput(root), {
			pluginDataRoot: pluginData,
			env: PROJECT_ONLY_ENV,
		});
		const transcriptPath = writeTranscriptWithRepeatedCompactions(root, readAdditionalContext(firstOutput));
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

	it("#given startup already injected static context #when UserPromptSubmit runs after PostCompact #then it emits no duplicate static context", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		await runSessionStartHook(sessionStartInput(root), {
			pluginDataRoot: pluginData,
			env: PROJECT_ONLY_ENV,
		});
		const transcriptPath = writeTranscriptWithCompactedReplacement(root, "summary without project instructions");
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

	it("#given startup already injected static context #when compact SessionStart runs after PostCompact #then it emits no duplicate static context", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		await runSessionStartHook(sessionStartInput(root), {
			pluginDataRoot: pluginData,
			env: PROJECT_ONLY_ENV,
		});
		const transcriptPath = writeTranscriptWithCompactedReplacement(root, "summary without project instructions");
		await runPostCompactHook(
			{ ...postCompactInput(root), transcript_path: transcriptPath },
			{ pluginDataRoot: pluginData },
		);

		// when
		const output = await runSessionStartHook(compactSessionStartInput(root, transcriptPath), {
			pluginDataRoot: pluginData,
			env: PROJECT_ONLY_ENV,
		});

		// then
		expect(output).toBe("");
	});
});

function makeTempProject(): { root: string; pluginData: string } {
	const root = mkdtempSync(path.join(tmpdir(), "codex-rules-compact-dedup-project-"));
	const pluginData = mkdtempSync(path.join(tmpdir(), "codex-rules-compact-dedup-data-"));
	tempDirectories.push(root, pluginData);
	writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture" }));
	writeFileSync(path.join(root, "AGENTS.md"), "Project AGENTS.md should stay Codex-native.");
	writeFileSync(path.join(root, "CLAUDE.md"), "Project CLAUDE.md should stay outside rules hook context.");
	writeFileSync(path.join(root, "CONTEXT.md"), "Always wear safety goggles when refactoring.");
	mkdirSync(path.join(root, ".omo", "rules"), { recursive: true });
	writeFileSync(
		path.join(root, ".omo", "rules", "typescript.md"),
		[
			"---",
			"description: TypeScript",
			'globs: ["**/*.ts", "**/*.tsx"]',
			"---",
			"",
			"Prefer strict TypeScript for all source files.",
		].join("\n"),
	);
	mkdirSync(path.join(root, "src"), { recursive: true });
	writeFileSync(path.join(root, "src", "app.ts"), "export const app = true;\n");
	return { root, pluginData };
}

function sessionStartInput(root: string): CodexSessionStartInput {
	return {
		session_id: "session-compact-dedup",
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
		...sessionStartInput(root),
		transcript_path: transcriptPath,
		source: "compact",
	};
}

function postCompactInput(root: string): CodexPostCompactInput {
	return {
		session_id: "session-compact-dedup",
		turn_id: "turn-compact",
		transcript_path: null,
		cwd: root,
		hook_event_name: "PostCompact",
		model: "gpt-5.5",
		trigger: "manual",
	};
}

function userPromptSubmitInput(root: string, transcriptPath: string): Parameters<typeof runUserPromptSubmitHook>[0] {
	return {
		session_id: "session-compact-dedup",
		turn_id: "turn-after-compact",
		transcript_path: transcriptPath,
		cwd: root,
		hook_event_name: "UserPromptSubmit",
		model: "gpt-5.5",
		permission_mode: "default",
		prompt: "read src/app.ts",
	};
}

function postToolUseInput(root: string, filePath: string): CodexPostToolUseInput {
	return {
		session_id: "session-compact-dedup",
		turn_id: "turn-after-compact",
		transcript_path: null,
		cwd: root,
		hook_event_name: "PostToolUse",
		model: "gpt-5.5",
		permission_mode: "default",
		tool_name: "mcp__filesystem__read_file",
		tool_input: { path: filePath },
		tool_response: { text: "file contents" },
		tool_use_id: "call-1",
	};
}

function writeTranscriptWithCompactedReplacement(root: string, ...replacementTexts: string[]): string {
	const transcriptPath = path.join(root, "transcript-compacted.jsonl");
	const replacementHistory = replacementTexts.map((text) => ({
		type: "message",
		role: "user",
		content: [{ type: "input_text", text }],
	}));
	writeFileSync(
		transcriptPath,
		`${JSON.stringify({
			type: "compacted",
			payload: {
				message: "summary",
				replacement_history: replacementHistory,
			},
		})}\n`,
	);
	return transcriptPath;
}

function writeTranscriptWithRepeatedCompactions(root: string, retainedText: string): string {
	const transcriptPath = path.join(root, "transcript-repeated-compacted.jsonl");
	writeFileSync(
		transcriptPath,
		[
			"{not json",
			JSON.stringify({
				type: "compacted",
				payload: {
					message: "older summary",
					replacement_history: [{ type: "message", role: "user", content: "old summary without rules" }],
				},
			}),
			JSON.stringify({
				type: "message",
				payload: { content: "x".repeat(10_000) },
			}),
			JSON.stringify({
				type: "compacted",
				payload: {
					message: "latest summary",
					replacement_history: [
						{
							type: "message",
							role: "user",
							content: [{ type: "input_text", text: retainedText }],
						},
					],
				},
			}),
			JSON.stringify({
				type: "message",
				payload: { content: "later prompt after compact" },
			}),
			"",
		].join("\n"),
	);
	return transcriptPath;
}

function readAdditionalContext(output: string): string {
	expect(output.trim().length).toBeGreaterThan(0);
	const parsed: unknown = JSON.parse(output);
	if (!isRecord(parsed)) return "";
	const hookSpecificOutput = parsed["hookSpecificOutput"];
	if (!isRecord(hookSpecificOutput)) return "";
	const additionalContext = hookSpecificOutput["additionalContext"];
	return typeof additionalContext === "string" ? additionalContext : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
