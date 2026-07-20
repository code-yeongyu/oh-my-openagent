import type { ContinuationState } from "./boulder-reader.js";
import { readContinuationState } from "./boulder-reader.js";
import { START_WORK_CONTINUATION_DIRECTIVE } from "./directive.js";
import type { ReadonlyFileSystem, StopHookEventName, StopHookOutput, StopInput } from "./types.js";
import { readUlwSnapshotSummary } from "./ulw-snapshot-reader.js";

export function runStopHook(input: unknown, fs: ReadonlyFileSystem): string {
	if (!isStopInput(input)) return "";
	if (input.stop_hook_active) return "";
	if (transcriptHasContextPressureMarker(input.transcript_path, fs)) return "";
	const state = readContinuationState(input.cwd, input.session_id);
	if (state === null) return "";
	const snapshot = readUlwSnapshotSummary(input.cwd, input.session_id, state.worktreePath, fs);
	return JSON.stringify({
		decision: "block",
		reason: renderDirective(state, input.session_id, snapshot),
	} satisfies StopHookOutput);
}

function renderDirective(
	state: ContinuationState,
	sessionId: string,
	snapshot: { readonly path: string; readonly nextAction: string } | null,
): string {
	const lineBreak = String.fromCharCode(10);
	const worktreeBlock =
		state.worktreePath === null
			? ""
			: `${lineBreak}- Worktree: \`${state.worktreePath}\` (all edits, tests, and commands run inside this directory)`;
	const snapshotBlock =
		snapshot === null
			? ""
			: [
					"",
					"# Repo-native ULW snapshot",
					"",
					`- Snapshot path: \`${snapshot.path}\``,
					`- Next action: ${JSON.stringify(snapshot.nextAction)}`,
					"",
				].join(lineBreak);
	const replacements = {
		PLAN_NAME: state.planName,
		PLAN_PATH: state.planPath,
		BOULDER_PATH: state.boulderPath,
		REMAINING_COUNT: String(state.checklist.remaining),
		TOTAL_COUNT: String(state.checklist.total),
		NEXT_TASK_LABEL: state.checklist.nextTaskLabel ?? "none (final gate pending)",
		WORKTREE_BLOCK: worktreeBlock,
		LEDGER_PATH: state.ledgerPath,
		SESSION_ID: sessionId,
		ULW_SNAPSHOT_BLOCK: snapshotBlock,
	} as const;
	let rendered = START_WORK_CONTINUATION_DIRECTIVE;
	for (const [placeholder, value] of Object.entries(replacements)) {
		rendered = rendered.replaceAll(`{{${placeholder}}}`, value);
	}
	return rendered;
}

const CONTEXT_PRESSURE_MARKERS = [
	"context compacted",
	"context_length_exceeded",
	"skill descriptions were shortened",
	"context_too_large",
	"codex ran out of room in the model's context window",
	"your input exceeds the context window",
	"long threads and multiple compactions",
] as const;

function transcriptHasContextPressureMarker(transcriptPath: string, fs: ReadonlyFileSystem): boolean {
	try {
		const transcript = fs.readFileSync(transcriptPath, "utf8").toLowerCase();
		return CONTEXT_PRESSURE_MARKERS.some((marker) => transcript.includes(marker));
	} catch (error) {
		if (error instanceof Error) return false;
		throw error;
	}
}

function isStopInput(value: unknown): value is StopInput {
	return (
		isRecord(value) &&
		isStopHookEventName(value["hook_event_name"]) &&
		typeof value["session_id"] === "string" &&
		typeof value["turn_id"] === "string" &&
		typeof value["transcript_path"] === "string" &&
		typeof value["cwd"] === "string" &&
		typeof value["model"] === "string" &&
		typeof value["permission_mode"] === "string" &&
		typeof value["stop_hook_active"] === "boolean" &&
		optionalString(value["last_assistant_message"])
	);
}

function isStopHookEventName(value: unknown): value is StopHookEventName {
	return value === "Stop" || value === "SubagentStop";
}

function optionalString(value: unknown): boolean {
	return value === undefined || typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
