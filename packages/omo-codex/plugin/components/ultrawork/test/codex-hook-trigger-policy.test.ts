import { afterEach, describe, expect, it } from "vitest";

import { buildAutoWorkflowContext, isUltraworkPrompt, runUserPromptSubmitHook } from "../src/codex-hook.js";
import { cleanupTempDirectories, parseHookOutput, writeTranscript } from "./codex-hook-test-helpers.js";

afterEach(() => {
	cleanupTempDirectories();
});

describe("codex ultrawork trigger policy", () => {
	const originalAutoWorkflowFlag = process.env["OMO_CODEX_AUTO_WORKFLOW"];

	afterEach(() => {
		if (originalAutoWorkflowFlag === undefined) {
			delete process.env["OMO_CODEX_AUTO_WORKFLOW"];
		} else {
			process.env["OMO_CODEX_AUTO_WORKFLOW"] = originalAutoWorkflowFlag;
		}
	});

	it("#given ultrawork variants in current prompt #when hook runs #then emits directive", () => {
		// given
		const prompts = ["ultrawork this change", "Ultrawork this change", "ULTRAWORK this change"] as const;

		// when
		const outputs = prompts.map((prompt) => runUserPromptSubmitHook({ hook_event_name: "UserPromptSubmit", prompt }));

		// then
		expect(outputs.map((output) => parseHookOutput(output).hookSpecificOutput.hookEventName)).toEqual([
			"UserPromptSubmit",
			"UserPromptSubmit",
			"UserPromptSubmit",
		]);
		expect(prompts.map((prompt) => isUltraworkPrompt(prompt))).toEqual([true, true, true]);
	});

	it("#given ulw variants in current prompt #when hook runs #then emits directive", () => {
		// given
		const prompts = [
			"ulw this change",
			"Ulw this change",
			"ULW this change",
			"하이ulw",
			"refactor ulw_helper.ts",
		] as const;

		// when
		const outputs = prompts.map((prompt) => runUserPromptSubmitHook({ hook_event_name: "UserPromptSubmit", prompt }));

		// then
		expect(outputs.map((output) => parseHookOutput(output).hookSpecificOutput.hookEventName)).toEqual([
			"UserPromptSubmit",
			"UserPromptSubmit",
			"UserPromptSubmit",
			"UserPromptSubmit",
			"UserPromptSubmit",
		]);
		expect(prompts.map((prompt) => isUltraworkPrompt(prompt))).toEqual([true, true, true, true, true]);
	});

	it("#given sentence-level triggers in current prompt #when hook runs #then emits directive", () => {
		// given
		const prompts = ["please ulw this change", "why did ultrawork trigger here?"] as const;

		// when
		const outputs = prompts.map((prompt) => runUserPromptSubmitHook({ hook_event_name: "UserPromptSubmit", prompt }));

		// then
		expect(outputs.map((output) => parseHookOutput(output).hookSpecificOutput.hookEventName)).toEqual([
			"UserPromptSubmit",
			"UserPromptSubmit",
		]);
		expect(prompts.map((prompt) => isUltraworkPrompt(prompt))).toEqual([true, true]);
	});

	it("#given reported prompt contains trigger text in current prompt #when hook runs #then emits directive", () => {
		// given
		const prompt = [
			"그 ",
			"› 그 인증이 문제면 $computer-use:computer-use $chrome:control-chrome ssh mengmotaMac 등 해서 인증을 다 잘 되게 하게해서 인증해주셈",
			"",
			"",
			"• ULTRAWORK MODE ENABLED!",
			"",
			"",
			"이런 일이 있었는데, 왜 단순히 프롬프트를 쳤는데, ultrawork 가 발생했는데 우리 여기 omo codex 코드랑 코덱스 세션들 안에 내용 다 봐봐주셈",
			"",
			"ultrawork mode enabled 는 ulw 쳤을때에만 떠야되는데 왜 안그럼?",
		].join("\n");

		// when
		const output = runUserPromptSubmitHook({ hook_event_name: "UserPromptSubmit", prompt });
		const parsed = parseHookOutput(output);

		// then
		expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
		expect(parsed.hookSpecificOutput.additionalContext).toMatch(/^<ultrawork-mode>/);
		expect(isUltraworkPrompt(prompt)).toBe(true);
	});

	it("#given prior transcript contains triggers but current prompt does not #when hook runs #then does not emit directive", () => {
		// given
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "please explain why the banner appeared",
			transcript_path: writeTranscript(
				JSON.stringify({
					role: "user",
					content: "ultrawork ULTRAWORK ulw 하이ulw this older task",
				}),
			),
		};

		// when
		const output = runUserPromptSubmitHook(payload);

		// then
		expect(output).toBe("");
		expect(isUltraworkPrompt(payload.prompt)).toBe(false);
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

	it("#given auto workflow is enabled #when prompt asks for debugging #then hook selects ulw-loop guidance", () => {
		// given
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "Fix this flaky test and diagnose why CI is failing",
		};
		process.env["OMO_CODEX_AUTO_WORKFLOW"] = "1";

		// when
		const output = runUserPromptSubmitHook(payload);
		const parsed = parseHookOutput(output);

		// then
		expect(parsed.hookSpecificOutput.additionalContext).toContain("<lazycodex-auto-workflow>");
		expect(parsed.hookSpecificOutput.additionalContext).toContain("$ulw-loop");
		expect(parsed.hookSpecificOutput.additionalContext).toContain("manual QA evidence");
	});

	it("#given auto workflow is enabled #when prompt asks for broad feature work #then hook selects plan and start-work guidance", () => {
		// given
		const prompt = "Add a settings page and implement the account preferences flow";

		// when
		const context = buildAutoWorkflowContext(prompt, { OMO_CODEX_AUTO_WORKFLOW: "true" });

		// then
		expect(context).not.toBeNull();
		expect(context).toContain("$ulw-plan");
		expect(context).toContain("$start-work");
		expect(context).toContain("ask one concise confirmation");
	});

	it("#given auto workflow is enabled #when prompt asks for repository onboarding #then hook selects init-deep guidance", () => {
		// given
		const prompt = "Map this unfamiliar repository before we change the architecture";

		// when
		const context = buildAutoWorkflowContext(prompt, { OMO_CODEX_AUTO_WORKFLOW: "on" });

		// then
		expect(context).not.toBeNull();
		expect(context).toContain("$init-deep");
		expect(context).toContain("weak-context repository onboarding");
	});

	it("#given auto workflow is enabled #when prompt is a small edit #then hook stays quiet", () => {
		// given
		const prompt = "Rename this variable";

		// when
		const context = buildAutoWorkflowContext(prompt, { OMO_CODEX_AUTO_WORKFLOW: "yes" });

		// then
		expect(context).toBeNull();
	});

	it("#given auto workflow is enabled and transcript already contains ultrawork directive #when prompt asks for debugging #then hook does not repeat guidance", () => {
		// given
		process.env["OMO_CODEX_AUTO_WORKFLOW"] = "1";
		const payload = {
			hook_event_name: "UserPromptSubmit",
			prompt: "Why did the build fail? Please diagnose the error",
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

	it("#given auto workflow is enabled and transcript already contains auto workflow context #when prompt asks for debugging #then hook does not repeat guidance", () => {
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
});
