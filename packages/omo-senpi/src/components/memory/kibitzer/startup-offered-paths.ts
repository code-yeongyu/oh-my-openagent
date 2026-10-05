import type { RecallCandidate } from "@oh-my-opencode/memory-core"

/** A child may call tools before its startup promise resolves; commit lifetime offers only after startup succeeds. */
export class StartupOfferedPaths extends Set<string> {
  constructor(private readonly committed: ReadonlySet<string>, candidates: readonly RecallCandidate[]) {
    super(candidates.map((candidate) => candidate.path))
  }

  override has(path: string): boolean {
    return super.has(path) || this.committed.has(path)
  }
}
