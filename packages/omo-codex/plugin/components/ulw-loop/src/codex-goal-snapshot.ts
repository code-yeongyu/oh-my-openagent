import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type CodexGoalSnapshotStatus =
	| "active"
	| "complete"
	| "paused"
	| "usage_limited"
	| "budget_limited"
	| "cancelled"
	| "failed"
	| "unknown";

export interface CodexGoalSnapshot {
	available: boolean;
	objective?: string;
	status?: CodexGoalSnapshotStatus;
	raw: unknown;
}

export interface CodexGoalReconciliation {
	ok: boolean;
	snapshot: CodexGoalSnapshot;
	/** Facts to know (a differing driver objective); never something to do. */
	warnings: string[];
	/** Things to do next (create, re-create, or resume the driver goal). */
	nextActions: string[];
	errors: string[];
	/** The differing objective this reconciliation reported for the first time, for the caller to acknowledge. */
	unacknowledgedObjective?: string;
}

export interface ReconcileCodexGoalOptions {
	expectedObjective: string;
	readonly acceptedObjectives?: readonly string[];
	readonly acknowledgedObjectives?: readonly string[];
}

export class CodexGoalSnapshotError extends Error {}
function safeObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function safeString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function safeStatusString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function normalizeStatus(value: unknown): CodexGoalSnapshotStatus {
	const status = safeStatusString(value).toLowerCase();
	if (status === "complete" || status === "completed" || status === "done") return "complete";
	if (status === "cancelled" || status === "canceled") return "cancelled";
	if (status === "failed" || status === "failure") return "failed";
	if (status === "paused") return "paused";
	if (status === "usage_limited") return "usage_limited";
	if (status === "budget_limited") return "budget_limited";
	if (status === "active" || status === "in_progress" || status === "pending" || status === "running") return "active";
	return "unknown";
}

function normalizeObjective(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

export function parseCodexGoalSnapshot(value: unknown): CodexGoalSnapshot {
	const root = safeObject(value);
	const goalValue = Object.hasOwn(root, "goal") ? root["goal"] : value;
	if (goalValue === null || goalValue === undefined || goalValue === false) {
		return { available: false, raw: value };
	}

	const goal = safeObject(goalValue);
	const objective = safeString(
		goal["objective"] ?? goal["goal"] ?? goal["description"] ?? goal["title"] ?? root["objective"] ?? root["title"],
	);
	const status = normalizeStatus(goal["status"] ?? root["status"]);

	return {
		available: Boolean(objective || status !== "unknown"),
		...(objective ? { objective } : {}),
		status,
		raw: value,
	};
}

export async function readCodexGoalSnapshotInput(
	raw: string | undefined,
	cwd = process.cwd(),
): Promise<CodexGoalSnapshot | null> {
	if (!raw?.trim()) return null;
	const trimmed = raw.trim();
	try {
		return parseCodexGoalSnapshot(JSON.parse(trimmed));
	} catch {
		const path = resolve(cwd, trimmed);
		if (!existsSync(path)) {
			throw new CodexGoalSnapshotError(`Codex goal snapshot is neither valid JSON nor a readable path: ${trimmed}`);
		}
		try {
			return parseCodexGoalSnapshot(JSON.parse(await readFile(path, "utf-8")));
		} catch (error) {
			throw new CodexGoalSnapshotError(
				`Codex goal snapshot path does not contain valid JSON: ${trimmed}${error instanceof Error ? ` (${error.message})` : ""}`,
			);
		}
	}
}

export function reconcileCodexGoalSnapshot(
	snapshot: CodexGoalSnapshot | null | undefined,
	options: ReconcileCodexGoalOptions,
): CodexGoalReconciliation {
	const effectiveSnapshot = snapshot ?? { available: false, raw: null };
	const errors: string[] = [];
	const warnings: string[] = [];
	const nextActions: string[] = [];

	const expected = options.expectedObjective;
	if (!effectiveSnapshot.available) {
		nextActions.push(`call get_goal; if none, create_goal with codexObjective "${expected}" verbatim`);
		return { ok: errors.length === 0, snapshot: effectiveSnapshot, warnings, nextActions, errors };
	}

	const normalized = (objectives: readonly string[]) => new Set(objectives.map(normalizeObjective).filter(Boolean));
	const accepted = normalized([expected, ...(options.acceptedObjectives ?? [])]);
	const acknowledged = normalized(options.acknowledgedObjectives ?? []);
	const actual = normalizeObjective(effectiveSnapshot.objective ?? "");
	let unacknowledgedObjective: string | undefined;
	if (actual && !accepted.has(actual) && !acknowledged.has(actual)) {
		warnings.push(`driver_objective_differs: expected "${expected}", got "${actual}".`);
		unacknowledgedObjective = actual;
	}

	const actualStatus = effectiveSnapshot.status ?? "unknown";
	if (actualStatus === "paused" || actualStatus === "usage_limited" || actualStatus === "budget_limited") {
		nextActions.push("/goal resume or raise the budget");
	}
	if (actualStatus === "complete")
		nextActions.push(`driver closed early: call create_goal with codexObjective "${expected}" verbatim`);
	return {
		ok: errors.length === 0,
		snapshot: effectiveSnapshot,
		warnings,
		nextActions,
		errors,
		...(unacknowledgedObjective === undefined ? {} : { unacknowledgedObjective }),
	};
}

export function formatCodexGoalReconciliation(reconciliation: CodexGoalReconciliation): string {
	const parts = [...reconciliation.errors, ...reconciliation.nextActions, ...reconciliation.warnings];
	return parts.join(" ");
}
