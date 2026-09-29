// Recency of rule files (`seq`, larger = newer), the resolution tie-break. A file's position is the
// newest commit that touched it under the scope directory. One commit can write several files (an
// import); those are ordered by rule number, which the store hands out in write order.

/** Parses `git log --format=%x1e%H --name-only` (newest first) into each path's commit position, oldest = 1. */
export function parseCommitOrder(stdout: string): Map<string, number> {
  const commits = stdout.split("\x1e").filter((record) => record.trim().length > 0)
  const seqByPath = new Map<string, number>()
  commits.forEach((record, index) => {
    for (const path of record.split("\n").slice(1).map((line) => line.trim()).filter(Boolean)) {
      if (!seqByPath.has(path)) seqByPath.set(path, commits.length - index)
    }
  })
  return seqByPath
}

/** Orders rules oldest first by (commit position, rule number) and renumbers `seq` 1..k in that order. */
export function rankByRecency<T extends { readonly rule: { readonly n: number }; readonly seq: number }>(rules: readonly T[]): T[] {
  return [...rules]
    .sort((left, right) => left.seq - right.seq || left.rule.n - right.rule.n)
    .map((stored, index) => ({ ...stored, seq: index + 1 }))
}
