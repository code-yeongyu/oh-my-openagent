import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tempDirectories: string[] = [];

interface UserPromptSubmitHookOutput {
	readonly hookSpecificOutput: {
		readonly hookEventName: "UserPromptSubmit";
		readonly additionalContext: string;
	};
}

export function cleanupTempDirectories(): void {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
}

export function parseHookOutput(output: string): UserPromptSubmitHookOutput {
	const parsed: unknown = JSON.parse(output);
	if (!isUserPromptSubmitHookOutput(parsed))
		throw new TypeError("Expected UserPromptSubmit hook output");
	return parsed;
}

export function writeTranscript(...lines: string[]): string {
	const root = mkdtempSync(
		path.join(tmpdir(), "codex-workflow-selector-transcript-"),
	);
	tempDirectories.push(root);
	const transcriptPath = path.join(root, "transcript.jsonl");
	writeFileSync(transcriptPath, `${lines.join("\n")}\n`);
	return transcriptPath;
}

export function writeContextPressureTranscript(): string {
	return writeTranscript(
		JSON.stringify({
			type: "message",
			payload: {
				content: "Codex ran out of room in the model's context window.",
			},
		}),
	);
}

function isUserPromptSubmitHookOutput(
	value: unknown,
): value is UserPromptSubmitHookOutput {
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
