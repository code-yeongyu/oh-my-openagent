import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { isUltraworkPrompt, runUserPromptSubmitHook } from "../src/codex-hook.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("codex ultrawork hook", () => {
	it("#given ultrawork prompt #when hook runs #then emits directive as Codex hook JSON", () => {
		// given
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "please ulw this change",
		};

		// when
		const output = runUserPromptSubmitHook(payload);
		const parsed = parseHookOutput(output);

		// then
		expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
		expect(parsed.hookSpecificOutput.additionalContext).toMatch(/^<ultrawork-mode>/);
		expect(parsed.hookSpecificOutput.additionalContext).toMatch(/First user-visible line this turn MUST be exactly:/);
	});

	it("#given transcript already contains ultrawork directive #when hook sees ultrawork prompt #then it does not repeat directive", () => {
		// given
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "please ulw this change",
			transcript_path: writeTranscript(
				JSON.stringify({
					hookSpecificOutput: {
						hookEventName: "UserPromptSubmit",
						additionalContext: "<ultrawork-mode>\nexisting directive",
					},
				}),
			),
		};

		// when
		const output = runUserPromptSubmitHook(payload);

		// then
		expect(output).toBe("");
	});

	it("#given transcript only mentions ultrawork marker in user content #when hook sees first ultrawork prompt #then it emits directive", () => {
		// given
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "please ulw this change",
			transcript_path: writeTranscript(
				JSON.stringify({
					role: "user",
					content: "Please inspect text containing <ultrawork-mode> but do not activate yet.",
				}),
			),
		};

		// when
		const output = runUserPromptSubmitHook(payload);
		const parsed = parseHookOutput(output);

		// then
		expect(parsed.hookSpecificOutput.additionalContext).toMatch(/^<ultrawork-mode>/);
	});

	it("#given identifier-like ulw #when hook runs #then does not emit directive", () => {
		// given
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "refactor ulw_helper.ts",
		};

		// when
		const output = runUserPromptSubmitHook(payload);

		// then
		expect(output).toBe("");
		expect(isUltraworkPrompt("ulw_helper.ts")).toBe(false);
	});

	it("#given context-pressure recovery prompt with ulw #when hook runs #then does not add more context", () => {
		// given
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: [
				"Warning: Skill descriptions were shortened to fit the 2% skills context budget.",
				"Warning: Long threads and multiple compactions can cause the model to be less accurate.",
				"Context compacted",
				"error context_too_large: Your input exceeds the context window of this model.",
				"ulw tdd commit well",
			].join("\n"),
		};

		// when
		const output = runUserPromptSubmitHook(payload);

		// then
		expect(output).toBe("");
	});

	it("#given context-pressure transcript with ulw prompt #when hook runs #then does not add more context", () => {
		// given
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "please ulw this change",
			transcript_path: writeContextPressureTranscript(),
		};

		// when
		const output = runUserPromptSubmitHook(payload);

		// then
		expect(output).toBe("");
	});

	it("#given Codex canonical context-window transcript with ulw prompt #when hook runs #then does not add more context", () => {
		// given
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "please ulw this change",
			transcript_path: writeCodexContextWindowTranscript(),
		};

		// when
		const output = runUserPromptSubmitHook(payload);

		// then
		expect(output).toBe("");
	});

	it("#given context-pressure recovery prompt without ulw #when hook runs #then stays quiet", () => {
		// given
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: [
				"Context compacted",
				"Your input exceeds the context window of this model.",
				"Please adjust your input and try again.",
			].join("\n"),
		};

		// when
		const output = runUserPromptSubmitHook(payload);

		// then
		expect(output).toBe("");
	});

	it("#given malformed or empty input #when hook runs #then exits with empty output", () => {
		// given
		const inputs = [undefined, {}, { hook_event_name: "UserPromptSubmit", prompt: "" }] as const;

		// when
		const outputs = inputs.map((input) => runUserPromptSubmitHook(input));

		// then
		expect(outputs).toEqual(["", "", ""]);
	});

	it("#given directive #when inspected #then keeps manual QA and cleanup invariants", () => {
		// given
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "please ultrawork",
		};

		// when
		const output = runUserPromptSubmitHook(payload);
		const parsed = parseHookOutput(output);

		// then
		expect(parsed.hookSpecificOutput.additionalContext).toMatch(/# Manual-QA channels/);
		expect(parsed.hookSpecificOutput.additionalContext).toMatch(/TESTS ALONE NEVER PROVE DONE/);
		expect(parsed.hookSpecificOutput.additionalContext).toMatch(/1\. HTTP call/);
		expect(parsed.hookSpecificOutput.additionalContext).toMatch(/2\. tmux/);
		expect(parsed.hookSpecificOutput.additionalContext).toMatch(/3\. Browser use/);
		expect(parsed.hookSpecificOutput.additionalContext).toMatch(/4\. Computer use/);
		expect(parsed.hookSpecificOutput.additionalContext).toMatch(/CLEANUP \(PAIRED/);
	});

	it("#given directive #when inspected #then avoids context-expensive agent polling", () => {
		// given
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "please ultrawork",
		};

		// when
		const output = runUserPromptSubmitHook(payload);
		const parsed = parseHookOutput(output);

		// then
		const directive = parsed.hookSpecificOutput.additionalContext;
		expect(directive).toMatch(/list_agents/);
		expect(directive).toMatch(/polling or status tool/);
		expect(directive).toMatch(/replay large agent status and latest-message\s+payloads/);
		expect(directive).toMatch(/Track spawned agent names locally/);
		expect(directive).toMatch(/wait_agent[\s\S]*completion/);
		expect(directive).toMatch(/targeted\s+followups only when needed/);
		expect(directive).toMatch(/close_agent[\s\S]*after integrating each\s+result/);
		expect(directive).toMatch(/Plan and reviewer agents\s+may run for a long time/);
		expect(directive).toMatch(/short wait_agent cycles/);
		expect(directive).toMatch(/single long blocking wait/);
	});

	it("#given directive #when inspected #then hardens Codex subagent assignment ambiguity", () => {
		// given
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "please ultrawork",
		};

		// when
		const output = runUserPromptSubmitHook(payload);
		const parsed = parseHookOutput(output);

		// then
		const directive = parsed.hookSpecificOutput.additionalContext;
		expect(directive).toMatch(/TASK:/);
		expect(directive).toMatch(/fork_turns:\s*"none"/);
		expect(directive).toMatch(/wait_agent[\s\S]*signal, not\s+proof/);
		expect(directive).toMatch(/one targeted followup/);
		expect(directive).toMatch(/respawn.*smaller/);
	});
});

