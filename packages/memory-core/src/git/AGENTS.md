# memory-core/src/git — Git Memory Repository

## OVERVIEW

Owns the typed Git boundary for memory repositories: initialization, clean-tree checks, commits, logs, path/index state, worktrees, merges, and serialized mutations. Highest-scoring memory subtree after `facts/` (score 14; 39 external importer files) - every durable memory write ends here. Parent: [`packages/memory-core/AGENTS.md`](../../AGENTS.md).

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Repository lifecycle and commits | `repo.ts` |
| Process abstraction | `exec.ts` |
| Worktree mutation serialization | `worktree-mutation-queue.ts`, `worktree.ts` |
| Git path/index state | `path-state.ts`, `path-state-files.ts` |
| Status and porcelain parsing | `repo-status.ts`, `porcelain.ts` |
| Public barrel | `index.ts` |

## CONVENTIONS

- Git commands flow through injected `GitExec`; production uses the Node implementation and tests use fakes.
- Repository writes acquire the appropriate lock, require a clean baseline, normalize repository-relative paths, and commit only affected paths.
- Git config and worktree mutations are serialized separately (`withSerializedGitConfigMutation`, `withSerializedGitWorktreeMutation`), and index-lock contention retries through `withGitLockRetry`; no broad process-global lock substitutes for those queues.
- Commands run with a 30s timeout and `GIT_TERMINAL_PROMPT` disabled, so a credential prompt can never hang a turn.
- Errors are typed (`DirtyRepoError`, `NoEffectiveChangesError`, and command errors) so callers can distinguish recoverable state.

## ANTI-PATTERNS

- Do not run raw Git process calls from other memory domains.
- Do not commit unrelated dirty files or normalize a path outside the repository.
- Do not treat a failed merge, hook install, or lock operation as a successful memory write.

## QA

```bash
bun test packages/memory-core/src/git/
```

Tests drive real temp repositories, including unicode paths and worktree
serialization; assert on git state, never on elapsed time.
