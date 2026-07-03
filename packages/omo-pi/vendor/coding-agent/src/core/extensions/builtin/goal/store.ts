import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	GoalAlreadyExistsError,
	GoalNotFoundError,
	InvalidGoalStoreError,
	UnsupportedGoalStoreVersionError,
} from "./errors.ts";
import type { Goal, GoalAccountingMode, GoalFile, GoalStoreRef, GoalUpdate, TokenUsageSnapshot } from "./types.ts";
import { isRecord } from "./types.ts";
import { validateObjective } from "./validation.ts";

const STORE_VERSION = 1;

export function goalFilePath(ref: GoalStoreRef): string {
	return join(ref.baseDir, `${encodeURIComponent(ref.threadId)}.json`);
}

export async function readGoal(ref: GoalStoreRef): Promise<Goal | null> {
	const filePath = goalFilePath(ref);
	try {
		const raw = await readFile(filePath, "utf8");
		return parseGoalFile(raw).goal;
	} catch (error) {
		if (isMissingFile(error)) return null;
		throw error;
	}
}

export async function writeGoal(ref: GoalStoreRef, goal: Goal | null): Promise<void> {
	const filePath = goalFilePath(ref);
	await mkdir(dirname(filePath), { recursive: true });
	const file: GoalFile = { version: STORE_VERSION, goal };
	await writeFile(filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

export async function createGoal(ref: GoalStoreRef, objective: string): Promise<Goal> {
	if ((await readGoal(ref)) !== null) {
		throw new GoalAlreadyExistsError("cannot create a new goal because this thread already has a goal");
	}

	const normalizedObjective = validateObjective(objective);
	const now = nowSeconds();
	const goal: Goal = {
		id: randomUUID(),
		threadId: ref.threadId,
		objective: normalizedObjective,
		status: "active",
		tokensUsed: 0,
		timeUsedSeconds: 0,
		createdAt: now,
		updatedAt: now,
		lastStartedAt: now,
	};
	await writeGoal(ref, goal);
	return goal;
}

export async function updateGoal(ref: GoalStoreRef, update: GoalUpdate): Promise<Goal> {
	const current = await readGoal(ref);
	if (!current) throw new GoalNotFoundError("cannot update goal: no goal exists");

	const objective = update.objective === undefined ? current.objective : validateObjective(update.objective);
	const now = nowSeconds();
	const hasObjectiveUpdate = update.objective !== undefined;
	const replacesGoal = hasObjectiveUpdate && (objective !== current.objective || current.status === "complete");
	const requestedStatus = update.status ?? (hasObjectiveUpdate ? "active" : undefined);

	if (replacesGoal) {
		const status = requestedStatus ?? "active";
		const next: Goal = {
			id: randomUUID(),
			threadId: ref.threadId,
			objective,
			status,
			tokensUsed: 0,
			timeUsedSeconds: 0,
			createdAt: now,
			updatedAt: now,
		};
		if (status === "active") next.lastStartedAt = now;
		if (status === "complete") next.completedAt = now;
		await writeGoal(ref, next);
		return next;
	}

	const status = requestedStatus ?? current.status;
	const next: Goal = {
		...current,
		objective,
		status,
		updatedAt: now,
	};

	if (status === "active" && current.status !== "active") {
		next.lastStartedAt = now;
	} else if (status !== "active") {
		delete next.lastStartedAt;
	}

	if (status === "complete") {
		next.completedAt = current.completedAt ?? now;
	} else {
		delete next.completedAt;
	}

	await writeGoal(ref, next);
	return next;
}

export async function clearGoal(ref: GoalStoreRef): Promise<boolean> {
	const hadGoal = (await readGoal(ref)) !== null;
	await writeGoal(ref, null);
	return hadGoal;
}

export async function accountGoalUsage(
	ref: GoalStoreRef,
	usage: TokenUsageSnapshot,
	elapsedSeconds: number,
	mode: GoalAccountingMode = "active",
	expectedGoalId?: string,
): Promise<Goal | null> {
	const goal = await readGoal(ref);
	if (!goal) return goal;
	if (expectedGoalId !== undefined && goal.id !== expectedGoalId) return goal;
	if (!canAccountGoalUsage(goal, mode)) return goal;

	const now = nowSeconds();
	const next: Goal = {
		...goal,
		tokensUsed: goal.tokensUsed + goalTokenDeltaForUsage(usage),
		timeUsedSeconds: goal.timeUsedSeconds + Math.max(0, Math.trunc(elapsedSeconds)),
		updatedAt: now,
	};
	await writeGoal(ref, next);
	return next;
}

function canAccountGoalUsage(goal: Goal, mode: GoalAccountingMode): boolean {
	switch (mode) {
		case "active":
			return goal.status === "active";
		case "activeOrComplete":
			return goal.status === "active" || goal.status === "complete";
	}
}

function goalTokenDeltaForUsage(usage: TokenUsageSnapshot): number {
	return Math.max(0, usage.input) + Math.max(0, usage.output);
}

function parseGoalFile(raw: string): GoalFile {
	const parsed: unknown = JSON.parse(raw);
	if (!isRecord(parsed)) throw new InvalidGoalStoreError("goal store must be a JSON object");
	if (parsed.version !== STORE_VERSION) throw new UnsupportedGoalStoreVersionError("unsupported goal store version");
	const goal = parsed.goal;
	if (goal !== null && !isGoal(goal)) throw new InvalidGoalStoreError("goal store contains an invalid goal");
	return {
		version: STORE_VERSION,
		goal,
	};
}

function isMissingFile(error: unknown): boolean {
	return error instanceof Error && "code" in error && (error as { code: unknown }).code === "ENOENT";
}

function isGoal(value: unknown): value is Goal {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === "string" &&
		typeof value.threadId === "string" &&
		typeof value.objective === "string" &&
		isGoalStatus(value.status) &&
		isNonNegativeSafeInteger(value.tokensUsed) &&
		isNonNegativeSafeInteger(value.timeUsedSeconds) &&
		isNonNegativeSafeInteger(value.createdAt) &&
		isNonNegativeSafeInteger(value.updatedAt) &&
		(value.lastStartedAt === undefined || isNonNegativeSafeInteger(value.lastStartedAt)) &&
		(value.completedAt === undefined || isNonNegativeSafeInteger(value.completedAt))
	);
}

function isGoalStatus(value: unknown): value is Goal["status"] {
	return value === "active" || value === "paused" || value === "complete";
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function nowSeconds(): number {
	return Math.trunc(Date.now() / 1000);
}
