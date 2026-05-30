import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CodexPostCompactInput, CodexSessionStartInput, CodexUserPromptSubmitInput } from "../src/codex-hook.js";

export const PROJECT_RULES_ENV = {
	CODEX_RULES_ENABLED_SOURCES: "AGENTS.md,.omo/rules",
	CODEX_RULES_MAX_RESULT_CHARS: "50000",
	CODEX_RULES_MAX_RULE_CHARS: "30000",
};

export const EXPANDED_POST_COMPACT_ENV = {
	...PROJECT_RULES_ENV,
	CODEX_RULES_POST_COMPACT_MAX_RESULT_CHARS: "20000",
	CODEX_RULES_POST_COMPACT_MAX_RULE_CHARS: "12000",
};

const tempDirectories: string[] = [];
const DEFAULT_SESSION_ID = "session-post-compact-budget";

export function cleanupPostCompactFixtures(): void {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
}

export function makeOversizedProject(prefix = "budget"): { root: string; pluginData: string } {
	const root = mkdtempSync(path.join(tmpdir(), `codex-rules-post-compact-${prefix}-project-`));
	const pluginData = mkdtempSync(path.join(tmpdir(), `codex-rules-post-compact-${prefix}-data-`));
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

export function sessionStartInput(root: string, sessionId = DEFAULT_SESSION_ID): CodexSessionStartInput {
	return {
		session_id: sessionId,
		transcript_path: null,
		cwd: root,
		hook_event_name: "SessionStart",
		model: "gpt-5.5",
		permission_mode: "default",
		source: "startup",
	};
}

export function compactSessionStartInput(
	root: string,
	transcriptPath: string,
	sessionId = DEFAULT_SESSION_ID,
): CodexSessionStartInput {
	return {
		session_id: sessionId,
		transcript_path: transcriptPath,
		cwd: root,
		hook_event_name: "SessionStart",
		model: "gpt-5.5",
		permission_mode: "default",
		source: "compact",
	};
}

export function postCompactInput(root: string, sessionId = DEFAULT_SESSION_ID): CodexPostCompactInput {
	return {
		session_id: sessionId,
		turn_id: "turn-compact",
		transcript_path: null,
		cwd: root,
		hook_event_name: "PostCompact",
		model: "gpt-5.5",
		trigger: "auto",
	};
}

export function userPromptSubmitInput(
	root: string,
	transcriptPath: string,
	sessionId = DEFAULT_SESSION_ID,
): CodexUserPromptSubmitInput {
	return {
		session_id: sessionId,
		turn_id: "turn-after-compact",
		transcript_path: transcriptPath,
		cwd: root,
		hook_event_name: "UserPromptSubmit",
		model: "gpt-5.5",
		permission_mode: "default",
		prompt: "continue",
	};
}

export function writeCompactedTranscript(root: string, retainedText: string): string {
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

export function writeCompactedWarningTranscript(root: string, retainedText: string): string {
	const transcriptPath = path.join(root, "transcript-compacted-warning.jsonl");
	writeFileSync(
		transcriptPath,
		[
			JSON.stringify({
				type: "message",
				payload: {
					content: "Skill descriptions were shortened to fit the 2% skills context budget. Context compacted.",
				},
			}),
			JSON.stringify({
				type: "compacted",
				payload: {
					message: "summary",
					replacement_history: [{ type: "message", role: "user", content: retainedText }],
				},
			}),
			JSON.stringify({
				type: "message",
				payload: {
					content: "Your input exceeds the context window of this model. Please adjust your input and try again.",
				},
			}),
			"",
		].join("\n"),
	);
	return transcriptPath;
}

export function writeMalformedContextTooLargeTranscript(root: string, retainedText = ""): string {
	const transcriptPath = path.join(root, "transcript-context-too-large.jsonl");
	writeFileSync(
		transcriptPath,
		[
			"{not json",
			retainedText,
			JSON.stringify({
				type: "message",
				payload: {
					content: "Skill descriptions were shortened to fit the 2% skills context budget. Context compacted.",
				},
			}),
			JSON.stringify({
				type: "message",
				payload: {
					content: {
						error: {
							code: "context_too_large",
							message:
								"Your input exceeds the context window of this model. Please adjust your input and try again.",
						},
					},
				},
			}),
			"",
		].join("\n"),
	);
	return transcriptPath;
}

export function readOptionalAdditionalContext(output: string): string {
	if (output.trim().length === 0) {
		return "";
	}
	return readAdditionalContext(output);
}

export function readAdditionalContext(output: string): string {
	if (output.trim().length === 0) {
		throw new Error("Expected hook output to include additional context.");
	}
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
