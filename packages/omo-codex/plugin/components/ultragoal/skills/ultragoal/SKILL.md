---
name: ultragoal
description: Durable repo-native multi-goal plans with embedded success criteria and evidence audit.
---

## Role
Expert goal orchestration agent. Plan multi-goal work that survives across turns and sessions.
Use GPT-5.x style: outcome-first, evidence-bound, atomic decisions, no nested branching prose.

## Goal
Deliver every goal in `.omo/ultragoal/goals.json` end-to-end.
Prove EVERY success criterion with captured observable evidence from a real-usage scenario you actually ran (HTTP call / tmux / browser use / computer use — see the Manual-QA channels below).
TESTS ALONE NEVER PROVE DONE. A green test suite is supporting evidence, not completion proof.
Audit each pass, fail, block, steering change, and checkpoint in `.omo/ultragoal/ledger.jsonl`.

## Manual-QA channels (PICK ONE PER CRITERION — ACTUALLY RUN IT)
For every criterion, build a real-usage scenario through ONE of these four channels and run it yourself before recording PASS. The full test suite being green is NEVER verification on its own.

1. **HTTP call** — hit the live endpoint with `curl -i` (or a Playwright APIRequestContext); capture status line + headers + body.
2. **tmux** — `tmux new-session -d -s ulw-qa-<criterion>`, drive with `send-keys`, dump via `tmux capture-pane -pS -E -`; transcript is the artifact.
3. **Browser use** — drive the real page via Playwright / puppeteer / Chromium; capture action log + screenshot path.
4. **Computer use** — OS-level GUI automation (computer-use agent, AppleScript, xdotool, etc.) against the running app; capture action log + screenshot.

Auxiliary surfaces (pure CLI stdout / DB state diff / parsed config dump) satisfy CLI- or data-shaped criteria but NEVER replace a channel scenario for user-facing behavior. `--dry-run`, printing the command, "should respond", and "looks correct" never count.

## Artifacts
- `.omo/ultragoal/brief.md`: original brief and durable constraints.
- `.omo/ultragoal/goals.json`: goals with embedded `successCriteria` per goal.
- `.omo/ultragoal/ledger.jsonl`: append-only audit trail.
- Read artifacts before resuming, steering, or checkpointing.
- Never invent state outside `.omo/ultragoal` artifacts or `omo ultragoal status --json`.

## Bootstrap
Do all three steps before execution. No edits, goal tools, or checkpointing before bootstrap completes.

### 1. Create goals from the brief
Run one form:
```sh
omo ultragoal create-goals --brief "<brief>" --json
omo ultragoal create-goals --brief-file <path> --json
cat <brief> | omo ultragoal create-goals --from-stdin --json
```
Write state through the CLI path. Do not hand-edit state files.

### 2. Refine success criteria per goal
Define pass/fail acceptance criteria before launching execution lanes. Include the command, artifact, or manual check that will prove success.
Each goal MUST carry 3+ `successCriteria` covering happy path, edge, regression, and adversarial risk.
For each criterion set: `id`, `scenario`, `expectedEvidence`, adversarial classes, stop condition, and the Manual-QA channel (HTTP call / tmux / browser use / computer use) that will exercise it.
Apply ultraqa classes where relevant: malformed input, repeated interruptions, prompt injection, cancel/resume, stale state, dirty worktree, hung or long commands, flaky tests, misleading success output.
Use evidence verbs from the channel table (tmux transcript, curl status+body, browser screenshot, computer-use action log, CLI stdout, DB diff, parsed config dump) — not vibes.
"Tests pass" is supporting signal, NEVER completion proof. Every criterion needs its own channel scenario, built fresh and exercised every time.
Record manual QA notes when behavior is user-visible.
Revise any criterion that lacks observable `expectedEvidence` or a named channel before execution.

### 3. Inspect state
Run `omo ultragoal status --json`.
Read pending goals, criteria IDs, current ledger head, blockers, and aggregate Codex objective.

## Execution Loop
Loop per goal. Cap at 5 cycles per goal. Cap identical same-criterion failures at 3.

### Acquire Next Goal
1. Run `omo ultragoal complete-goals --json` and read the handoff, including criteria.
2. Call `get_goal` and inspect active Codex state.
3. Apply this table exactly:

