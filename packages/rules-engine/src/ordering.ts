import { SOURCE_PRIORITY } from "./constants";
import type { RuleFileCandidate } from "./types";

export function sortCandidates<T extends RuleFileCandidate>(candidates: readonly T[]): T[] {
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => compareCandidates(left.candidate, right.candidate) || left.index - right.index)
    .map(({ candidate }) => candidate);
}

function compareCandidates(left: RuleFileCandidate, right: RuleFileCandidate): number {
  return (
    Number(left.isGlobal) - Number(right.isGlobal) ||
    left.distance - right.distance ||
    (SOURCE_PRIORITY.get(left.source) ?? Number.POSITIVE_INFINITY) -
      (SOURCE_PRIORITY.get(right.source) ?? Number.POSITIVE_INFINITY) ||
    compareString(left.relativePath, right.relativePath) ||
    compareString(left.realPath, right.realPath)
  );
}

function compareString(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
