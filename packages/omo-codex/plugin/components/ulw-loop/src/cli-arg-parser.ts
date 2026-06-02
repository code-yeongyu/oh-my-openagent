// biome-ignore-all format: keep this module under the mandated pure LOC budget.
import { readFile } from "node:fs/promises";

import { UlwLoopError } from "./types.js";

type RecordEvidenceCliArgs = { readonly goalId: string; readonly criterionId: string; readonly status: "pass" | "fail" | "blocked"; readonly evidence: string; readonly notes?: string };

const VALUE_FLAGS = new Set("--brief --brief-file --session-id --codex-goal-mode --goal --goal-id --criterion-id --status --evidence --notes --codex-goal-json --quality-gate-json --kind --rationale --title --objective --target-goal-id --source --after-json --directive-json --directive-file --idempotency-key".split(" "));
const SUBCOMMANDS = new Set("create-goals status complete-goals criteria record-evidence checkpoint steer add-goal record-review-blockers".split(" "));

export function hasFlag(argv: readonly string[], flag: string): boolean { return argv.includes(flag); }

export function readValue(argv: readonly string[], flag: string): string | undefined {
	const index = argv.indexOf(flag);
	if (index >= 0) {
		const next = argv[index + 1];
		return next === undefined || next.startsWith("--") ? undefined : next;
	}
	const prefix = `${flag}=`;
	return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

export function readRepeated(argv: readonly string[], flag: string): string[] {
	const values: string[] = [];
	const prefix = `${flag}=`;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const next = argv[index + 1];
		if (arg === flag && next !== undefined && !next.startsWith("--")) { values.push(next); index += 1; }
		else if (arg?.startsWith(prefix)) values.push(arg.slice(prefix.length));
	}
	return values;
}

export function parseGoalArg(argv: readonly string[]): string | undefined { return readValue(argv, "--goal-id") ?? readValue(argv, "--goal"); }

export async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	return Buffer.concat(chunks).toString("utf8");
}

export function positionalText(argv: readonly string[]): string {
	const words: string[] = [];
	for (let index = SUBCOMMANDS.has(argv[0] ?? "") ? 1 : 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === undefined) continue;
		if (VALUE_FLAGS.has(arg)) { index += 1; continue; }
		if (arg.startsWith("--")) continue;
		words.push(arg);
	}
	return words.join(" ").trim();
}

function looksLikeJson(value: string): boolean { const trimmed = value.trim(); return trimmed.startsWith("{") || trimmed.startsWith("["); }

export async function readJsonInput(value: string | undefined): Promise<unknown | undefined> {
	if (value === undefined) return undefined;
	try { return JSON.parse(looksLikeJson(value) ? value : await readFile(value, "utf8")); }
	catch (error) {
		const message = error instanceof Error ? error.message : "unknown error";
		throw new UlwLoopError(`Invalid JSON input: ${message}`, "ULW_LOOP_JSON_INPUT_INVALID", { cause: error });
	}
}

export async function parseCodexGoalJson(value: string | undefined): Promise<string | undefined> {
	if (value === undefined) return undefined;
	const raw = looksLikeJson(value) ? value : await readFile(value, "utf8");
	try { JSON.parse(raw); return raw; }
	catch (error) {
		const message = error instanceof Error ? error.message : "unknown error";
		throw new UlwLoopError(`Invalid --codex-goal-json: ${message}`, "ULW_LOOP_CODEX_GOAL_JSON_INVALID", { cause: error });
	}
}

function required(argv: readonly string[], flag: string, code: string): string {
	const value = readValue(argv, flag)?.trim();
	if (value) return value;
	throw new UlwLoopError(`Missing ${flag}.`, code, { details: { flag } });
}

function evidenceStatus(value: string): RecordEvidenceCliArgs["status"] {
	switch (value) {
		case "pass": return "pass";
		case "fail": return "fail";
		case "blocked": return "blocked";
		default: throw new UlwLoopError("Invalid --status; expected pass, fail, or blocked.", "ULW_LOOP_EVIDENCE_STATUS_INVALID", { details: { status: value } });
	}
}

export function parseRecordEvidenceArgs(argv: readonly string[]): RecordEvidenceCliArgs {
	const result = { goalId: required(argv, "--goal-id", "ULW_LOOP_GOAL_ID_REQUIRED"), criterionId: required(argv, "--criterion-id", "ULW_LOOP_CRITERION_ID_REQUIRED"), status: evidenceStatus(required(argv, "--status", "ULW_LOOP_EVIDENCE_STATUS_REQUIRED")), evidence: required(argv, "--evidence", "ULW_LOOP_EVIDENCE_REQUIRED") };
	const notes = readValue(argv, "--notes")?.trim();
	return notes ? { ...result, notes } : result;
}
