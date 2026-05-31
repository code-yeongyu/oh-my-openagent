import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runPostToolUseHook, runUserPromptSubmitHook } from "../src/codex-hook.js";

const tempDirectories: string[] = [];
const PROJECT_ONLY_ENV = {
	CODEX_RULES_ENABLED_SOURCES: "AGENTS.md,.omo/rules",
};

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("codex rules context-pressure recovery", () => {
	it("#given context-pressure recovery prompt and empty static cache #when UserPromptSubmit runs #then it emits no static context", async () => {
		// given
		const { root, pluginData } = makeTempProject();

		// when
		const output = await runUserPromptSubmitHook(
			{
				...userPromptSubmitInput(root),
				prompt: [
					"Context compacted",
					"error context_too_large: Your input exceeds the context window of this model.",
					"Please adjust your input and try again.",
				].join("\n"),
			},
			{ pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV },
		);

		// then
		expect(output).toBe("");
	});

	it("#given Codex canonical context-window prompt and empty static cache #when UserPromptSubmit runs #then it emits no static context", async () => {
		// given
		const { root, pluginData } = makeTempProject();

		// when
		const output = await runUserPromptSubmitHook(
			{
				...userPromptSubmitInput(root),
				prompt: [
					"error context_length_exceeded",
					"Codex ran out of room in the model's context window. Start a new thread before retrying.",
				].join("\n"),
			},
			{ pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV },
		);

		// then
		expect(output).toBe("");
	});

	it("#given context-pressure transcript and empty static cache #when UserPromptSubmit runs #then it emits no static context", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		const transcriptPath = writeContextPressureTranscript(root);

		// when
		const output = await runUserPromptSubmitHook(
			{
				...userPromptSubmitInput(root),
				transcript_path: transcriptPath,
				prompt: "continue",
			},
			{ pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV },
		);

		// then
		expect(output).toBe("");
	});

	it("#given Codex canonical context-window transcript and empty static cache #when UserPromptSubmit runs #then it emits no static context", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		const transcriptPath = writeCodexContextWindowTranscript(root);

		// when
		const output = await runUserPromptSubmitHook(
			{
				...userPromptSubmitInput(root),
				transcript_path: transcriptPath,
				prompt: "continue",
			},
			{ pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV },
		);

		// then
		expect(output).toBe("");
	});

	it("#given context-pressure transcript and empty dynamic cache #when PostToolUse runs #then it emits no dynamic context", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		const transcriptPath = writeContextPressureTranscript(root);
		const filePath = path.join(root, "src", "app.ts");
		mkdirSync(path.dirname(filePath), { recursive: true });
		writeFileSync(filePath, "export const answer = 42;\n");

		// when
		const output = await runPostToolUseHook(
			{
				session_id: "session-context-pressure",
				turn_id: "turn-1",
				transcript_path: transcriptPath,
				cwd: root,
				hook_event_name: "PostToolUse",
				model: "gpt-5.5",
				permission_mode: "default",
				tool_name: "mcp__filesystem__read_file",
				tool_input: { path: filePath },
				tool_response: { text: "export const answer = 42;" },
				tool_use_id: "call-1",
			},
			{ pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV },
		);

		// then
		expect(output).toBe("");
	});

	it("#given Codex canonical context-window transcript and empty dynamic cache #when PostToolUse runs #then it emits no dynamic context", async () => {
		// given
		const { root, pluginData } = makeTempProject();
		const transcriptPath = writeCodexContextWindowTranscript(root);
		const filePath = path.join(root, "src", "app.ts");
		mkdirSync(path.dirname(filePath), { recursive: true });
		writeFileSync(filePath, "export const answer = 42;\n");

		// when
		const output = await runPostToolUseHook(
			{
				session_id: "session-context-pressure",
				turn_id: "turn-1",
				transcript_path: transcriptPath,
				cwd: root,
				hook_event_name: "PostToolUse",
				model: "gpt-5.5",
				permission_mode: "default",
				tool_name: "mcp__filesystem__read_file",
				tool_input: { path: filePath },
				tool_response: { text: "export const answer = 42;" },
				tool_use_id: "call-1",
			},
			{ pluginDataRoot: pluginData, env: PROJECT_ONLY_ENV },
		);

		// then
		expect(output).toBe("");
	});
});

function makeTempProject(): { readonly root: string; readonly pluginData: string } {
	const root = mkdtempSync(path.join(tmpdir(), "codex-rules-context-pressure-project-"));
	const pluginData = mkdtempSync(path.join(tmpdir(), "codex-rules-context-pressure-data-"));
	tempDirectories.push(root, pluginData);
	writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture" }));
	writeFileSync(path.join(root, "AGENTS.md"), "Always wear safety goggles when refactoring.");
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
	return { root, pluginData };
}

function userPromptSubmitInput(root: string): Parameters<typeof runUserPromptSubmitHook>[0] {
	return {
		session_id: "session-context-pressure",
		turn_id: "turn-1",
		transcript_path: null,
		cwd: root,
		hook_event_name: "UserPromptSubmit",
		model: "gpt-5.5",
		permission_mode: "default",
		prompt: "read src/app.ts",
	};
}

function writeContextPressureTranscript(root: string): string {
	const transcriptPath = path.join(root, "transcript-context-pressure.jsonl");
	writeFileSync(
		transcriptPath,
		[
			JSON.stringify({
				type: "message",
				payload: {
					content: "Context compacted",
				},
			}),
			JSON.stringify({
				type: "message",
				payload: {
					content: "Your input exceeds the context window of this model.",
				},
			}),
			"",
		].join("\n"),
	);
	return transcriptPath;
}

function writeCodexContextWindowTranscript(root: string): string {
	const transcriptPath = path.join(root, "transcript-codex-context-window.jsonl");
	writeFileSync(
		transcriptPath,
		[
			JSON.stringify({
				type: "message",
				payload: {
					content: {
						error: {
							code: "context_length_exceeded",
						},
					},
				},
			}),
			JSON.stringify({
				type: "message",
				payload: {
					content:
						"Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying.",
				},
			}),
			"",
		].join("\n"),
	);
	return transcriptPath;
}
