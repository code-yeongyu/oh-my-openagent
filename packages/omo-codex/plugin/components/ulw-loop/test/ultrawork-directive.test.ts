import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { applyUserPromptUlwLoopSteering, type UserPromptSubmitPayload } from "../src/codex-hook.js";

const DEFAULT_SESSION_ID = "s1";

function payload(prompt: string, cwd: string): UserPromptSubmitPayload {
	return { cwd, hook_event_name: "UserPromptSubmit", prompt, session_id: DEFAULT_SESSION_ID };
}

async function payloadWithTranscript(prompt: string, transcript: string): Promise<UserPromptSubmitPayload> {
	const repoRoot = await mkdtemp(join(tmpdir(), "ug-hook-transcript-"));
	const transcriptPath = join(repoRoot, "transcript.jsonl");
	await writeFile(transcriptPath, transcript);
	return { ...payload(prompt, repoRoot), transcript_path: transcriptPath };
}

describe("standalone ultrawork directive injection", () => {
	it("#given standalone ultrawork injection is enabled #when prompt is ulw #then emits the ultrawork directive", async () => {
		const output = await applyUserPromptUlwLoopSteering(payload("ulw this change", "/tmp"), {
			includeUltraworkDirective: true,
		});
		const parsed = JSON.parse(output);

		expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
		expect(parsed.hookSpecificOutput.additionalContext).toMatch(/^<ultrawork-mode>/);
	});

	it("#given transcript already has ultrawork directive #when standalone injection is enabled #then emits no duplicate", async () => {
		const input = await payloadWithTranscript(
			"ulw this change",
			`${JSON.stringify({
				hookSpecificOutput: {
					hookEventName: "UserPromptSubmit",
					additionalContext: "<ultrawork-mode>\nexisting directive",
				},
			})}\n`,
		);

		expect(await applyUserPromptUlwLoopSteering(input, { includeUltraworkDirective: true })).toBe("");
	});

	it("#given context-pressure marker exists only outside transcript tail #when standalone injection is enabled #then emits the directive", async () => {
		const input = await payloadWithTranscript(
			"ulw this change",
			`context_length_exceeded\n${"old transcript padding\n".repeat(32_000)}`,
		);
		const output = await applyUserPromptUlwLoopSteering(input, { includeUltraworkDirective: true });
		const parsed = JSON.parse(output);

		expect(parsed.hookSpecificOutput.additionalContext).toMatch(/^<ultrawork-mode>/);
	});

	it("#given ulw-loop bundles the ultrawork directive #when compared to ultrawork #then the copy stays byte-identical", async () => {
		const ulwLoopDirective = await readFile(new URL("../directive.md", import.meta.url), "utf8");
		const ultraworkDirective = await readFile(new URL("../../ultrawork/directive.md", import.meta.url), "utf8");

		expect(ulwLoopDirective).toBe(ultraworkDirective);
	});

	it("#given an existing ultrawork skill file #when standalone injection runs #then emits the compact skill pointer", async () => {
		const skillFilePath = join(await mkdtemp(join(tmpdir(), "ug-skill-")), "SKILL.md");
		await writeFile(
			skillFilePath,
			"---\nname: ultrawork\n---\n\n<ultrawork-mode>\ndirective body\n</ultrawork-mode>\n",
		);

		const output = await applyUserPromptUlwLoopSteering(payload("ulw this change", "/tmp"), {
			includeUltraworkDirective: true,
			ultraworkSkillFilePath: skillFilePath,
		});
		const parsed = JSON.parse(output);
		const context = parsed.hookSpecificOutput.additionalContext;

		expect(context).toMatch(/^<ultrawork-mode>/);
		expect(context).toContain(skillFilePath);
		expect(context).toContain("create_goal");
		expect(context).not.toContain("Tier triage");
	});

	it("#given a missing ultrawork skill file #when standalone injection runs #then falls back to the full directive", async () => {
		const missingSkillFilePath = join(await mkdtemp(join(tmpdir(), "ug-skill-")), "SKILL.md");

		const output = await applyUserPromptUlwLoopSteering(payload("ulw this change", "/tmp"), {
			includeUltraworkDirective: true,
			ultraworkSkillFilePath: missingSkillFilePath,
		});
		const parsed = JSON.parse(output);

		expect(parsed.hookSpecificOutput.additionalContext).toContain("Tier triage");
	});

	it("#given the ulw-loop pointer template #when compared to ultrawork #then the copy stays byte-identical", async () => {
		const ulwLoopPointerSource = await readFile(
			new URL("../src/ultrawork-skill-pointer.ts", import.meta.url),
			"utf8",
		);
		const ultraworkPointerSource = await readFile(
			new URL("../../ultrawork/src/skill-pointer.ts", import.meta.url),
			"utf8",
		);
		const templatePattern = /export const ULTRAWORK_SKILL_POINTER_TEMPLATE = `[\s\S]*?`;\n/;
		const ulwLoopTemplate = ulwLoopPointerSource.match(templatePattern)?.[0];
		const ultraworkTemplate = ultraworkPointerSource.match(templatePattern)?.[0];

		expect(ulwLoopTemplate).toBeDefined();
		expect(ulwLoopTemplate).toBe(ultraworkTemplate);
	});
});
