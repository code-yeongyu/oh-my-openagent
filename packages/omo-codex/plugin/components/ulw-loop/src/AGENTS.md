# src — ulw-loop runtime (46 modules, ~5.7k LOC)

**Score 15** (46 files, >70% code, 280 export statements; distinct domain: the state machine behind every CLI subcommand and hook). Style, forbidden constructs, the 250-LOC ceiling, branding, and commands are in the [component AGENTS.md](../AGENTS.md).

## MODULE FAMILIES

| Family | Modules | Role |
|--------|---------|------|
| CLI | `cli.ts`, `cli-commands.ts`, `cli-subcommands.ts`, `cli-arg-parser.ts`, `cli-output.ts`, `cli-steering.ts` | argv dispatch -> subcommand -> stdout/JSON shaping |
| Persistence | `plan-io.ts`, `plan-crud.ts`, `plan-goal-factory.ts`, `plan-missing-recovery.ts`, `paths.ts` | `goals.json` read/write, append-only `ledger.jsonl`, path/scope resolution |
| Locking | `state-lock.ts` | cross-process O_EXCL lock, sync + async variants |
| Checkpoint | `checkpoint.ts`, `checkpoint-reconciliation.ts`, `checkpoint-continuation.ts`, `checkpoint-codex-validation.ts`, `checkpoint-template.ts` | goal completion, next-goal instruction, Codex goal-snapshot reconciliation |
| Quality gate | `quality-gate.ts`, `-artifacts.ts`, `-fields.ts`, `-verdicts.ts`, `-blockers.ts`, `-aggregate.ts` | five-section gate validation, artifact/surface compatibility, defect aggregation |
| Steering | `steering.ts`, `steering-mutations.ts`, `steering-batch.ts`, `steering-snapshot.ts`, `steering-types.ts` | directive parse -> validate -> locked mutation -> ledger audit |
| Hooks | `codex-hook.ts`, `spawn-guard.ts`, `stop-resume-hook.ts` | UserPromptSubmit steering, `create_goal` budget guard, spawn admission, Stop auto-resume |
| Evidence/status | `evidence.ts`, `goal-status.ts`, `status-next-actions.ts`, `validation-batch.ts`, `review-blockers.ts` | criterion evidence capture, aggregate objective/status, next-action guidance |
| Contracts | `types.ts` (barrel), `runtime.ts` (`UlwLoopError`, `iso`), `domain-types.ts`, `command-types.ts`, `constants.ts`, `surface.ts` | `UlwLoop*` types, error codes, reviewer identities per surface |
| Pinned copies | `ultrawork-directive.ts`, `ultrawork-skill-pointer.ts` | byte-identity mirrors of ultrawork artifacts |

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Add a subcommand | `cli-commands.ts` (`ULW_LOOP_SUBCOMMANDS`) then `cli-subcommands.ts`; help text in `cli-output.ts` |
| Change plan mutation safety | `plan-io.ts` `withUlwLoopMutationLock` (in-process chain + file lock) |
| Change lock reclaim rules | `state-lock.ts` `isStale`/`reclaim`/`release` |
| Change gate acceptance | `quality-gate.ts` + `surface.ts` section/acceptor tables |
| Change spawn admission order | `spawn-guard.ts` `evaluateGuards` |
| Change attempt evidence layout | `paths.ts` `ulwLoopAttemptEvidenceDir` (single resolution path by design) |

## INVARIANTS

- Every state mutation runs inside the state-directory lock; a read path that would migrate legacy plan data instead throws `ULW_LOOP_MIGRATION_REQUIRED` rather than writing unlocked.
- `state-lock.ts` never reclaims a lock whose owner pid is alive, no matter its age; only an ownerless (mid-write/foreign) body retires by `staleMs`. Timeouts fail closed with `ULW_LOOP_LOCK_TIMEOUT`.
- Plan writes are temp-file + rename; ledger writes are append-only and streamed line-at-a-time (`ledgerLines`) because real ledgers reach multiple MB.
- `spawn-guard.ts` order is fixed: session breaker marker -> fan-out peek (no charge) -> gate artifact -> reviewer quota -> fan-out consume. Denials must never charge a quota the spawn will not use.
- Reviewer identity comes from `surface.ts` (`OMO_AGENT_TOOLKIT_SURFACE` env, then staged `surface.json`, else `lazycodex`); the `omo-senpi` surface has no `codeReview` lane.
- Hook entrypoints return `""` on malformed input and swallow errors: a Codex turn is never blocked by a parse failure.
- Untrusted `goals.json` values (goal ids) must stay inside the session state dir — `stop-resume-hook.ts` path-checks its counter/stuck files before writing.

## ANTI-PATTERNS

- Do not resolve the attempt evidence dir a second way (env, literal path): the gate would reject its own advertised directory.
- Do not read `ledger.jsonl` with `readFile`; the streaming helpers exist to keep memory O(longest line).
- Do not add a second lock scope: one lock per state directory covers plan, ledger, and hook counters.
- Do not hand-edit `ultrawork-directive.ts`'s source artifact or the skill pointer text; both are byte-pinned by plugin tests.