interface UserPromptSubmitHookOutput {
	readonly hookSpecificOutput: {
		readonly hookEventName: "UserPromptSubmit";
		readonly additionalContext: string;
	};
}

function parseHookOutput(output: string): UserPromptSubmitHookOutput {
	const parsed: unknown = JSON.parse(output);
	if (!isUserPromptSubmitHookOutput(parsed)) throw new TypeError("Expected UserPromptSubmit hook output");
	return parsed;
}

function isUserPromptSubmitHookOutput(value: unknown): value is UserPromptSubmitHookOutput {
	if (!isRecord(value)) return false;
	const hookSpecificOutput = value["hookSpecificOutput"];
	return (
		isRecord(hookSpecificOutput) &&
		hookSpecificOutput["hookEventName"] === "UserPromptSubmit" &&
		typeof hookSpecificOutput["additionalContext"] === "string"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeContextPressureTranscript(): string {
	const root = mkdtempSync(path.join(tmpdir(), "codex-ultrawork-context-pressure-"));
	tempDirectories.push(root);
	const transcriptPath = path.join(root, "transcript.jsonl");
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

function writeTranscript(...lines: string[]): string {
	const root = mkdtempSync(path.join(tmpdir(), "codex-ultrawork-transcript-"));
	tempDirectories.push(root);
	const transcriptPath = path.join(root, "transcript.jsonl");
	writeFileSync(transcriptPath, `${lines.join("\n")}\n`);
	return transcriptPath;
}

function writeCodexContextWindowTranscript(): string {
	const root = mkdtempSync(path.join(tmpdir(), "codex-ultrawork-context-window-"));
	tempDirectories.push(root);
	const transcriptPath = path.join(root, "transcript.jsonl");
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
