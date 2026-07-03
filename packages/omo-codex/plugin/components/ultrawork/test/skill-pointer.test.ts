import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runUserPromptSubmitHook } from "../src/codex-hook.js";
import { ULTRAWORK_DIRECTIVE } from "../src/directive.js";
import { buildUltraworkAdditionalContext, buildUltraworkSkillPointer } from "../src/skill-pointer.js";
import { parseHookOutput } from "./codex-hook-test-helpers.js";

const POINTER_MAX_BYTES = 4096;
const tempDirectories: string[] = [];

function makeTempDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "ultrawork-skill-"));
	tempDirectories.push(directory);
	return directory;
}

function writeSkillFile(): string {
	const skillFilePath = join(makeTempDirectory(), "SKILL.md");
	writeFileSync(skillFilePath, "---\nname: ultrawork\n---\n\n<ultrawork-mode>\ndirective body\n</ultrawork-mode>\n");
	return skillFilePath;
}

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("ultrawork skill pointer", () => {
	it("#given an existing skill file #when context is built #then emits the compact pointer with the absolute path", () => {
		// given
		const skillFilePath = writeSkillFile();

		// when
		const context = buildUltraworkAdditionalContext({ skillFilePath });

		// then
		expect(context).toBe(buildUltraworkSkillPointer(skillFilePath));
		expect(context.startsWith("<ultrawork-mode>")).toBe(true);
		expect(context).toContain(skillFilePath);
		expect(context).toContain("First user-visible line this turn MUST be exactly:");
		expect(context).toContain("create_goal");
		expect(context).not.toContain("Tier triage");
		expect(Buffer.byteLength(context, "utf8")).toBeLessThan(POINTER_MAX_BYTES);
	});

	it("#given a missing skill file #when context is built #then falls back to the full directive", () => {
		// given
		const missingSkillFilePath = join(makeTempDirectory(), "SKILL.md");

		// when
		const context = buildUltraworkAdditionalContext({ skillFilePath: missingSkillFilePath });

		// then
		expect(context).toBe(ULTRAWORK_DIRECTIVE);
	});

	it("#given a null skill path #when context is built #then falls back to the full directive", () => {
		expect(buildUltraworkAdditionalContext({ skillFilePath: null })).toBe(ULTRAWORK_DIRECTIVE);
	});

	it("#given the hook runs with a skill file #when prompt is ulw #then hook JSON carries the pointer", () => {
		// given
		const skillFilePath = writeSkillFile();

		// when
		const output = runUserPromptSubmitHook(
			{ hook_event_name: "UserPromptSubmit", prompt: "ulw this change" },
			{ skillFilePath },
		);
		const parsed = parseHookOutput(output);

		// then
		expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
		expect(parsed.hookSpecificOutput.additionalContext).toMatch(/^<ultrawork-mode>/);
		expect(parsed.hookSpecificOutput.additionalContext).toContain(skillFilePath);
	});
});
