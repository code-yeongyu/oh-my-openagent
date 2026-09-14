import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type UlwLoopScope, ulwLoopDir } from "./paths.js";
import type { UlwLoopLedgerEntry, UlwLoopPlan } from "./types.js";

export interface PlanCommitRecord {
	readonly version: 1;
	readonly revision: number;
	readonly plan: UlwLoopPlan;
	readonly ledger: readonly UlwLoopLedgerEntry[];
}
export function hasCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}
export function readOptional(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		if (hasCode(error, "ENOENT")) return undefined;
		throw error;
	}
}
export function logNames(dir: string): string[] {
	try {
		return readdirSync(join(dir, "revisions"))
			.filter((name) => /^\d{8,}\.json$/.test(name))
			.sort();
	} catch (error) {
		if (hasCode(error, "ENOENT")) return [];
		throw error;
	}
}
export function readRecords(dir: string): PlanCommitRecord[] {
	const records: PlanCommitRecord[] = [];
	for (const name of logNames(dir)) {
		try {
			const record: PlanCommitRecord = JSON.parse(readFileSync(join(dir, "revisions", name), "utf8"));
			if (
				record.version === 1 &&
				Number.isInteger(record.revision) &&
				record.plan?.version === 1 &&
				Array.isArray(record.plan.goals) &&
				Array.isArray(record.ledger)
			)
				records.push(record);
		} catch (error) {
			if (!(error instanceof SyntaxError)) throw error;
		}
	}
	return records.sort((a, b) => a.revision - b.revision);
}
export function reconcilePlan(dir: string): UlwLoopPlan | undefined {
	const raw = readOptional(join(dir, "goals.json"));
	let cached: UlwLoopPlan | undefined;
	if (raw !== undefined) {
		try {
			cached = JSON.parse(raw);
		} catch (error) {
			if (!(error instanceof SyntaxError)) throw error;
		}
	}
	const latest = readRecords(dir).at(-1);
	return latest !== undefined && latest.revision >= (cached?.revision ?? 0) ? latest.plan : cached;
}
export function planExists(repoRoot: string, scope?: UlwLoopScope): boolean {
	const dir = ulwLoopDir(repoRoot, scope);
	return existsSync(join(dir, "goals.json")) || logNames(dir).length > 0;
}
