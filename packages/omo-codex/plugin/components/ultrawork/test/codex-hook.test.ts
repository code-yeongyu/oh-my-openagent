import { afterEach, describe, expect, it } from "vitest";

import { runUserPromptSubmitHook } from "../src/codex-hook.js";
import {
	cleanupTempDirectories,
	parseHookOutput,
	writeCodexContextWindowTranscript,
	writeContextPressureTranscript,
	writeTranscript,
} from "./codex-hook-test-helpers.js";

afterEach(() => {
	cleanupTempDirectories();
});

describe("codex ultrawork hook", () => {
	it("#given ultrawork prompt #when hook runs #then emits directive as Codex hook JSON", () => {
		// given
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "ulw this change",
		};

		// when
		const output = runUserPromptSubmitHook(payload);
		const parsed = parseHookOutput(output);

		// then
		expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
		expect(parsed.hookSpecificOutput.additionalContext).toMatch(/^<ultrawork-mode>/);
		expect(parsed.hookSpecificOutput.additionalContext).toMatch(/First user-visible line this turn MUST be exactly:/);
	});

	it("#given Windows cwd #when hook sees ultrawork prompt #then emits directive as Codex hook JSON", () => {
		// given
		const payload = {
			cwd: "C:\\Users\\codex\\project",
			hook_event_name: "UserPromptSubmit",
			model: "gpt-5.5",
			permission_mode: "default",
			prompt: "ulw this change",
			session_id: "s",
			transcript_path: null,
			turn_id: "t",
		};

		// when
		const output = runUserPromptSubmitHook(payload);
		const parsed = parseHookOutput(output);

		// then
		expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
		expect(parsed.hookSpecificOutput.additionalContext).toMatch(/^<ultrawork-mode>/);
	});

	it("#given transcript already contains ultrawork directive #when hook sees ultrawork prompt #then it does not repeat directive", () => {
		// given
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "ulw this change",
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

	it("#given transcript only mentions ultrawork marker in user content #when hook sees first ulw command #then it emits directive", () => {
		// given
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "ulw this change",
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
			prompt: "ulw this change",
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
			prompt: "ulw this change",
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
			prompt: "ulw",
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
		expect(parsed.hookSpecificOutput.additionalContext).toMatch(/refresh current branch\/PR\/issue state/);
		expect(parsed.hookSpecificOutput.additionalContext).toMatch(/preserve existing ordering\/policy/);
		expect(parsed.hookSpecificOutput.additionalContext).toMatch(
			/separate compatibility detection from policy changes/,
		);
	});

	it("#given directive #when inspected #then avoids context-expensive agent polling", () => {
		// given
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "ulw",
		};

		// when
		const output = runUserPromptSubmitHook(payload);
		const parsed = parseHookOutput(output);

		// then
		const directive = parsed.hookSpecificOutput.additionalContext;
		expect(directive).toMatch(/multi_agent_v1\.wait_agent/);
		expect(directive).toMatch(/Track spawned agent names locally/);
		expect(directive).toMatch(/wait_agent[\s\S]*mailbox/);
		expect(directive).toMatch(/WORKING:/);
		expect(directive).toMatch(/TASK STILL ACTIVE/);
		expect(directive).toMatch(/Treat child status as a progress signal/);
	});

	it("#given directive #when inspected #then hardens Codex subagent assignment ambiguity", () => {
		// given
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "ulw",
		};

		// when
		const output = runUserPromptSubmitHook(payload);
		const parsed = parseHookOutput(output);

		// then
		const directive = parsed.hookSpecificOutput.additionalContext;
		expect(directive).toMatch(/TASK:/);
		expect(directive).toMatch(/fork_context:\s*false/);
		expect(directive).toMatch(/wait_agent[\s\S]*mailbox/);
		expect(directive).toMatch(/TASK STILL ACTIVE/);
		expect(directive).toMatch(/respawn.*smaller/);
		expect(directive).toMatch(/timeout only means no new mailbox update arrived/i);
		expect(directive).toMatch(/WORKING:/);
	});

	it("#given directive #when inspected #then keeps impact-proportional sizing invariants", () => {
		// given
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "ulw",
		};

		// when
		const output = runUserPromptSubmitHook(payload);
		const parsed = parseHookOutput(output);

		// then
		const directive = parsed.hookSpecificOutput.additionalContext;
		expect(directive).toMatch(/# Tier triage/);
		expect(directive).toMatch(/Default is LIGHT/);
		expect(directive).toMatch(/Take HEAVY/);
		expect(directive).toMatch(/ratchet up only/i);
		expect(directive).toMatch(/`plan` agent/);
	});
});
