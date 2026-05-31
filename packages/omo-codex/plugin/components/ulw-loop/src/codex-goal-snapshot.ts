import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type CodexGoalSnapshotStatus = "active" | "complete" | "cancelled" | "failed" | "unknown";

export interface CodexGoalSnapshot {
	available: boolean;
	objective?: string;
	status?: CodexGoalSnapshotStatus;
	raw: unknown;
}

export interface CodexGoalReconciliation {
	ok: boolean;
	snapshot: CodexGoalSnapshot;
	warnings: string[];
	errors: string[];
}

export interface ReconcileCodexGoalOptions {
	expectedObjective: string;
	acceptedObjectives?: readonly string[];
	allowedStatuses?: readonly CodexGoalSnapshotStatus[];
	requireSnapshot?: boolean;
	requireComplete?: boolean;
}

export class CodexGoalSnapshotError extends Error {}
function safeObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function safeString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function normalizeStatus(value: unknown): CodexGoalSnapshotStatus {
	const status = safeString(value).toLowerCase();
	if (status === "complete" || status === "completed" || status === "done") return "complete";
	if (status === "cancelled" || status === "canceled") return "cancelled";
	if (status === "failed" || status === "failure") return "failed";
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
	const objective = safeString(goal["objective"] ?? goal["goal"] ?? goal["description"] ?? root["objective"]);
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

	if (!effectiveSnapshot.available) {
		const message =
			"Codex goal snapshot is absent or reports no active goal; call get_goal and pass its JSON with --codex-goal-json.";
		if (options.requireSnapshot) errors.push(message);
		else warnings.push(message);
		return { ok: errors.length === 0, snapshot: effectiveSnapshot, warnings, errors };
	}

	const expected = normalizeObjective(options.expectedObjective);
	const accepted = new Set(
		[expected, ...(options.acceptedObjectives ?? []).map((objective) => normalizeObjective(objective))].filter(
			Boolean,
		),
	);
	const actual = normalizeObjective(effectiveSnapshot.objective ?? "");
	if (!actual) {
		errors.push("Codex goal snapshot is missing objective text.");
	} else if (!accepted.has(actual)) {
		errors.push(`Codex goal objective mismatch: expected "${expected}", got "${actual}".`);
	}

	const allowed = options.allowedStatuses ?? (options.requireComplete ? ["complete"] : ["active", "complete"]);
	const actualStatus = effectiveSnapshot.status ?? "unknown";
	if (!allowed.includes(actualStatus)) {
		errors.push(`Codex goal status mismatch: expected ${allowed.join(" or ")}, got ${actualStatus}.`);
	}
	if (options.requireComplete && actualStatus !== "complete") {
		errors.push(
			'Codex goal is not complete; call update_goal({status: "complete"}) only after the objective is actually complete, then pass the fresh get_goal JSON.',
		);
	}

	return { ok: errors.length === 0, snapshot: effectiveSnapshot, warnings, errors };
}

export function formatCodexGoalReconciliation(reconciliation: CodexGoalReconciliation): string {
	const parts = [...reconciliation.errors, ...reconciliation.warnings];
	return parts.join(" ");
}
