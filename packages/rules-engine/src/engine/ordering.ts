import { SOURCE_PRIORITY } from "./constants.js";
import type { RuleCandidate } from "./types.js";

export function sortCandidates<T extends RuleCandidate>(candidates: ReadonlyArray<T>): T[] {
	return candidates
		.map((candidate, index) => ({ candidate, index }))
		.sort((left, right) => compareCandidates(left.candidate, right.candidate) || left.index - right.index)
		.map(({ candidate }) => candidate);
}

export function compareCandidates(a: RuleCandidate, b: RuleCandidate): number {
	return (
		compareBoolean(a.isGlobal, b.isGlobal) ||
		compareNumber(a.distance, b.distance) ||
		compareNumber(SOURCE_PRIORITY.get(a.source) ?? Infinity, SOURCE_PRIORITY.get(b.source) ?? Infinity) ||
		compareString(a.relativePath, b.relativePath) ||
		compareString(a.realPath, b.realPath)
	);
}

function compareBoolean(a: boolean, b: boolean): number {
	return Number(a) - Number(b);
}

function compareNumber(a: number, b: number): number {
	return a - b;
}

function compareString(a: string, b: string): number {
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}
