# memory-core/src/reflection — Reflection State Machine

## OVERVIEW

Coordinates reflection triggers, single-run reservations, transcript snapshots, isolated worktrees, completion validation, and merge outcomes. Distinct domain (score 8): the only subsystem that writes memory from a background run. Parent: [`packages/memory-core/AGENTS.md`](../../AGENTS.md).

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Trigger/event transitions | `machine.ts` |
| Reservation persistence | `reservation.ts` |
| Worktree lifecycle | `worktree.ts`, `worktree-integration.ts` |
| Completion checks | `completion-validation.ts` |
| Bundled reflection persona | `assets/assets.ts` |
| Public barrel | `index.ts` |

## CONVENTIONS

- Trigger precedence is manual, then compaction, then step-count; dream origins are explicit and typed.
- Reservations allow one active run and one merged pending reservation, with bounded pending conversations/bytes.
- Reflection changes are made in an isolated worktree and merged only after completion validation and clean-state checks.
- Outcomes distinguish no changes, dirty parent, conflicts, failures, and timeouts; callers must preserve that distinction.

## ANTI-PATTERNS

- Do not resolve persona contradictions automatically or rewrite load-bearing persona files wholesale.
- Do not commit when no durable change exists.
- Do not run reflection against dirty parent state or bypass reservation ownership.

## QA

```bash
bun test packages/memory-core/src/reflection/
```

Worktree and reservation tests create real repositories; assert on the recorded
outcome, and keep every outcome variant distinguishable.
