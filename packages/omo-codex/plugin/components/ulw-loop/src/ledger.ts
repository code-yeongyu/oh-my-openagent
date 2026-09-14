import { join } from "node:path";
import { type UlwLoopScope, ulwLoopDir } from "./paths.js";
import { readOptional, readRecords, reconcilePlan } from "./plan-log.js";
import type { UlwLoopLedgerEntry } from "./types.js";

export function readLedgerAt(dir: string): UlwLoopLedgerEntry[] {
	const entries = new Map<string, UlwLoopLedgerEntry>();
	const lines = (readOptional(join(dir, "ledger.jsonl")) ?? "").split(/\r?\n/);
	for (const [index, line] of lines.entries()) {
		if (line.trim().length === 0) continue;
		try {
			const entry: UlwLoopLedgerEntry = JSON.parse(line);
			entry.revision ??= 0;
			entry.id ??= `legacy-${index + 1}`;
			entries.set(entry.id, entry);
		} catch (error) {
			if (!(error instanceof SyntaxError)) throw error;
		}
	}
	for (const record of readRecords(dir))
		for (const [seq, entry] of record.ledger.entries()) {
			const id = entry.id ?? `${record.revision}-${seq}`;
			entries.set(id, { ...entry, revision: record.revision, id });
		}
	const reset = reconcilePlan(dir)?.ledgerResetRevision ?? 0;
	const sequence = (entry: UlwLoopLedgerEntry) => Number(entry.id?.split("-").at(-1) ?? 0);
	return [...entries.values()]
		.filter((entry) => (entry.revision ?? 0) >= reset)
		.sort((a, b) => (a.revision ?? 0) - (b.revision ?? 0) || sequence(a) - sequence(b));
}
export function readLedger(repoRoot: string, scope?: UlwLoopScope): UlwLoopLedgerEntry[] {
	return readLedgerAt(ulwLoopDir(repoRoot, scope));
}
