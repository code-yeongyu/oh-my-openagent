import { afterEach, describe, expect, it } from "vitest";

import {
	buildAutoWorkflowContext,
	runUserPromptSubmitHook,
} from "../src/codex-hook.js";
import {
	cleanupTempDirectories,
	parseHookOutput,
	writeContextPressureTranscript,
	writeTranscript,
} from "./codex-hook-test-helpers.js";

afterEach(() => {
	cleanupTempDirectories();
});

describe("codex workflow selector hook", () => {
	const originalAutoWorkflowFlag = process.env["OMO_CODEX_AUTO_WORKFLOW"];

	afterEach(() => {
		if (originalAutoWorkflowFlag === undefined) {
			delete process.env["OMO_CODEX_AUTO_WORKFLOW"];
		} else {
			process.env["OMO_CODEX_AUTO_WORKFLOW"] = originalAutoWorkflowFlag;
		}
	});

	it("#given auto workflow is disabled #when prompt asks for debugging #then hook stays quiet", () => {
		// given
		delete process.env["OMO_CODEX_AUTO_WORKFLOW"];
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "Fix this flaky test and diagnose why CI is failing",
		};

		// when
		const output = runUserPromptSubmitHook(payload);

		// then
		expect(output).toBe("");
		expect(buildAutoWorkflowContext(payload.prompt, {})).toBeNull();
	});

	it("#given auto workflow is disabled #when transcript path is present #then hook does not read transcript", () => {
		// given
		let readCount = 0;
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "Fix this flaky test and diagnose why CI is failing",
			transcript_path: "/tmp/should-not-be-read.jsonl",
		};

		// when
		const output = runUserPromptSubmitHook(payload, {
			hookEnv: {},
			transcriptReader: () => {
				readCount += 1;
				throw new Error("Transcript should not be read while disabled");
			},
		});

		// then
		expect(output).toBe("");
		expect(readCount).toBe(0);
	});

	it("#given auto workflow is enabled #when prompt asks for debugging #then hook selects ulw-loop guidance", () => {
		// given
		process.env["OMO_CODEX_AUTO_WORKFLOW"] = "1";
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "Fix this flaky test and diagnose why CI is failing",
		};

		// when
		const output = runUserPromptSubmitHook(payload);
		const parsed = parseHookOutput(output);

		// then
		expect(parsed.hookSpecificOutput.additionalContext).toContain(
			"<lazycodex-auto-workflow>",
		);
		expect(parsed.hookSpecificOutput.additionalContext).toContain("$ulw-loop");
		expect(parsed.hookSpecificOutput.additionalContext).toContain(
			"manual QA evidence",
		);
	});

	it("#given auto workflow is enabled #when prompt asks for broad feature work #then hook selects plan and start-work guidance", () => {
		// given
		const prompt =
			"Add a settings page and implement the account preferences flow";

		// when
		const context = buildAutoWorkflowContext(prompt, {
			OMO_CODEX_AUTO_WORKFLOW: "true",
		});

		// then
		expect(context).not.toBeNull();
		expect(context).toContain("$ulw-plan");
		expect(context).toContain("$start-work");
		expect(context).toContain("plain Codex");
	});

	it("#given auto workflow is enabled #when prompt continues an approved plan #then hook selects start-work guidance", () => {
		// given
		const prompt = "Continue the approved plan";

		// when
		const context = buildAutoWorkflowContext(prompt, {
			OMO_CODEX_AUTO_WORKFLOW: "1",
		});

		// then
		expect(context).not.toBeNull();
		expect(context).toContain("$start-work");
		expect(context).toContain("existing plan instead of replanning");
		expect(context).not.toContain("$ulw-plan");
	});

	it("#given auto workflow is enabled #when prompt asks for repository onboarding #then hook selects init-deep guidance", () => {
		// given
		const prompt =
			"Map this unfamiliar repository before we change the architecture";

		// when
		const context = buildAutoWorkflowContext(prompt, {
			OMO_CODEX_AUTO_WORKFLOW: "on",
		});

		// then
		expect(context).not.toBeNull();
		expect(context).toContain("$init-deep");
		expect(context).toContain("weak-context repository onboarding");
	});

	it("#given auto workflow is enabled #when prompt is a small edit #then hook stays quiet", () => {
		// given
		const prompt = "Rename this variable";

		// when
		const context = buildAutoWorkflowContext(prompt, {
			OMO_CODEX_AUTO_WORKFLOW: "yes",
		});

		// then
		expect(context).toBeNull();
	});

	it("#given low-confidence overlapping prompt #when auto workflow is enabled #then hook asks confirmation before escalation", () => {
		// given
		const prompt = "Debug this failing test in a new unfamiliar repository";

		// when
		const context = buildAutoWorkflowContext(prompt, {
			OMO_CODEX_AUTO_WORKFLOW: "1",
		});

		// then
		expect(context).not.toBeNull();
		expect(context).toContain("Several LazyCodex workflows may fit");
		expect(context).toContain("Ask one concise confirmation");
		expect(context).toContain("debugging or recovery work");
		expect(context).toContain("weak-context repository onboarding");
	});

	it("#given explicit workflow command #when auto workflow is enabled #then selector stays quiet", () => {
		// given
		const prompts = [
			"ulw fix this",
			"$ulw-plan refactor auth",
			"$start-work continue",
			"$init-deep",
			"omo ulw-loop status",
		] as const;

		// when
		const contexts = prompts.map((prompt) =>
			buildAutoWorkflowContext(prompt, { OMO_CODEX_AUTO_WORKFLOW: "1" }),
		);

		// then
		expect(contexts).toEqual([null, null, null, null, null]);
	});

	it("#given transcript already contains auto workflow context #when prompt asks for debugging #then hook does not repeat guidance", () => {
		// given
		process.env["OMO_CODEX_AUTO_WORKFLOW"] = "1";
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "Why did the build fail? Please diagnose the error",
			transcript_path: writeTranscript(
				JSON.stringify({
					hookSpecificOutput: {
						hookEventName: "UserPromptSubmit",
						additionalContext: "<lazycodex-auto-workflow>\nexisting directive",
					},
				}),
			),
		};

		// when
		const output = runUserPromptSubmitHook(payload);

		// then
		expect(output).toBe("");
	});

	it("#given context-pressure transcript #when prompt asks for debugging #then hook stays quiet", () => {
		// given
		process.env["OMO_CODEX_AUTO_WORKFLOW"] = "1";
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "Fix this failing test",
			transcript_path: writeContextPressureTranscript(),
		};

		// when
		const output = runUserPromptSubmitHook(payload);

		// then
		expect(output).toBe("");
	});

	it("#given context-pressure marker outside transcript tail #when prompt asks for debugging #then hook scans only bounded tail", () => {
		// given
		process.env["OMO_CODEX_AUTO_WORKFLOW"] = "1";
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "Fix this failing test",
			transcript_path: writeTranscript(
				"Codex ran out of room in the model's context window.",
				"x".repeat(520_000),
			),
		};

		// when
		const output = runUserPromptSubmitHook(payload);
		const parsed = parseHookOutput(output);

		// then
		expect(parsed.hookSpecificOutput.additionalContext).toContain(
			"<lazycodex-auto-workflow>",
		);
	});

	it("#given malformed or empty input #when hook runs #then exits with empty output", () => {
		// given
		process.env["OMO_CODEX_AUTO_WORKFLOW"] = "1";
		const inputs = [
			undefined,
			{},
			{ hook_event_name: "UserPromptSubmit", prompt: "" },
		] as const;

		// when
		const outputs = inputs.map((input) => runUserPromptSubmitHook(input));

		// then
		expect(outputs).toEqual(["", "", ""]);
	});
});