| get_goal result | action |
|-----------------|--------|
| no active goal | Call `create_goal` with the handoff payload. |
| same aggregate objective active | Continue the current ultragoal story. |
| different goal active | STOP. Checkpoint blocked and surface the conflict. |
4. If retrying failed work, run `omo ultragoal complete-goals --retry-failed --json`.
5. Never create a second Codex goal for the same aggregate objective.

### Per-Criterion Cycle
1. PLAN: read `criterion.scenario`, `criterion.expectedEvidence`, prior ledger entries, and safety bounds.
2. Register atomic todos: `path: <action> for <criterion> - verify by <check>`.
3. EXECUTE-AS-SCENARIO: do one bounded change, then ACTUALLY run the Manual-QA channel scenario the criterion named (HTTP call / tmux / browser use / computer use — see the channel table above). The unit suite being green is NEVER substitute for running the channel scenario.
4. CAPTURE: collect the observable artifact path: transcript, stdout, screenshot, assertion, status+body, diff, or parsed dump.
5. CLEAN (PAIRED, NEVER SKIP): tear down every runtime artifact step 3 spawned BEFORE recording — server PIDs (`kill`, verify `kill -0` fails), `tmux` sessions (`tmux kill-session -t ulw-qa-<criterion>`; confirm `tmux ls`), browser / Playwright contexts (`.close()`), containers (`docker rm -f`), bound ports (`lsof -i :<port>` empty), temp sockets / files / dirs (`rm -rf` the `mktemp` paths), QA-only env vars. Embed a one-line cleanup receipt in the evidence string, e.g. `cleanup: killed 12345; tmux kill-session ulw-qa-foo; rm -rf /tmp/ulw.aB12cD`. Missing receipt → record BLOCKED, not PASS.
6. RECORD exactly one result:
   - PASS: `omo ultragoal record-evidence --goal-id <id> --criterion-id <id> --status pass --evidence "<observable> | <cleanup receipt>" --json`
   - FAIL: `omo ultragoal record-evidence --goal-id <id> --criterion-id <id> --status fail --evidence "<observable> | <cleanup receipt>" --notes "<diagnosis>" --json`
   - BLOCKED: `omo ultragoal record-evidence --goal-id <id> --criterion-id <id> --status blocked --evidence "<observable>" --notes "<safety/blocker/leftover-state>" --json`
7. If actual does not match expected, diagnose, fix minimally, and rerun the SAME criterion (including a fresh cleanup).
8. After 3 same-criterion failures, exit the goal with diagnosis.
9. After 5 cycles on one goal without all criteria passing, checkpoint failed.
10. Continue only when the next pending criterion has a concrete `expectedEvidence` target.

### Goal Completion
1. Confirm every criterion is `pass` with `omo ultragoal criteria --goal-id <id> --json`.
2. Call `get_goal` for a fresh snapshot.
3. Run `omo ultragoal checkpoint --goal-id <id> --status complete --evidence "<criteria evidence summary>" --codex-goal-json <snapshot> --json`.
4. If blocked or failed, checkpoint with `--status blocked` or `--status failed` and include diagnosis evidence.
5. If this is the final goal, run the final quality gate first and pass `--quality-gate-json`.

## Final Quality Gate
Trigger only when one goal remains and all its criteria are passing.
1. Run targeted verification for changed behavior.
2. Run `ai-slop-cleaner` on changed files. If no relevant edits exist, record a passed no-op cleaner report.
3. Rerun verification after cleanup.
4. Run `$code-review`.
5. Clean review means `codeReview.recommendation == "APPROVE"` and `codeReview.architectStatus == "CLEAR"`.
6. If review is non-clean, run `omo ultragoal record-review-blockers --goal-id <id> --title "<...>" --objective "<...>" --evidence "<review findings>" --codex-goal-json <snapshot> --json`.
7. If clean, checkpoint final completion:
```sh
omo ultragoal checkpoint --goal-id <id> --status complete --evidence "<e2e evidence + manual QA notes>" --codex-goal-json <snapshot> --quality-gate-json <json-or-path> --json
```
`--quality-gate-json` shape:
```json
{
  "aiSlopCleaner": { "status": "passed", "evidence": "cleaner report" },
  "verification": { "status": "passed", "commands": ["npm test"], "evidence": "post-cleaner verification" },
  "codeReview": { "recommendation": "APPROVE", "architectStatus": "CLEAR", "evidence": "review synthesis" },
  "criteriaCoverage": { "totalCriteria": N, "passCount": N, "adversarialClassesCovered": ["malformed_input", "..."] }
}
```

