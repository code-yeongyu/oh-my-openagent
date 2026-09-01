# Fix coding-agent session discovery for `~/.omo`

## Goal and tier

Deliver a merged PR that makes the shared `coding-agent-sessions` skill discover Senpi-format sessions from the current `~/.omo/agent/sessions` store while preserving legacy `~/.senpi` and `~/.pi` behavior.

Tier: **HEAVY** because this changes coding-agent session-store discovery and multi-root deduplication behavior.

## Scope

Required behavior and tests:

- `packages/shared-skills/skills/coding-agent-sessions/scripts/agent_sessions/pi_family.py`
- `packages/shared-skills/skills/coding-agent-sessions/scripts/tests/test_pi_family_scanners.py`

Documentation consistency:

- `packages/shared-skills/skills/coding-agent-sessions/SKILL.md`
- `packages/shared-skills/skills/coding-agent-sessions/references/senpi.md`
- `packages/shared-skills/skills/coding-agent-sessions/references/all-platforms.md`

Evidence:

- `.omo/evidence/20260811-coding-agent-sessions-omo/`

Explicitly out of scope:

- Adding `omo` as a new platform key or CLI alias.
- Implementing unrelated `PI_CONFIG_DIR`, `PI_CODING_AGENT_DIR`, or `GJC_CONFIG_DIR` behavior.
- Hand-editing generated skill copies under Codex, Senpi, or `dist/`.

## Delegation topology

- `senpi-scanner-audit` (`explore`, completed): mapped the root cause, scanner flow, and dedupe risks.
- `session-skill-delivery-audit` (`deep`, completed): mapped failing-first tests, packaging obligations, documentation scope, and isolated-HOME CLI QA.
- Lead session: owns all shared-file edits, RED/GREEN execution, evidence capture, generated-copy validation, harness QA, commits, PR lifecycle, merge, and cleanup. These steps are sequential and share the same worktree.
- Post-implementation review: run independent reviewer-shaped tasks through `review-work`; do not use Momus per the user's instruction.

## Execution plan

### TDD and implementation

1. Re-read `pi_family.py`, `scanners.py`, `transcript.py`, and the pi-family tests in the task worktree; confirm `_dedupe()` and `recent()` ordering before defining the duplicate assertion.
2. Add a focused test proving one scan returns distinct sessions from both `$HOME/.omo/agent/sessions` and `$HOME/.senpi/agent/sessions`.
3. Add a focused same-ID test proving the scanner emits one deterministic Senpi result when current and legacy roots overlap.
4. Run only the new tests before production edits and capture the expected assertion failures in `red-pytest.txt` and `red-dedupe.txt`.
5. Change only `SENPI_CONFIG_DIRS` so the common Senpi scanner includes `.omo` without adding a new platform.
6. Re-run the focused tests and capture `green-pytest.txt`.
7. Update the skill and Senpi storage references to document `.omo`, `.senpi`, and `.pi`; do not add prose-pinning tests.

### Verification and real-surface QA

8. Run the full pi-family scanner suite and capture `green-pi-family-suite.txt`.
9. Run the full coding-agent-sessions Python suite and capture its output.
10. Run changed-file Python diagnostics with the configured Pyright/BasedPyright command and capture clean output.
11. Regenerate Codex and Senpi skill copies locally, verify their sync tests, and confirm generated trees remain uncommitted.
12. Run the shared-skills package-shape test and dry-run package inspection.
13. Run the relevant OpenCode, Codex, and Senpi gates required by repository policy, using the mandatory isolated QA workflows where applicable.
14. Create an isolated HOME containing concrete `.omo` and `.senpi` JSONL sessions; invoke the real `find-agent-sessions.py list --platform senpi --limit 20` CLI; assert both IDs, Senpi platform labeling, and source paths; capture `cli-omo-session.txt`.
15. Remove the isolated HOME and every generated QA resource; capture `cleanup.txt` and verify no processes, ports, tmux sessions, or temp directories remain.
16. Run changed-file diagnostics and the final relevant full validation set once after all inputs settle.

### Discovered Senpi gate debugging

The CI-Bun Senpi gate produced 18 failures in two unrelated memory wiring test files. Before continuing delivery:

1. Create `.debug-journal.md` and record every debug artifact.
2. Run focused files under Bun 1.3.12 to distinguish local test-order leakage.
3. Compare an untouched `origin/dev` baseline in a disposable detached worktree.
4. Test whether exact-version dependency/bootstrap state or generated bundles toggle the failures.
5. Confirm the root cause with a toggle proof, fix only if this branch caused it, and clean every debug artifact.
6. Re-run the Senpi gate after the cause is resolved or the base branch is repaired.

### Review, delivery, and merge

17. Self-review the diff against every success criterion and record why the HEAVY tier remained appropriate.
18. Run the `review-work` independent review lanes; verify and fix every criterion-cited blocker, then re-run affected evidence.
19. Inspect repository commit history for the touched paths and create atomic green commits with the plan footer.
20. Push the branch and open an English PR targeting `dev`, including behavior, RED/GREEN proof, real-surface QA, evidence paths, and residual risk.
21. Monitor CI and reviewer gates without polling or bypasses; fix failures in the worktree and re-run scoped QA until all required checks are green.
22. Merge with `gh pr merge --merge --delete-branch`.
23. Verify the merge commit on `origin/dev`, remove the task worktree and local branch, and record the final cleanup receipt.
24. Mark the registered goal complete only after all todo items are reconciled.

## Success criteria and exact scenarios

1. Happy path: `cd packages/shared-skills/skills/coding-agent-sessions && uv run --with pytest pytest scripts/tests/test_pi_family_scanners.py -k omo -vv`.
   - RED: new `.omo` session assertion fails before production changes.
   - GREEN: exit code 0 and the expected `senpi` session is present.
2. Edge and regression: the same focused run includes legacy `.senpi` plus same-ID overlap coverage.
   - RED: `.omo` is absent and overlap assertion fails before production changes.
   - GREEN: legacy and current roots are both covered and duplicate IDs emit once according to the existing deterministic dedupe rule.
3. Real surface: `HOME=<fixture> python3 packages/shared-skills/skills/coding-agent-sessions/scripts/find-agent-sessions.py list --platform senpi --limit 20`.
   - PASS: exit code 0; JSON contains `omo-current` and `senpi-legacy`, all rows are platform `senpi`, and paths prove both stores.
4. Regression/build:
   - PASS: diagnostics, full skill tests, package/sync tests, and mandatory harness QA exit 0 with no suppressions or generated source changes committed.

## Stop condition

Stop immediately when the PR is merged, all criteria have captured RED/GREEN and real-surface evidence, required checks are green, and the task worktree plus QA resources are removed.
