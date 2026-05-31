import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	type CodexPostCompactInput,
	type CodexSessionStartInput,
	runPostCompactHook,
	runSessionStartHook,
	runUserPromptSubmitHook,
} from "../src/codex-hook.js";

const tempDirectories: string[] = [];
const PROJECT_RULES_ENV = {
	CODEX_RULES_ENABLED_SOURCES: "AGENTS.md,.omo/rules",
	CODEX_RULES_MAX_RESULT_CHARS: "50000",
	CODEX_RULES_MAX_RULE_CHARS: "30000",
};

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("codex rules post-compaction context budget", () => {
	it("#given oversized project rules already injected #when static recovery runs after compaction #then it emits no duplicate budget block", async () => {
		// given
		const { root, pluginData } = makeOversizedProject();
		const firstOutput = await runSessionStartHook(sessionStartInput(root), {
			pluginDataRoot: pluginData,
			env: PROJECT_RULES_ENV,
		});
		const firstContext = readAdditionalContext(firstOutput);
		const transcriptPath = writeCompactedTranscript(root, "summary dropped injected rules");
		await runPostCompactHook(
			{ ...postCompactInput(root), transcript_path: transcriptPath },
			{ pluginDataRoot: pluginData },
		);

		// when
		const output = await runUserPromptSubmitHook(userPromptSubmitInput(root, transcriptPath), {
			pluginDataRoot: pluginData,
			env: PROJECT_RULES_ENV,
		});

		// then
		expect(firstContext.length).toBeGreaterThan(20_000);
		expect(output).toBe("");
	});
});

function makeOversizedProject(): { root: string; pluginData: string } {
	const root = mkdtempSync(path.join(tmpdir(), "codex-rules-post-compact-budget-project-"));
	const pluginData = mkdtempSync(path.join(tmpdir(), "codex-rules-post-compact-budget-data-"));
	tempDirectories.push(root, pluginData);
	writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture" }));
	writeFileSync(path.join(root, "AGENTS.md"), `Project rule\n${"A".repeat(30_000)}`);
	mkdirSync(path.join(root, ".omo", "rules"), { recursive: true });
	writeFileSync(
		path.join(root, ".omo", "rules", "typescript.md"),
		["---", 'globs: "**/*.ts"', "---", "", `TypeScript rule\n${"B".repeat(30_000)}`].join("\n"),
	);
	return { root, pluginData };
}

function sessionStartInput(root: string): CodexSessionStartInput {
	return {
		session_id: "session-post-compact-budget",
		transcript_path: null,
		cwd: root,
		hook_event_name: "SessionStart",
		model: "gpt-5.5",
		permission_mode: "default",
		source: "startup",
	};
}

function postCompactInput(root: string): CodexPostCompactInput {
	return {
		session_id: "session-post-compact-budget",
		turn_id: "turn-compact",
		transcript_path: null,
		cwd: root,
		hook_event_name: "PostCompact",
		model: "gpt-5.5",
		trigger: "auto",
	};
}

function userPromptSubmitInput(root: string, transcriptPath: string): Parameters<typeof runUserPromptSubmitHook>[0] {
	return {
		session_id: "session-post-compact-budget",
		turn_id: "turn-after-compact",
		transcript_path: transcriptPath,
		cwd: root,
		hook_event_name: "UserPromptSubmit",
		model: "gpt-5.5",
		permission_mode: "default",
		prompt: "continue",
	};
}

function writeCompactedTranscript(root: string, retainedText: string): string {
	const transcriptPath = path.join(root, "transcript-compacted.jsonl");
	writeFileSync(
		transcriptPath,
		`${JSON.stringify({
			type: "compacted",
			payload: {
				message: "summary",
				replacement_history: [{ type: "message", role: "user", content: retainedText }],
			},
		})}\n`,
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
