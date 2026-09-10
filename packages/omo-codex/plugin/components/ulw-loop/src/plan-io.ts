import { AsyncLocalStorage } from "node:async_hooks";
import { createReadStream, readdirSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

import { aggregateCodexObjectiveForScope } from "./goal-status.js";
import {
	repoRelative,
	type UlwLoopScope,
	ulwLoopDir,
	ulwLoopGoalsPath,
	ulwLoopLedgerPath,
	ulwLoopRelativeDir,
	ulwLoopStateLockPath,
} from "./paths.js";
import { planMissingRecovery } from "./plan-missing-recovery.js";
import { withStateLock } from "./state-lock.js";
import type { UlwLoopLedgerEntry, UlwLoopPlan } from "./types.js";
import { iso, ULW_LOOP_DIR, ULW_LOOP_GOALS, ULW_LOOP_LEDGER, UlwLoopError } from "./types.js";

const LEGACY_OBJECTIVE_PREFIX = `Complete all ulw-loop stories in ${ULW_LOOP_DIR}/${ULW_LOOP_GOALS}: `;
const LEGACY_OBJECTIVE = `Complete all ulw-loop stories listed in ${ULW_LOOP_DIR}/${ULW_LOOP_GOALS}. Use ${ULW_LOOP_DIR}/${ULW_LOOP_LEDGER} as the durable audit trail.`;
const locks = new Map<string, Promise<undefined>>();
// Tracks which state dirs the CURRENT async continuation holds, so a read nested
// inside a locked mutation can tell itself apart from an unlocked read elsewhere
// in the same process.
const heldLocks = new AsyncLocalStorage<ReadonlySet<string>>();

function hasCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}

function isLegacyEnumeratedAggregateObjective(objective: string | undefined): objective is string {
	return objective === LEGACY_OBJECTIVE || Boolean(objective?.startsWith(LEGACY_OBJECTIVE_PREFIX));
}

function isSteeringKind(value: unknown): value is UlwLoopLedgerEntry["kind"] {
	return (
		value === "steering_accepted" ||
		value === "steering_rejected" ||
		value === "criteria_revised" ||
		value === "batch_updated"
	);
}

export async function withUlwLoopMutationLock<T>(repoRoot: string, fn: () => Promise<T>): Promise<T>;
export async function withUlwLoopMutationLock<T>(
	repoRoot: string,
	scope: UlwLoopScope | undefined,
	fn: () => Promise<T>,
): Promise<T>;
export async function withUlwLoopMutationLock<T>(
	repoRoot: string,
	scopeOrFn: UlwLoopScope | (() => Promise<T>) | undefined,
	maybeFn?: () => Promise<T>,
): Promise<T> {
	const scope = typeof scopeOrFn === "function" ? undefined : scopeOrFn;
	const fn = typeof scopeOrFn === "function" ? scopeOrFn : maybeFn;
	if (fn === undefined) throw new UlwLoopError("Missing ulw-loop mutation body.", "ULW_LOOP_LOCK_BODY_MISSING");
	const lockKey = `${repoRoot}\0${ulwLoopRelativeDir(scope)}`;
	const lockPath = ulwLoopStateLockPath(repoRoot, scope);
	// The promise chain orders callers inside this process; the file lock is what
	// excludes every other process (each CLI invocation) touching the same state dir.
	const locked = (): Promise<T> =>
		withStateLock(lockPath, () => heldLocks.run(new Set([...(heldLocks.getStore() ?? []), lockKey]), fn));
	const prior = locks.get(lockKey) ?? Promise.resolve(undefined);
	const run = prior.then(locked, locked);
	// The stored gate resolves to undefined so the map never retains fn's result
	// (plans/audits), and it removes itself once no newer waiter replaced it —
	// otherwise a long-lived host leaks one entry per (repo, scope) forever.
	const gate: Promise<undefined> = run.then(
		() => undefined,
		() => undefined,
	);
	locks.set(lockKey, gate);
	void gate.then(() => {
		if (locks.get(lockKey) === gate) locks.delete(lockKey);
	});
	return run;
}

