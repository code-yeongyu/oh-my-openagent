import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	GoalAlreadyExistsError,
	GoalNotFoundError,
	InvalidGoalStoreError,
	UnsupportedGoalStoreVersionError,
} from "./errors.js";
import type { Goal, GoalAccountingMode, GoalFile, GoalStoreRef, GoalUpdate, TokenUsageSnapshot } from "./types.js";
import { isRecord } from "./types.js";
import { validateObjective, validateTokenBudget } from "./validation.js";

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

export async function createGoal(ref: GoalStoreRef, objective: string, tokenBudget?: number): Promise<Goal> {
	if ((await readGoal(ref)) !== null) {
		throw new GoalAlreadyExistsError("cannot create a new goal because this thread already has a goal");
	}

	const normalizedObjective = validateObjective(objective);
	validateTokenBudget(tokenBudget);
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
	if (tokenBudget !== undefined) {
		goal.tokenBudget = tokenBudget;
	}
	await writeGoal(ref, goal);
	return goal;
}

export async function updateGoal(ref: GoalStoreRef, update: GoalUpdate): Promise<Goal> {
	const current = await readGoal(ref);
	if (!current) throw new GoalNotFoundError("cannot update goal: no goal exists");

	const tokenBudget = validateTokenBudget(update.tokenBudget);
	const objective = update.objective === undefined ? current.objective : validateObjective(update.objective);
	const now = nowSeconds();
	const hasObjectiveUpdate = update.objective !== undefined;
	const replacesGoal = hasObjectiveUpdate && (objective !== current.objective || current.status === "complete");
	const requestedStatus = update.status ?? (hasObjectiveUpdate ? "active" : undefined);

	if (replacesGoal) {
		const replacementBudget = tokenBudget === null ? undefined : tokenBudget;
		const status = statusAfterBudgetLimit(requestedStatus ?? "active", 0, replacementBudget);
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
		if (replacementBudget !== undefined) next.tokenBudget = replacementBudget;
		if (status === "active") next.lastStartedAt = now;
		if (status === "complete") next.completedAt = now;
		await writeGoal(ref, next);
		return next;
	}

	const nextTokenBudget = tokenBudget === null ? undefined : (tokenBudget ?? current.tokenBudget);
	const status =
		requestedStatus === undefined
			? statusAfterBudgetUpdate(current.status, current.tokensUsed, nextTokenBudget)
			: statusAfterExplicitStatusUpdate(current.status, requestedStatus, current.tokensUsed, nextTokenBudget);
	const next: Goal = {
		...current,
		objective,
		status,
		updatedAt: now,
	};

	if (tokenBudget === null) {
		delete next.tokenBudget;
	} else if (tokenBudget !== undefined) {
		next.tokenBudget = tokenBudget;
	}

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

	const tokensUsed = goal.tokensUsed + goalTokenDeltaForUsage(usage);
	const now = nowSeconds();
	const next: Goal = {
		...goal,
		tokensUsed,
		timeUsedSeconds: goal.timeUsedSeconds + Math.max(0, Math.trunc(elapsedSeconds)),
		updatedAt: now,
		status: statusAfterAccounting(goal.status, tokensUsed, goal.tokenBudget, mode),
	};
	if (next.status === "budgetLimited") delete next.lastStartedAt;
	await writeGoal(ref, next);
	return next;
}

function canAccountGoalUsage(goal: Goal, mode: GoalAccountingMode): boolean {
	switch (mode) {
		case "activeStatusOnly":
			return goal.status === "active";
		case "active":
			return goal.status === "active" || goal.status === "budgetLimited";
		case "activeOrComplete":
			return goal.status === "active" || goal.status === "budgetLimited" || goal.status === "complete";
		case "activeOrStopped":
			return goal.status === "active" || goal.status === "paused" || goal.status === "budgetLimited";
	}
}

function goalTokenDeltaForUsage(usage: TokenUsageSnapshot): number {
	return Math.max(0, usage.input) + Math.max(0, usage.output);
}

function statusAfterAccounting(
	status: Goal["status"],
	tokensUsed: number,
	tokenBudget: number | undefined,
	mode: GoalAccountingMode,
): Goal["status"] {
	if (tokenBudget === undefined || tokensUsed < tokenBudget) return status;
	switch (mode) {
		case "activeStatusOnly":
		case "active":
		case "activeOrComplete":
			return status === "active" ? "budgetLimited" : status;
		case "activeOrStopped":
			return status === "active" || status === "paused" || status === "budgetLimited" ? "budgetLimited" : status;
	}
}

function statusAfterExplicitStatusUpdate(
	currentStatus: Goal["status"],
	requestedStatus: Goal["status"],
	tokensUsed: number,
	tokenBudget: number | undefined,
): Goal["status"] {
	if (currentStatus === "budgetLimited" && requestedStatus === "paused") return "budgetLimited";
	return statusAfterBudgetLimit(requestedStatus, tokensUsed, tokenBudget);
}

function statusAfterBudgetUpdate(
	currentStatus: Goal["status"],
	tokensUsed: number,
	tokenBudget: number | undefined,
): Goal["status"] {
	if (currentStatus === "active") return statusAfterBudgetLimit(currentStatus, tokensUsed, tokenBudget);
	return currentStatus;
}

function statusAfterBudgetLimit(
	status: Goal["status"],
	tokensUsed: number,
	tokenBudget: number | undefined,
): Goal["status"] {
	return status === "active" && tokenBudget !== undefined && tokensUsed >= tokenBudget ? "budgetLimited" : status;
}

function parseGoalFile(raw: string): GoalFile {
	const parsed: unknown = JSON.parse(raw);
	if (!isRecord(parsed)) throw new InvalidGoalStoreError("goal store must be a JSON object");
	if (parsed["version"] !== STORE_VERSION)
		throw new UnsupportedGoalStoreVersionError("unsupported goal store version");
	const goal = parsed["goal"];
	if (goal !== null && !isGoal(goal)) throw new InvalidGoalStoreError("goal store contains an invalid goal");
	return {
		version: STORE_VERSION,
		goal,
	};
}

function isMissingFile(error: unknown): boolean {
	return isErrorWithCode(error) && error.code === "ENOENT";
}

function isErrorWithCode(error: unknown): error is Error & { code: string } {
	return error instanceof Error && "code" in error && typeof error.code === "string";
}

function isGoal(value: unknown): value is Goal {
	if (!isRecord(value)) return false;
	return (
		typeof value["id"] === "string" &&
		typeof value["threadId"] === "string" &&
		typeof value["objective"] === "string" &&
		isGoalStatus(value["status"]) &&
		(value["tokenBudget"] === undefined || isPositiveSafeInteger(value["tokenBudget"])) &&
		isNonNegativeSafeInteger(value["tokensUsed"]) &&
		isNonNegativeSafeInteger(value["timeUsedSeconds"]) &&
		isNonNegativeSafeInteger(value["createdAt"]) &&
		isNonNegativeSafeInteger(value["updatedAt"]) &&
		(value["lastStartedAt"] === undefined || isNonNegativeSafeInteger(value["lastStartedAt"])) &&
		(value["completedAt"] === undefined || isNonNegativeSafeInteger(value["completedAt"]))
	);
}

function isGoalStatus(value: unknown): value is Goal["status"] {
	return value === "active" || value === "paused" || value === "budgetLimited" || value === "complete";
}

function isPositiveSafeInteger(value: unknown): value is number {
	return isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return isSafeInteger(value) && value >= 0;
}

function isSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value);
}

function nowSeconds(): number {
	return Math.trunc(Date.now() / 1000);
}
