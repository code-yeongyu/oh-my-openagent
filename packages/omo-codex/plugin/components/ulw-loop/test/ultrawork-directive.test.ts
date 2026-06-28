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
});
