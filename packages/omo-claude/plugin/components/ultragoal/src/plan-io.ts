import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";

import {
	legacyUltragoalGoalsPath,
	repoRelative,
	ultragoalGoalsPath,
	ultragoalIndexPath,
	ultragoalLedgerPath,
	ultragoalRootDir,
	ultragoalSessionDir,
} from "./paths.js";
import type { UltragoalScope } from "./session-scope.js";
import type {
	UltragoalIndex,
	UltragoalIndexEntry,
	UltragoalLedgerEntry,
	UltragoalLegacyPlanV1,
	UltragoalPlan,
} from "./types.js";
import {
	iso,
	ULTRAGOAL_DIR,
	ULTRAGOAL_GOALS,
	ULTRAGOAL_LEDGER,
	ULTRAGOAL_PLATFORM,
	UltragoalError,
} from "./types.js";

const AGGREGATE_OBJECTIVE = `Complete the durable ultragoal plan in ${ULTRAGOAL_DIR}/${ULTRAGOAL_GOALS}, including later accepted/appended stories, under the original brief constraints; use ${ULTRAGOAL_DIR}/${ULTRAGOAL_LEDGER} as the audit trail.`;
const LEGACY_OBJECTIVE_PREFIX = `Complete all ultragoal stories in ${ULTRAGOAL_DIR}/${ULTRAGOAL_GOALS}: `;
const LEGACY_OBJECTIVE = `Complete all ultragoal stories listed in ${ULTRAGOAL_DIR}/${ULTRAGOAL_GOALS}. Use ${ULTRAGOAL_DIR}/${ULTRAGOAL_LEDGER} as the durable audit trail.`;
const locks = new Map<string, Promise<unknown>>();

function lockKey(scope: UltragoalScope): string {
	return `${scope.repoRoot}::${scope.sessionScope}`;
}

function hasCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}

function isLegacyEnumeratedAggregateObjective(objective: string | undefined): objective is string {
	return objective === LEGACY_OBJECTIVE || Boolean(objective?.startsWith(LEGACY_OBJECTIVE_PREFIX));
}

function isSteeringKind(value: unknown): value is UltragoalLedgerEntry["kind"] {
	return value === "steering_accepted" || value === "steering_rejected" || value === "criteria_revised";
}

export async function withUltragoalMutationLock<T>(scope: UltragoalScope, fn: () => Promise<T>): Promise<T> {
	const key = lockKey(scope);
	const prior = locks.get(key) ?? Promise.resolve();
	const run = prior.then(fn, fn);
	locks.set(
		key,
		run.catch(() => undefined),
	);
	return run;
}

function assertValidV2Plan(plan: UltragoalPlan, scope: UltragoalScope, path: string): void {
	if (plan.version !== 2 || !Array.isArray(plan.goals)) {
		throw new UltragoalError(
			`Invalid ultragoal plan at ${repoRelative(path, scope.repoRoot)}.`,
			"ULTRAGOAL_PLAN_INVALID",
		);
	}
}

/**
 * Read the plan for a session scope. If no session-scoped plan exists but a
 * legacy v1 repo-level plan is present, the v1 plan is migrated forward into
 * this session scope (D3) and written there; the original v1 file is left in
 * place (never deleted).
 */
export async function readUltragoalPlan(scope: UltragoalScope): Promise<UltragoalPlan> {
	const path = ultragoalGoalsPath(scope);
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		if (!hasCode(error, "ENOENT")) throw error;
		const migrated = await tryMigrateLegacyV1(scope);
		if (migrated !== null) return migrated;
		throw new UltragoalError(
			`No ultragoal plan found at ${repoRelative(path, scope.repoRoot)}. Run \`omo ultragoal create-goals ...\` first.`,
			"ULTRAGOAL_PLAN_MISSING",
			{ cause: error },
		);
	}
	const parsed: UltragoalPlan = JSON.parse(raw);
	assertValidV2Plan(parsed, scope, path);
	return await maybeMigrateAggregateObjective(scope, parsed);
}

async function maybeMigrateAggregateObjective(scope: UltragoalScope, plan: UltragoalPlan): Promise<UltragoalPlan> {
	const previousObjective = plan.objective;
	if ((plan.goalMode ?? "per_story") === "aggregate" && isLegacyEnumeratedAggregateObjective(previousObjective)) {
		const now = iso();
		plan.objective = AGGREGATE_OBJECTIVE;
		plan.objectiveAliases = [...new Set([...(plan.objectiveAliases ?? []), previousObjective])];
		plan.updatedAt = now;
		await writePlan(scope, plan);
		await appendLedger(scope, {
			at: now,
			kind: "aggregate_objective_migrated",
			message: "Migrated legacy enumerated aggregate objective to the stable pointer objective.",
			before: { objective: previousObjective },
			after: { objective: plan.objective },
		});
	}
	return plan;
}

/**
 * Read a legacy repo-level v1 plan (if present) and migrate it into the given
 * session scope. Returns the migrated v2 plan, or null when no v1 file exists.
 * The legacy v1 file is read-only and never deleted.
 */
