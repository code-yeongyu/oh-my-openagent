# PR7857 P1 repair: verified implementation

Base: `668c74109777d114ef08d6bb7665f93311c4b5e6`.
No commits, staging, pushes, GitHub comments or PR edits were made.
Only the new maintenance worktree was edited.

## Scope and implementation

- Terminal child error visibility uses a per-session event-decision counter and
  a read-only runtime-fallback pending-state accessor, not a 10-second grace.
- The counter is acquired before any dispatcher await and released in finally;
  overlapping error events cannot prematurely release another decision.
- Runtime dispatching remains pending; awaiting is pending only with a pending
  model or scheduled timeout. Real exhausted/no-model timeout exits can retain
  the old awaiting set, so that set alone must not suppress the latch forever.
  No fallback dispatch, timeout, retry or generation algorithm was changed.
- Required manager forwarding is created independently of disabled notification
  hooks and invoked once. Optional chat notification injection remains null when
  disabled. The original forwarder event filter and hook order are preserved.
- Both initial sync and continuation tools keep using the same manager getter.

## Verification receipts

All host Bun commands below used Bun 1.4.0 (34cbb9a40), direct binary, SHA256
`539598c775882420b9d8deb7dc14d845f20f7d26f5600c50ab067dde6ac3f3bf`.
Successful builds used Node v24.18.0. The first failed build used Node22;
its output remains in build.txt, not represented as a successful gate.

1. `bun test packages/omo-opencode/src/plugin/background-task-events.test.ts`
   before implementation: **exit 1, 1 pass / 2 fail** (`red.txt`). Disabled
   notifications delivered zero manager events; pending recovery exposed error.
2. Initial expanded regression suite: **exit 0, 5 pass / 0 fail**
   (`green-regression.txt`). Real runtime dispatcher accepted/failed cases included.
3. Focused integration run: **exit 0, 285 pass / 0 fail, 872 assertions**
   (`focused-tests.txt`), covering background-task-events.test.ts, event.test.ts,
   manager.test.ts, background-notification/hook.test.ts,
   delegate-task/sync-session-poller.test.ts and sync-continuation.test.ts.
   Includes disabled injection, declined/exhausted decision, hook exception and
   overlapping-decision tests. Before the subsequent exhaustion accessor correction.
4. Reviewer-discovered orphan-awaiting regression, `bun test
   packages/omo-opencode/src/plugin/background-task-events.test.ts -t 'real timeout'`:
   **exit 1, 0 pass / 2 fail** (`exhaustion-red.txt`). Both accepted-then-exhausted
   and accepted-then-no-models paths execute the real timeout helper.
5. After accessor correction: `bun test
   packages/omo-opencode/src/plugin/background-task-events.test.ts
   packages/omo-opencode/src/hooks/runtime-fallback/auto-retry-timeout.test.ts
   packages/omo-opencode/src/hooks/runtime-fallback/auto-retry-dispatch.test.ts`:
   **exit 0, 28 pass / 0 fail, 96 assertions** (`exhaustion-green.txt`). Tests use
   explicit signals bounded by Bun timeout or a deterministic timer clock.
   The new test file was subsequently reordered to put imports first, without
   changing assertions or behavior; the compiler was rerun afterward.
6. `node_modules/.bin/tsgo --noEmit -p packages/omo-opencode/tsconfig.json`:
   **exit 0**, including after final source and test edits (`compiler-final.txt`
   is empty because the compiler reported no diagnostics). LSP tool could not
   inspect the sibling worktree: it rejected paths outside its request cwd.
7. `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.file.allow
   GIT_CONFIG_VALUE_0=always bun run build`: **exit 0** on final production source
   (`build-final.txt`). Initial default build failed on pre-existing local
   submodule URLs; inspected those URLs before allowing local file transport
   for this command only. No global Git configuration was changed.
8. Lead reported root `bun run typecheck` **exit 0**, handle `bash_78`, on the
   pre-exhaustion-accessor tree. This is parent-provided evidence, not an execution
   in this session. No type contract changed after that run; affected compiler
   passed after the accessor change.

### Broad suite is NOT green

The combined directory run exceeded the command's 240-second deadline;
the local-only `related-tests.txt` retains failures: native-skill resolution timeouts, background
metadata/session ID assertion, category variant timeout, and parent-wake marker
race timeouts. Several ordinary fixture operations took seconds. Attribution to
baseline/environment is NOT proved here. No budgets, assertions or skips were
changed to hide these failures, and that broad run was not repeated.
After the subsequent exhaustion accessor correction, the lead ran all six
related domains together once: 1603 pass, zero failures. Exact command and
summary are in `final-tests.txt`; the earlier failure is not relabeled green.

## Real OpenCode QA: passed after fixture diagnosis

Final receipts: `live-disabled.json` and `live-recovery.json`, both
`passed: true`, using real OpenCode 1.18.30 in isolated native sandboxes.
The probe was present in the effective configuration and registered tool IDs.
Each distinct `session.error` reached the manager exactly once, even with
`background-notification` disabled.

