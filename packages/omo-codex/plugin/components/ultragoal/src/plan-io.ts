import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";

import { repoRelative, ultragoalDir, ultragoalGoalsPath, ultragoalLedgerPath } from "./paths.js";
import type { UltragoalLedgerEntry, UltragoalPlan } from "./types.js";
import { iso, ULTRAGOAL_DIR, ULTRAGOAL_GOALS, ULTRAGOAL_LEDGER, UltragoalError } from "./types.js";

const AGGREGATE_CODEX_OBJECTIVE = `Complete the durable ultragoal plan in ${ULTRAGOAL_DIR}/${ULTRAGOAL_GOALS}, including later accepted/appended stories, under the original brief constraints; use ${ULTRAGOAL_DIR}/${ULTRAGOAL_LEDGER} as the audit trail.`;
const LEGACY_OBJECTIVE_PREFIX = `Complete all ultragoal stories in ${ULTRAGOAL_DIR}/${ULTRAGOAL_GOALS}: `;
const LEGACY_OBJECTIVE = `Complete all ultragoal stories listed in ${ULTRAGOAL_DIR}/${ULTRAGOAL_GOALS}. Use ${ULTRAGOAL_DIR}/${ULTRAGOAL_LEDGER} as the durable audit trail.`;
const locks = new Map<string, Promise<unknown>>();

function hasCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}

function isLegacyEnumeratedAggregateObjective(objective: string | undefined): objective is string {
	return objective === LEGACY_OBJECTIVE || Boolean(objective?.startsWith(LEGACY_OBJECTIVE_PREFIX));
}

function isSteeringKind(value: unknown): value is UltragoalLedgerEntry["kind"] {
	return value === "steering_accepted" || value === "steering_rejected" || value === "criteria_revised";
}

export async function withUltragoalMutationLock<T>(repoRoot: string, fn: () => Promise<T>): Promise<T> {
	const prior = locks.get(repoRoot) ?? Promise.resolve();
	const run = prior.then(fn, fn);
	locks.set(
		repoRoot,
		run.catch(() => undefined),
	);
	return run;
}

export async function readUltragoalPlan(repoRoot: string): Promise<UltragoalPlan> {
	const path = ultragoalGoalsPath(repoRoot);
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		if (!hasCode(error, "ENOENT")) throw error;
		throw new UltragoalError(
			`No ultragoal plan found at ${repoRelative(path, repoRoot)}. Run \`omo ultragoal create-goals ...\` first.`,
			"ULTRAGOAL_PLAN_MISSING",
			{ cause: error },
		);
	}
	const parsed: UltragoalPlan = JSON.parse(raw);
	if (parsed.version !== 1 || !Array.isArray(parsed.goals)) {
		throw new UltragoalError(`Invalid ultragoal plan at ${repoRelative(path, repoRoot)}.`, "ULTRAGOAL_PLAN_INVALID");
	}
	const previousObjective = parsed.codexObjective;
	if (
		(parsed.codexGoalMode ?? "per_story") === "aggregate" &&
		isLegacyEnumeratedAggregateObjective(previousObjective)
	) {
		const now = iso();
		parsed.codexObjective = AGGREGATE_CODEX_OBJECTIVE;
		parsed.codexObjectiveAliases = [...new Set([...(parsed.codexObjectiveAliases ?? []), previousObjective])];
		parsed.updatedAt = now;
		await writePlan(repoRoot, parsed);
		await appendLedger(repoRoot, {
			at: now,
			kind: "aggregate_objective_migrated",
			message: "Migrated legacy enumerated aggregate Codex objective to the stable pointer objective.",
			before: { codexObjective: previousObjective },
			after: { codexObjective: parsed.codexObjective },
		});
	}
	return parsed;
}

export async function writePlan(repoRoot: string, plan: UltragoalPlan): Promise<void> {
	await mkdir(ultragoalDir(repoRoot), { recursive: true });
	const path = ultragoalGoalsPath(repoRoot);
	const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(tmpPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
	await rename(tmpPath, path);
}

export async function appendLedger(repoRoot: string, entry: UltragoalLedgerEntry): Promise<void> {
	await mkdir(ultragoalDir(repoRoot), { recursive: true });
	await appendFile(ultragoalLedgerPath(repoRoot), `${JSON.stringify(entry)}\n`, "utf8");
}

export async function readSteeringLedgerEntries(repoRoot: string): Promise<UltragoalLedgerEntry[]> {
	let raw: string;
	try {
		raw = await readFile(ultragoalLedgerPath(repoRoot), "utf8");
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
