import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type GoalSnapshotStatus = "active" | "complete" | "cancelled" | "failed" | "unknown";

export interface GoalSnapshot {
	available: boolean;
	objective?: string;
	status?: GoalSnapshotStatus;
	raw: unknown;
}

export interface GoalReconciliation {
	ok: boolean;
	snapshot: GoalSnapshot;
	warnings: string[];
	errors: string[];
}

export interface ReconcileGoalOptions {
	expectedObjective: string;
	acceptedObjectives?: readonly string[];
	allowedStatuses?: readonly GoalSnapshotStatus[];
	requireSnapshot?: boolean;
	requireComplete?: boolean;
}

export class GoalSnapshotError extends Error {}

function safeObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function safeString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function normalizeStatus(value: unknown): GoalSnapshotStatus {
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

export function parseGoalSnapshot(value: unknown): GoalSnapshot {
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

export async function readGoalSnapshotInput(raw: string | undefined, cwd = process.cwd()): Promise<GoalSnapshot | null> {
	if (!raw?.trim()) return null;
	const trimmed = raw.trim();
	try {
		return parseGoalSnapshot(JSON.parse(trimmed));
	} catch {
		const path = resolve(cwd, trimmed);
		if (!existsSync(path)) {
			throw new GoalSnapshotError(`Goal snapshot is neither valid JSON nor a readable path: ${trimmed}`);
		}
		try {
			return parseGoalSnapshot(JSON.parse(await readFile(path, "utf-8")));
		} catch (error) {
			throw new GoalSnapshotError(
				`Goal snapshot path does not contain valid JSON: ${trimmed}${error instanceof Error ? ` (${error.message})` : ""}`,
			);
		}
	}
}

export function reconcileGoalSnapshot(
	snapshot: GoalSnapshot | null | undefined,
	options: ReconcileGoalOptions,
): GoalReconciliation {
	const effectiveSnapshot = snapshot ?? { available: false, raw: null };
	const errors: string[] = [];
	const warnings: string[] = [];

	if (!effectiveSnapshot.available) {
		const message = "Goal snapshot is absent or reports no active goal.";
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
		errors.push("Goal snapshot is missing objective text.");
	} else if (!accepted.has(actual)) {
		errors.push(`Goal objective mismatch: expected "${expected}", got "${actual}".`);
	}

	const allowed = options.allowedStatuses ?? (options.requireComplete ? ["complete"] : ["active", "complete"]);
	const actualStatus = effectiveSnapshot.status ?? "unknown";
	if (!allowed.includes(actualStatus)) {
		errors.push(`Goal status mismatch: expected ${allowed.join(" or ")}, got ${actualStatus}.`);
	}
	if (options.requireComplete && actualStatus !== "complete") {
		errors.push("Goal is not complete; finish the work and pass a complete snapshot.");
	}

	return { ok: errors.length === 0, snapshot: effectiveSnapshot, warnings, errors };
}

export function formatGoalReconciliation(reconciliation: GoalReconciliation): string {
	const parts = [...reconciliation.errors, ...reconciliation.warnings];
	return parts.join(" ");
}