- Disabled recovery: the child stored two user messages and no assistant
  messages. The parent's actual tool result equaled the matching SSE error.
- Enabled recovery: both error observations reported pending recovery and a
  hidden terminal error, including a controlled future-clock getter check.
  The local provider then released `PR7857_RECOVERED`; the actual synchronous
  caller received it and the child stored an assistant response.
- Host database session count was 8104 before and after each case. Both
  isolated sandboxes and server processes were removed.

The lead diagnosed missing public skill assets in the bundled fixture, staged
`dist/skills` beside it, and corrected event matching: OpenCode emits two
distinct errors for this failure, so exactly-once forwarding is asserted per
event, not per session. See `lead-verification.md` for the failed attempts and
final 1603-test, zero-failure related-domain run. Historical failures below
are retained, not counted as passes.

Case B driver: `live-qa.mjs`; source-built boundary fixture: `live-probe.ts`.
The fixture uses the actual manager, continuation-hook composer, event dispatcher,
runtime-fallback hook and synchronous continuation tool. It intentionally does
not load every unrelated OMO hook. It subscribes to SSE connection before trigger;
provider recovery response release uses an observation signal, not a sleep.
The planned future-clock probe is a synchronous getter check, not proof of actual
elapsed wall-clock time.

The child's three environment variants initially failed before reaching the
changed behavior:

- Existing Docker QA image, OpenCode1.18.4: custom probe tool unavailable.
- Disposable-container install of current OpenCode1.18.31: same result.
- Current version with probe bundle copied out of repository package scope into
  its own sandbox: same result.

A diagnostic repeat of the first approach added server logs; it was not counted
as a new repair approach. The provider returned a real tool call, but OpenCode
reported `Model tried to call unavailable tool 'qa_terminal_child'`. No child
session or matching error event was created. Root cause of missing registration
was unresolved at handoff. Recovery QA had not run at that point because the
prerequisite tool was absent. The lead's direct import subsequently exposed
`ENOENT: skills/frontend/SKILL.md`, and the completed asset staging fixed loading.

Initial Docker replay shape (failed before the asset-staging correction):

```sh
bun build .omo/evidence/20260917-pr7857-p1/live-probe.ts \
  --outfile .local-ignore/pr7857-qa/probe.js --target bun --format esm
docker run --rm --name pr7857-p1-sandbox-disabled \
  -v "$PWD:/repo:ro" \
  -v "$PWD/.omo/evidence/20260917-pr7857-p1:/repo/.omo/evidence/20260917-pr7857-p1" \
  -w /repo -e QA_CASE=disabled \
  -e QA_BUNDLE=/repo/.local-ignore/pr7857-qa/probe.js omo-qa bash -c '
    export BUN_INSTALL=/tmp/qa-tools
    bun install --global opencode-ai@1.18.31
    export PATH=/tmp/qa-tools/bin:$PATH
    opencode --version; node --version
    node .omo/evidence/20260917-pr7857-p1/live-qa.mjs'
```

Docker image tool bootstrap used its existing Bun1.3.12 only for installing the
OpenCode binary. Host bundling/tests used pinned Bun1.4.0; the Docker driver used
Node24.18.0. No test result is attributed to Docker's bootstrap Bun.

Isolation: clean child environment; fresh HOME and all XDG roots; no personal
config, credentials or skills mounted; repository read-only except evidence.
Host DB `SELECT count(*) FROM session`: **8104 before, 8104 after**. All matching
QA containers were removed; driver receipts confirm sandbox removal. These are
isolation results, not evidence of intended plugin behavior.

## Final replay and residual limits

From the worktree root, select Bun 1.4.0, Node 24 and the real OpenCode binary
on PATH, then run:

```sh
bun build .omo/evidence/20260917-pr7857-p1/live-probe.ts \
  --outfile .local-ignore/pr7857-qa/probe.js --target bun --format esm
export QA_BUNDLE="$PWD/.local-ignore/pr7857-qa/probe.js"
export QA_HOST_DB="$HOME/.local/share/opencode/opencode.db"
QA_CASE=disabled node .omo/evidence/20260917-pr7857-p1/live-qa.mjs
QA_CASE=recovery node .omo/evidence/20260917-pr7857-p1/live-qa.mjs
```

- The actual composition, manager, runtime recovery and synchronous tool are
  exercised. Full OMO category selection, remote provider credentials, Windows
  runtime QA and the full repository test suite are not exercised locally.
- `.omo` is ignored locally: evidence/plan files exist on disk but are not staged.
- Full build caused unrelated generated drift in omo-codex install-local.mjs and
  omo-senpi extensions (memory-run-supervisor, omo-member, omo-task, omo). Per lead
  instruction it remains unstaged; exclude it from the focused OpenCode patch.
- Raw unredacted captures stay under task-owned `.local-ignore/pr7857-qa/raw`.
  Published text replaces machine-specific home/worktree paths. No private
  settings/skills/auth dumps were used. Build/npm notices remain visible.
- No monitor/task_send tool exists in this child session. Execution used bash;
  no child delegation or duplicate review agent was spawned.