## Dynamic Steering
Use steering only for structured evidence-backed mutation. Reject natural-language steering requests.

| Kind | When to use | Required fields |
|------|-------------|-----------------|
| add_subgoal | Real blocker found; new story required | `--title`, `--objective`, `--evidence`, `--rationale` |
| split_subgoal | Story too large; needs decomposition | `--goal-id`, `--children` JSON, `--evidence`, `--rationale` |
| reorder_pending | Discovered dependency order | `--order` JSON array of ids, `--evidence`, `--rationale` |
| revise_pending_wording | Title/objective ambiguous | `--goal-id`, `--title?`, `--objective?`, `--evidence`, `--rationale` |
| revise_criterion | Criterion lacks observable PASS evidence | `--goal-id`, `--criterion-id`, `--scenario?`, `--expected-evidence?`, `--evidence`, `--rationale` |
| annotate_ledger | Audit-only note | `--evidence`, `--rationale` |
| mark_blocked_superseded | Old story replaced by new evidence | `--goal-id`, `--replacements?`, `--evidence`, `--rationale` |

Command form: `omo ultragoal steer --kind <kind> [<kind-specific-fields>] --evidence "<...>" --rationale "<...>" --json`.
Structured prompt directives accepted: `OMO_ULTRAGOAL_STEER: { ... }`, `omo.ultragoal.steer: {...}`, `omo ultragoal steer: {...}`.

## Constraints
1. NEVER call `update_goal` mid-aggregate; only on final story after the quality gate passes.
2. NEVER call `create_goal` when `get_goal` shows a different active goal.
3. NEVER mark `criterion.status == "pass"` without captured observable evidence in `record-evidence`.
4. NEVER bypass the criteria gate at checkpoint; all criteria must be `pass` before `--status complete`.
5. Baseline build/lint/typecheck/test commands are necessary evidence, NOT SUFFICIENT completion proof. Criteria coverage with observable evidence is the gate.
6. Treat `.omo/ultragoal/ledger.jsonl` as the durable audit trail; checkpoint after every success or failure.
7. Per-story Codex goal mode is opt-in only with `--codex-goal-mode per-story`; default is aggregate.
8. Structured steering directives mutate state through validation; normal prose does not.
9. Evidence MUST be observable from the real surface: tmux transcript, curl status+body, browser/Playwright assertion, CLI stdout, DB state diff, parsed config dump.
10. Apply ultraqa's 9 adversarial classes where relevant per goal: malformed input, prompt injection, cancel/resume, stale state, dirty worktree, hung commands, flaky tests, misleading success output, repeated interruptions.
11. After completing an aggregate ultragoal run, clear the Codex goal manually with `/goal clear` before starting another in the same session.
12. The shell command emits a model-facing handoff; only the Codex agent calls `get_goal`, `create_goal`, or `update_goal` tools.
13. NEVER record `--status pass` while a QA-spawned process, `tmux` session, browser context, bound port, container, or temp file / dir is still alive. The evidence string MUST include the cleanup receipt. Leftover runtime state = BLOCKED, not PASS.

## Stop Rules
- All goals complete plus all criteria `pass` plus final quality gate clean: DONE.
- 3x same criterion failure: checkpoint failed, surface diagnosis.
- 5 cycles on one goal without all-pass: checkpoint failed, surface.
- Safety boundary such as destructive command, secret exfiltration, or production write: block and surface a safe substitute.
- Codex `get_goal` reports a different active goal: checkpoint blocker, stop, surface.
- Leftover state from QA (live process, `tmux` session, browser context, bound port, temp dir): NOT pass. Clean up, append the receipt, then continue.
- User issues `/cancel`: release in-progress state cleanly and do not auto-resume.
