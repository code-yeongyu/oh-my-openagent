# src/cli/worktree-sweep/ — Worktree Cleanup Command

## OVERVIEW

Conservative worktree cleanup pipeline. It parses Git porcelain output, classifies candidates, and removes only worktrees proven safe by the selected mode.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Command adapter | `worktree-sweep.ts` |
| Candidate classification | `classify.ts` |
| Porcelain parsing | `parse-worktree-list.ts` |
| Human and machine output | `format.ts` |
| Git operations | `git.ts` |
| Sweep orchestration | `sweep.ts` |
| Contracts | `types.ts` |

## CONVENTIONS

- Classification precedes removal. Keep discovery, safety decisions, and apply-mode side effects separate.
- Git porcelain parsing is treated as a protocol boundary; preserve handling for locked, dirty, unmerged, excluded, and missing candidates.
- Output helpers are reusable and machine-parseable; do not mix terminal decoration into summary data.
- Tests use temporary real Git repositories for apply behavior and assert that protected candidates survive.

## ANTI-PATTERNS

- Never force removal of locked, dirty, unmerged, or excluded worktrees.
- Do not infer safety from a directory name alone; use parsed Git state and configured exclusions.
- Do not invoke Git directly from classification or formatting modules; keep subprocess access in `git.ts`.
