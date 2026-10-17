# Self-audit ledger - issue #7338 fix

Protocol: mechanical state machine; each wave re-reads the fresh full git diff
from disk plus adjacent callers/owners/teardown/error/platform paths; maintains
a P0/P1/P2/P3/noise ledger. The finding wave never counts clean. Done only
after two consecutive post-final-edit waves with empty actionable ledgers.

Scope audited (entire vertical):
- packages/omo-opencode/src/features/question-visibility-watchdog/{watchdog,index,watchdog.test}.ts (new)
- packages/omo-opencode/src/plugin/tool-execute-before.ts (+6/-1)
- packages/omo-opencode/src/plugin/tool-execute-before.test.ts (+60)
- packages/omo-opencode/src/plugin-interface.ts (+20)
Adjacent paths re-checked: create-plugin-module.ts (interface construction +
dispose chain), hooks/claude-code-hooks/claude-code-hooks-hook.ts (second
caller of createToolExecuteBeforeHandler - optional dep unaffected),
plugin/types.ts (PluginContext), SDK client surface (tui.showToast,
session.messages query.directory), prompt-async-gate invariants (no new raw
prompt routes), shared/logger.

## Wave 1 (finding wave - never counts clean)
- P0: none
- P1: none
- P2: none
- P3: none actionable
- NOISE-1 (accepted, documented): production dispose() of the watchdog is not
  wired into the plugin dispose chain. Rationale: timers are 30s one-shots,
  the schedule Map self-deletes entries on fire, and process exit bounds the
  lifetime; wiring would mutate shared CreatedHooks/dispose contracts for zero
  observable benefit, against the minimal-fix constraint.
- NOISE-2 (accepted, documented): the toast can also fire when a user simply
  has not answered within 30s of a fully visible prompt. The message wording
  explicitly covers that case ("If no question prompt is visible..."); TUI
  render state is unknowable server-side.
clean_streak = 0

## Wave 2 (post-final-edit)
Re-read fresh diff from disk (identical to wave 1; no edits between waves).
Gates rerun: tsgo PASS; focused suites 30/30 PASS; git diff --check PASS;
hygiene scan (as any/@ts-ignore/@ts-expect) clean; no raw session.prompt
routes introduced; LOC within 200-line limit; barrel exports intact.
Actionable findings: NONE (NOISE-1/2 remain accepted-by-design).
clean_streak = 1

## Wave 3 (post-final-edit, second consecutive)
Fresh diff re-read: identical. Gates rerun: tsgo PASS; 30/30 PASS;
git diff --check PASS; hygiene PASS. Adjacent callers re-verified.
Actionable findings: NONE.
clean_streak = 2 -> STOP. Audit complete.
