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
function readRecord(dir: string, name: string): PlanCommitRecord | undefined {
	try {
		const record: PlanCommitRecord = JSON.parse(readFileSync(join(dir, "revisions", name), "utf8"));
		return record.version === 1 &&
			Number.isInteger(record.revision) &&
			record.plan?.version === 1 &&
			Array.isArray(record.plan.goals) &&
			Array.isArray(record.ledger)
			? record
			: undefined;
	} catch (error) {
		if (!(error instanceof SyntaxError)) throw error;
		return undefined;
	}
}
// Only the audit trail needs every record; plan reads use readNewestRecord.
export function readRecords(dir: string): PlanCommitRecord[] {
	const records: PlanCommitRecord[] = [];
	for (const name of logNames(dir)) {
		const record = readRecord(dir, name);
		if (record !== undefined) records.push(record);
	}
	return records.sort((a, b) => a.revision - b.revision);
}
// Every ulw-loop status probe reads the plan, each record embeds a full plan copy, and records are never
// deleted - so a plan read parses the newest record only, newest first, and stops there. Names are ordered
// by their parsed revision because a wider zero-padding would break lexicographic order.
export function readNewestRecord(dir: string): PlanCommitRecord | undefined {
	const names = logNames(dir).sort((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10));
	for (const name of names) {
		const record = readRecord(dir, name);
		if (record !== undefined) return record;
	}
	return undefined;
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
	const latest = readNewestRecord(dir);
	return latest !== undefined && latest.revision >= (cached?.revision ?? 0) ? latest.plan : cached;
}
export function planExists(repoRoot: string, scope?: UlwLoopScope): boolean {
	const dir = ulwLoopDir(repoRoot, scope);
	return existsSync(join(dir, "goals.json")) || logNames(dir).length > 0;
}