export async function readUlwLoopPlan(repoRoot: string, scope?: UlwLoopScope): Promise<UlwLoopPlan> {
	const path = ulwLoopGoalsPath(repoRoot, scope);
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		if (!hasCode(error, "ENOENT")) throw error;
		const recovery = planMissingRecovery(listUlwLoopSessionIds(repoRoot));
		throw new UlwLoopError(
			`No ulw-loop plan found at ${repoRelative(path, repoRoot)}.\n${recovery.message}`,
			"ULW_LOOP_PLAN_MISSING",
			{ cause: error, ...(recovery.details === undefined ? {} : { details: recovery.details }) },
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
		if (!(heldLocks.getStore()?.has(`${repoRoot}\0${ulwLoopRelativeDir(scope)}`) ?? false)) {
			// A read path (status/criteria) must not mutate state: mutating here runs
			// unlocked and a second reader could write a partially-migrated plan.
			throw new UlwLoopError(
				`The ulw-loop plan at ${repoRelative(path, repoRoot)} carries a legacy enumerated aggregate objective that must be migrated before reads continue. Run any state-mutating ulw-loop command once (e.g. \`record-evidence\`, \`steer\`, \`checkpoint\`) to migrate it under the state lock, then retry.`,
				"ULW_LOOP_MIGRATION_REQUIRED",
			);
		}
		const now = iso();
		parsed.codexObjective = aggregateCodexObjectiveForScope(scope);
		parsed.codexObjectiveAliases = [...new Set([...(parsed.codexObjectiveAliases ?? []), previousObjective])];
		parsed.updatedAt = now;
		await writePlan(repoRoot, parsed, scope);
		await appendLedger(
			repoRoot,
			{
				at: now,
				kind: "aggregate_objective_migrated",
				message: "Migrated legacy enumerated aggregate Codex objective to the stable pointer objective.",
				before: { codexObjective: previousObjective },
				after: { codexObjective: parsed.codexObjective },
			},
			scope,
		);
	}
	return parsed;
}

// Session dirs are the only recovery hint that matters when a plan or a scope is
// missing: the caller is almost always meant to target one of these siblings.
export function listUlwLoopSessionIds(repoRoot: string): readonly string[] {
	try {
		return readdirSync(ulwLoopDir(repoRoot), { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();
	} catch {
		return [];
	}
}

export async function writePlan(repoRoot: string, plan: UlwLoopPlan, scope?: UlwLoopScope): Promise<void> {
	await mkdir(ulwLoopDir(repoRoot, scope), { recursive: true });
	const path = ulwLoopGoalsPath(repoRoot, scope);
	const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(tmpPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
	await rename(tmpPath, path);
}

export async function appendLedger(repoRoot: string, entry: UlwLoopLedgerEntry, scope?: UlwLoopScope): Promise<void> {
	await appendLedgerEntries(repoRoot, [entry], scope);
}

export async function appendLedgerEntries(
	repoRoot: string,
	entries: readonly UlwLoopLedgerEntry[],
	scope?: UlwLoopScope,
): Promise<void> {
	if (entries.length === 0) return;
	await mkdir(ulwLoopDir(repoRoot, scope), { recursive: true });
	await appendFile(
		ulwLoopLedgerPath(repoRoot, scope),
		`${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
		"utf8",
	);
}

/**
 * Streams raw ledger lines without materializing the file. Real ledgers reach
 * many MB (legacy entries embedded full-plan snapshots), so `readFile` here
 * ballooned every steer/dedup path; line-at-a-time keeps memory O(longest line).
 */
async function* ledgerLines(repoRoot: string, scope?: UlwLoopScope): AsyncGenerator<string> {
	const stream = createReadStream(ulwLoopLedgerPath(repoRoot, scope), { encoding: "utf8" });
	const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
	try {
		for await (const line of lines) {
			if (line.trim().length > 0) yield line;
		}
	} catch (error) {
		if (!hasCode(error, "ENOENT")) throw error;
	} finally {
		lines.close();
		stream.destroy();
	}
}

export async function readSteeringLedgerEntries(repoRoot: string, scope?: UlwLoopScope): Promise<UlwLoopLedgerEntry[]> {
	const entries: UlwLoopLedgerEntry[] = [];
	for await (const line of ledgerLines(repoRoot, scope)) {
		const entry: UlwLoopLedgerEntry = JSON.parse(line);
		if (isSteeringKind(entry.kind)) entries.push(entry);
	}
	return entries;
}

/**
 * First accepted steering entry matching an idempotency key/prompt signature.
 * A cheap substring probe on the raw line skips JSON.parse for the vast
 * majority of entries, so dedup stays flat even on legacy multi-MB ledgers.
 */
export async function findAcceptedSteeringLedgerEntry(
	repoRoot: string,
	key: string,
	scope?: UlwLoopScope,
): Promise<UlwLoopLedgerEntry | undefined> {
	const probe = JSON.stringify(key);
	for await (const line of ledgerLines(repoRoot, scope)) {
		if (!line.includes(probe)) continue;
		const entry: UlwLoopLedgerEntry = JSON.parse(line);
		if (!isSteeringKind(entry.kind)) continue;
		if (entry.steering?.invariant.accepted !== true) continue;
		if (
			entry.idempotencyKey === key ||
			entry.steering.idempotencyKey === key ||
			entry.steering.promptSignature === key
		)
			return entry;
	}
	return undefined;
}
