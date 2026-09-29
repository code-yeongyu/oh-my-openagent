# QA Evidence — Issue #7337 background task false-completion

Branch: `fix/7337-background-task-false-completion`.
Started 2026-08-25; final independent confirmation completed 2026-08-26.

## WHAT WAS TESTED

1. **Independent audit of the candidate diff** (`AUDIT.md`): full dirty diff + every
   completion publisher mapped. Single `completed` publisher (`tryCompleteTask`);
   three gated routes (session.idle event, polling idle/gone, polling terminal
   `interrupted`). Two defects found beyond the candidate's own fix:
   - **F1 (P0)**: `validateSessionHasOutput()` returned `true` on messages-fetch
     errors, so an INDETERMINATE observation could false-complete on all three
     routes (#7337 forbids indeterminate completions).
   - **F2 (P1)**: `failCrashedTask()` lacked a running-guard; a concurrent
     completion during teardown awaits could be overwritten to `error`
     (double parent notification).
2. **RED→GREEN regression suite** (`manager.polling.test.ts`, bun:test):
   - Candidate's own tests (interrupted user-only child fails explicitly while a
     busy sibling keeps running; interrupted-with-output still completes) — kept,
     still green.
   - NEW T1/T2/T4: interrupted / idle / session.idle-event routes with a THROWING
     messages client must keep waiting, never complete.
   - NEW T3: concurrent completion landing inside the teardown await window must
     NOT be overwritten by `failCrashedTask`.
   - RED proof for all four against the pre-fix tree: `red-proof-f1-f2.log`
     (17 pass / 4 fail, each failing for the defect it names).
   - GREEN after minimal manager.ts fix: file 21/21.
3. **Focused gate**: `bun test packages/omo-opencode/src/features/background-agent/`
   = **749 pass / 0 fail / 1914 expectations**, multiple consecutive clean runs
   post-final-source-edit. Two load-induced TIMEOUT flakes observed in unrelated
   pre-existing tests (`parent-wake-empty-turn-requeue`, `cancel-task-cleanup`;
   different file each occurrence, 5s per-test cap under host contention); both
   green in 3/3 isolated reruns and in all later full-suite runs. No failure ever
   observed in the files this change touches.
4. **Package typecheck**: `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json` → PASS (exit 0).
5. **Diff hygiene**: `git diff --check` clean; no `as any` / `@ts-ignore` /
   `@ts-expect-error` / empty catches in the added lines.
6. **Live opencode-qa lane** (`qa-driver.sh`, re-run fresh by this session):
   real `opencode serve` v1.18.23, isolated XDG sandbox, worktree plugin loaded
   via `file://`, fake OpenAI LLM from the opencode-qa skill:
   - Lane A: real child prompted then aborted mid-run pre-content. On-disk shape
     matches the issue exactly (user text part + assistant row with ZERO parts).
     Real BackgroundManager from this worktree polled 3× → stayed `running`,
     never `completed`.
   - Lane B: production-identical `manager.launch()` path. Environment blocker
     (below); doubles as a second anti-false-success observation.
   - Lane C (NEW): aborts sampled tightly for terminal `interrupted` status to
     drive the new explicit-failure route live. In 3 attempts the server always
     transitioned busy → absent with no observable `interrupted` window, so the
     live drive of that specific branch is a recorded BLOCKER; the branch stays
     pinned by unit tests (T1/T3 + sibling-isolation test).
7. **Isolation proof** (`isolation-proof.txt`): all 8 QA-created session ids
   queried read-only (bun:sqlite) in BOTH databases — 0 in the real DB,
   8/8 in the sandbox DB only. Sandbox temp dir removed on exit (cleanup receipt:
   task-owned sandbox gone; no stray serve/fake-LLM processes from this run).

## WHAT WAS OBSERVED

- Pre-audit candidate: user-only/interrupted children already failed explicitly;
  but fetch-error sessions could silently COMPLETE (F1) and teardown races could
  overwrite a completed task as error (F2) — both proven RED first.
- Post-fix: verified-no-output terminal children → `error` with structured
  diagnostic `Subagent session <id> ended with status "<type>" without producing
  any assistant or tool output (startup failure; ...)`. Indeterminate fetch
  errors → keep waiting under existing stale/TTL bounds (bounded diagnostic
  failure path, no false success). Concurrent completions are never overwritten.
- Live transcript: `live-lane-output.log`; driver exit code 0; ISOLATION VERIFIED.

## WHY IT IS ENOUGH

- All three completion routes now treat only VERIFIED assistant/tool content as
  completable; indeterminate waits are bounded by `checkAndInterruptStaleTasks`
  (stale/session-gone timeouts → cancelled + diagnostic) and
  `pruneStaleTasksAndNotifications` (TTL → error + diagnostic), so "wait" can
  never become an unbounded hang or a silent loss.
- The core #7337 invariant is proven against a REAL server with the exact
  on-disk failure shape (Lane A), and each new branch is unit-pinned RED→GREEN.
- Healthy-path regression risk bounded: with-output completion pinned by
  existing + candidate tests; guarded routes untouched except the two fixed seams.

## WHAT WAS OMITTED / BLOCKERS

- **Positive live completion could not be driven** in this environment: every
  sandbox child run (bare `promptAsync` on any wire dialect AND the production
  spawner path) aborts within ~50ms with `MessageAbortedError` before any
  assistant part persists (fake LLM verified upstream against opencode v1.17.7;
  installed server v1.18.23). Environment/harness limitation, NOT a manager
  defect; positive completion remains covered by the focused suite.
- **Live drive of the terminal-`interrupted` failure branch blocked**: the
  installed server exposes no observable `interrupted` window post-abort
  (Lane C blocker record). Unit coverage pins the branch.
- Raw provider/DB dumps redacted to relevant rows; no credentials or
  machine-specific home paths in committed artifacts (sandbox used `fake-key`).

## ARTIFACTS

| File | Purpose |
|---|---|
| `AUDIT.md` | Independent audit: publisher map, findings F1-F4, execution order |
| `qa-driver.sh` | Reproducible harness: sandbox + fake LLM + serve + lane + isolation proof |
| `qa-lane.ts` | Live lanes A/B/C (real BackgroundManager vs real server) |
| `live-lane-output.log` | Final green run transcript (this session) |
| `red-proof-pre-fix.log` | Candidate's original failing-first proof (kept for history) |
| `red-proof-f1-f2.log` | THIS session's RED proof for F1/F2 (4 right-reason failures) |
| `isolation-proof.txt` | Real-vs-sandbox DB session-id proof (fresh run) |
| `qa-session-ids.json` | Session ids created by the latest lane run |
| `audit2/verdict.txt` | Separate clean-scope OXA confirmation verdict |
| `audit2/isolation.txt` | Separate confirmation lane isolation receipt |
