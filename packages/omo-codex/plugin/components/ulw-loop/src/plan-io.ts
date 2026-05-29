import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";

import { repoRelative, ulwLoopDir, ulwLoopGoalsPath, ulwLoopLedgerPath } from "./paths.js";
import type { UlwLoopLedgerEntry, UlwLoopPlan } from "./types.js";
import { iso, ULW_LOOP_DIR, ULW_LOOP_GOALS, ULW_LOOP_LEDGER, UlwLoopError } from "./types.js";

const AGGREGATE_CODEX_OBJECTIVE = `Complete the durable ulw-loop plan in ${ULW_LOOP_DIR}/${ULW_LOOP_GOALS}, including later accepted/appended stories, under the original brief constraints; use ${ULW_LOOP_DIR}/${ULW_LOOP_LEDGER} as the audit trail.`;
const LEGACY_OBJECTIVE_PREFIX = `Complete all ulw-loop stories in ${ULW_LOOP_DIR}/${ULW_LOOP_GOALS}: `;
const LEGACY_OBJECTIVE = `Complete all ulw-loop stories listed in ${ULW_LOOP_DIR}/${ULW_LOOP_GOALS}. Use ${ULW_LOOP_DIR}/${ULW_LOOP_LEDGER} as the durable audit trail.`;
const locks = new Map<string, Promise<unknown>>();

function hasCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}

function isLegacyEnumeratedAggregateObjective(objective: string | undefined): objective is string {
	return objective === LEGACY_OBJECTIVE || Boolean(objective?.startsWith(LEGACY_OBJECTIVE_PREFIX));
}

function isSteeringKind(value: unknown): value is UlwLoopLedgerEntry["kind"] {
	return value === "steering_accepted" || value === "steering_rejected" || value === "criteria_revised";
}

export async function withUlwLoopMutationLock<T>(repoRoot: string, fn: () => Promise<T>): Promise<T> {
	const prior = locks.get(repoRoot) ?? Promise.resolve();
	const run = prior.then(fn, fn);
	locks.set(
		repoRoot,
		run.catch(() => undefined),
	);
	return run;
}

export async function readUlwLoopPlan(repoRoot: string): Promise<UlwLoopPlan> {
	const path = ulwLoopGoalsPath(repoRoot);
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		if (!hasCode(error, "ENOENT")) throw error;
		throw new UlwLoopError(
			`No ulw-loop plan found at ${repoRelative(path, repoRoot)}. Run \`omo ulw-loop create-goals ...\` first.`,
			"ULW_LOOP_PLAN_MISSING",
			{ cause: error },
		);
	}
	const parsed: UlwLoopPlan = JSON.parse(raw);
	if (parsed.version !== 1 || !Array.isArray(parsed.goals)) {
		throw new UlwLoopError(`Invalid ulw-loop plan at ${repoRelative(path, repoRoot)}.`, "ULW_LOOP_PLAN_INVALID");
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

export async function writePlan(repoRoot: string, plan: UlwLoopPlan): Promise<void> {
	await mkdir(ulwLoopDir(repoRoot), { recursive: true });
	const path = ulwLoopGoalsPath(repoRoot);
	const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(tmpPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
	await rename(tmpPath, path);
}

export async function appendLedger(repoRoot: string, entry: UlwLoopLedgerEntry): Promise<void> {
	await mkdir(ulwLoopDir(repoRoot), { recursive: true });
	await appendFile(ulwLoopLedgerPath(repoRoot), `${JSON.stringify(entry)}\n`, "utf8");
}

export async function readSteeringLedgerEntries(repoRoot: string): Promise<UlwLoopLedgerEntry[]> {
	let raw: string;
	try {
		raw = await readFile(ulwLoopLedgerPath(repoRoot), "utf8");
	} catch (error) {
		if (hasCode(error, "ENOENT")) return [];
		throw error;
	}
	const entries: UlwLoopLedgerEntry[] = [];
	for (const line of raw.split(/\r?\n/).filter(Boolean)) {
		const entry: UlwLoopLedgerEntry = JSON.parse(line);
		if (isSteeringKind(entry.kind)) entries.push(entry);
	}
	return entries;
}
