import { afterEach, describe, expect, it } from "vitest";

import { isUltraworkPrompt, runUserPromptSubmitHook } from "../src/codex-hook.js";
import { cleanupTempDirectories, parseHookOutput, writeTranscript } from "./codex-hook-test-helpers.js";

afterEach(() => {
	cleanupTempDirectories();
});

describe("codex ultrawork trigger policy", () => {
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
});
