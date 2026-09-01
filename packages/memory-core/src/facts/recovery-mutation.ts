import type { GitIndexIdentity, GitMemoryRepo, GitPathState, GitWorktreeIdentity } from "../git"
import type { FactsApplyRecovery } from "./mutation-plan"
import type { FactsOwnedState } from "./recovery-ownership"
import { sameIdentity } from "./recovery-ownership"

export class FactsOwnershipLostError extends Error {
  override readonly name = "FactsOwnershipLostError"
  constructor(message: string, readonly recoveryPath?: string) {
    super(message)
  }
}

type MutationRecord =
  | { readonly path: string; readonly surface: "index"; readonly before: GitIndexIdentity | null; readonly after: GitIndexIdentity | null }
  | { readonly path: string; readonly surface: "worktree"; readonly before: GitWorktreeIdentity; readonly after: GitWorktreeIdentity }

export class FactsMutationTransaction {
  private readonly mutations: MutationRecord[] = []

  constructor(
    private readonly repo: GitMemoryRepo,
    private readonly recovery: FactsApplyRecovery,
    private readonly initial: FactsOwnedState,
  ) {}

  async restorePreState(): Promise<void> {
    for (const entry of this.recovery.paths) {
      await this.compareAndSetIndex(entry.path, this.initialState(entry.path).index, entry.pre.index)
    }
    for (const entry of this.recovery.paths) {
      await this.compareAndSetWorktree(entry.path, this.initialState(entry.path).worktree, entry.pre.worktree)
    }
  }

  async applyPostState(): Promise<void> {
    for (const entry of this.recovery.paths) await this.compareAndSetIndex(entry.path, entry.pre.index, entry.post.index)
    for (const entry of this.recovery.paths) {
      await this.compareAndSetWorktree(entry.path, entry.pre.worktree, entry.post.worktree)
    }
  }

  async rollback(): Promise<void> {
    for (const mutation of [...this.mutations].reverse()) {
      if (mutation.surface === "index") {
        await this.repo.pathState.writeIndexIfIdentity(mutation.path, mutation.after, mutation.before)
      } else {
        await this.repo.pathState.writeWorktreeIfIdentity(mutation.path, mutation.after, mutation.before)
      }
    }
  }

  private initialState(path: string): GitPathState {
    const state = this.initial.get(path)
    if (state === undefined) throw new FactsOwnershipLostError(`Missing initial facts state: ${path}`)
    return state
  }

  private async compareAndSetIndex(
    path: string,
    expected: GitIndexIdentity | null,
    next: GitIndexIdentity | null,
  ): Promise<void> {
    if (sameIdentity(expected, next)) return
    if (!await this.repo.pathState.writeIndexIfIdentity(path, expected, next)) {
      throw new FactsOwnershipLostError(`Facts ownership changed: ${path}:index`)
    }
    this.mutations.push({ path, surface: "index", before: expected, after: next })
  }

  private async compareAndSetWorktree(
    path: string,
    expected: GitWorktreeIdentity,
    next: GitWorktreeIdentity,
  ): Promise<void> {
    if (sameIdentity(expected, next)) return
    const written = await this.repo.pathState.writeWorktreeIfIdentity(path, expected, next)
    if (!written) throw new FactsOwnershipLostError(
      `Facts ownership changed: ${path}:worktree`,
      this.repo.pathState.consumeOwnershipLossRecoveryPath(),
    )
    this.mutations.push({ path, surface: "worktree", before: expected, after: next })
  }
}