async function tryMigrateLegacyV1(scope: UltragoalScope): Promise<UltragoalPlan | null> {
	const legacyPath = legacyUltragoalGoalsPath(scope.repoRoot);
	let legacyRaw: string;
	try {
		legacyRaw = await readFile(legacyPath, "utf8");
	} catch (error) {
		if (hasCode(error, "ENOENT")) return null;
		throw error;
	}
	const legacy: UltragoalLegacyPlanV1 = JSON.parse(legacyRaw);
	if (legacy.version !== 1 || !Array.isArray(legacy.goals)) return null;
	const now = iso();
	const plan = migrateV1ToV2(legacy, scope);
	await writePlan(scope, plan);
	await appendLedger(scope, {
		at: now,
		kind: "plan_migrated_to_session",
		message: `Migrated legacy v1 plan into session ${scope.sessionId} (original v1 file left intact).`,
		before: { version: 1, goalsPath: legacy.goalsPath },
		after: { version: 2, sessionScope: scope.sessionScope, goalsPath: plan.goalsPath },
	});
	return plan;
}

function migrateV1ToV2(legacy: UltragoalLegacyPlanV1, scope: UltragoalScope): UltragoalPlan {
	const sessionPrefix = `${ULTRAGOAL_DIR}/sessions/${scope.sessionScope}`;
	const plan: UltragoalPlan = {
		version: 2,
		platform: ULTRAGOAL_PLATFORM,
		sessionId: scope.sessionId,
		sessionScope: scope.sessionScope,
		createdAt: legacy.createdAt,
		updatedAt: legacy.updatedAt,
		briefPath: `${sessionPrefix}/brief.md`,
		goalsPath: `${sessionPrefix}/${ULTRAGOAL_GOALS}`,
		ledgerPath: `${sessionPrefix}/${ULTRAGOAL_LEDGER}`,
		goals: legacy.goals,
	};
	if (legacy.codexGoalMode !== undefined) plan.goalMode = legacy.codexGoalMode;
	if (legacy.codexObjective !== undefined) plan.objective = legacy.codexObjective;
	if (legacy.codexObjectiveAliases !== undefined) plan.objectiveAliases = legacy.codexObjectiveAliases;
	if (legacy.activeGoalId !== undefined) plan.activeGoalId = legacy.activeGoalId;
	if (legacy.aggregateCompletion !== undefined) {
		const completion = legacy.aggregateCompletion;
		plan.aggregateCompletion = {
			status: completion.status,
			completedAt: completion.completedAt,
			evidence: completion.evidence,
			...(completion.codexGoal === undefined ? {} : { goalSnapshot: completion.codexGoal }),
		};
	}
	return plan;
}

export async function writePlan(scope: UltragoalScope, plan: UltragoalPlan): Promise<void> {
	await mkdir(ultragoalSessionDir(scope), { recursive: true });
	const path = ultragoalGoalsPath(scope);
	const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(tmpPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
	await rename(tmpPath, path);
	await upsertIndexEntry(scope, plan);
}

export async function appendLedger(scope: UltragoalScope, entry: UltragoalLedgerEntry): Promise<void> {
	await mkdir(ultragoalSessionDir(scope), { recursive: true });
	await appendFile(ultragoalLedgerPath(scope), `${JSON.stringify(entry)}\n`, "utf8");
}

export async function readSteeringLedgerEntries(scope: UltragoalScope): Promise<UltragoalLedgerEntry[]> {
	let raw: string;
	try {
		raw = await readFile(ultragoalLedgerPath(scope), "utf8");
	} catch (error) {
		if (hasCode(error, "ENOENT")) return [];
		throw error;
	}
	const entries: UltragoalLedgerEntry[] = [];
	for (const line of raw.split(/\r?\n/).filter(Boolean)) {
		const entry: UltragoalLedgerEntry = JSON.parse(line);
		if (isSteeringKind(entry.kind)) entries.push(entry);
	}
	return entries;
}

// --- index.json registry ---

export async function readUltragoalIndex(repoRoot: string): Promise<UltragoalIndex> {
	try {
		const raw = await readFile(ultragoalIndexPath(repoRoot), "utf8");
		const parsed: UltragoalIndex = JSON.parse(raw);
		if (parsed.version === 2 && Array.isArray(parsed.sessions)) return parsed;
		return { version: 2, sessions: [] };
	} catch (error) {
		if (hasCode(error, "ENOENT")) return { version: 2, sessions: [] };
		throw error;
	}
}

async function writeUltragoalIndex(repoRoot: string, index: UltragoalIndex): Promise<void> {
	await mkdir(ultragoalRootDir(repoRoot), { recursive: true });
	const path = ultragoalIndexPath(repoRoot);
	const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(tmpPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
	await rename(tmpPath, path);
}

/** Atomically upsert this session's entry in the per-repo registry. */
async function upsertIndexEntry(scope: UltragoalScope, plan: UltragoalPlan): Promise<void> {
	const index = await readUltragoalIndex(scope.repoRoot);
	const entry: UltragoalIndexEntry = {
		sessionId: scope.sessionId,
		sessionScope: scope.sessionScope,
		platform: ULTRAGOAL_PLATFORM,
		createdAt: plan.createdAt,
		updatedAt: plan.updatedAt,
		goalsPath: plan.goalsPath,
	};
	const next = index.sessions.filter((session) => session.sessionScope !== scope.sessionScope);
	next.push(entry);
	await writeUltragoalIndex(scope.repoRoot, { version: 2, sessions: next });
}
