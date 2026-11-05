import {
  createNodeGitExec,
  GitMemoryRepo,
  type MemoryIdentity,
  type ReflectionWorktree,
  type ReservationRunLedger,
} from "@oh-my-opencode/memory-core"

export { parseReservationRunLedger, type ReservationRunLedger } from "@oh-my-opencode/memory-core"

export function worktreeFromLedger(identity: MemoryIdentity, ledger: ReservationRunLedger): ReflectionWorktree {
  return {
    parent: new GitMemoryRepo({ dir: identity.paths.repo, agentId: identity.id }),
    dir: ledger.worktreeDir,
    branch: ledger.worktreeBranch,
    baseSha: ledger.baseSha,
    gitFilePath: ledger.gitFilePath,
    gitFileSnapshot: ledger.gitFileSnapshot,
    commonConfigPath: ledger.commonConfigPath,
    commonConfigSnapshot: ledger.commonConfigSnapshot,
    exec: createNodeGitExec(),
  }
}
