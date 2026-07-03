import { fuzzyMatch } from "@earendil-works/pi-tui";
import type { HistoryEntry } from "./types.ts";

const RECENCY_WEIGHT = 0.01;
const DAY_MS = 86_400_000;

type ScoredEntry = {
	readonly entry: HistoryEntry;
	readonly score: number;
};

export function filterHistory(entries: readonly HistoryEntry[], query: string): readonly HistoryEntry[] {
	const normalizedQuery = query.trim();
	if (!normalizedQuery) return [...entries];

	let newest = 0;
	for (const entry of entries) newest = Math.max(newest, entry.timestamp);

	const scored: ScoredEntry[] = [];
	for (const entry of entries) {
		const match = fuzzyMatch(normalizedQuery, entry.text);
		if (!match.matches) continue;
		const ageDays = Math.max(0, newest - entry.timestamp) / DAY_MS;
		scored.push({ entry, score: match.score + ageDays * RECENCY_WEIGHT });
	}

	scored.sort((left, right) => left.score - right.score || right.entry.timestamp - left.entry.timestamp);
	return scored.map((scoredEntry) => scoredEntry.entry);
}
