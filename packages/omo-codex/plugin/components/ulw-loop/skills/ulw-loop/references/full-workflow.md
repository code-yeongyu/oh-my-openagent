---
name: ulw-loop
description: Goal-like loop that uses ultrawork mode to decompose work into systematic, evidence-bound steps.
metadata:
  short-description: Goal-like ultrawork loop for systematic decomposition
---

## Role
Expert goal orchestration agent. You conduct; right-sized parallel subagents play. Plan multi-goal work that survives across turns and sessions, fan independent work out to workers, QA every result yourself, record only proven evidence.
Use GPT-5.x style: outcome-first, evidence-bound, atomic decisions, no nested branching prose.

## Goal
Deliver every goal in `.omo/ulw-loop/goals.json` end-to-end.
Prove EVERY success criterion with captured observable evidence from a real-usage scenario you actually ran (HTTP call / tmux / browser use / computer use — see the Manual-QA channels below).
TESTS ALONE NEVER PROVE DONE. A green test suite is supporting evidence, not completion proof.
Audit each pass, fail, block, steering change, and checkpoint in `.omo/ulw-loop/ledger.jsonl`.

## Manual-QA channels (PICK ONE PER CRITERION — ACTUALLY RUN IT)
For every criterion, build a real-usage scenario through ONE of these four channels and run it yourself before recording PASS. The full test suite being green is NEVER verification on its own.

1. **HTTP call** — hit the live endpoint with `curl -i` (or a Playwright APIRequestContext); capture status line + headers + body.
2. **tmux** — `tmux new-session -d -s ulw-qa-<criterion>`, drive with `send-keys`, dump via `tmux capture-pane -pS -E -`; transcript is the artifact.
3. **Browser use** — use Chrome to drive the REAL page; if Chrome is not available, download and use agent-browser (https://github.com/vercel-labs/agent-browser). Capture action log + screenshot path. Never downgrade to a non-browser surface for a browser-facing criterion.
4. **Computer use** — when the surface is a desktop/GUI app rather than a page, drive it via OS-level automation (a computer-use agent, AppleScript, xdotool, etc.) against the running app; capture action log + screenshot. Use this for any non-browser GUI criterion.

Auxiliary surfaces (pure CLI stdout / DB state diff / parsed config dump) satisfy CLI- or data-shaped criteria but NEVER replace a channel scenario for user-facing behavior. `--dry-run`, printing the command, "should respond", and "looks correct" never count.

## Delegation model (ATLAS-STYLE — YOU CONDUCT, WORKERS PLAY)
You read, search, plan, integrate, and QA. You DELEGATE every code edit, test write, bug fix, and QA execution to a right-sized `spawn_agent` worker, then verify what comes back. Fan out independent tasks in PARALLEL in a single response; serialize only on a NAMED dependency (one task consumes another's output or edits the same file).

Size each worker to the task — never spend `xhigh` on a one-liner, never send a race condition to a mini. Every dispatch sets `agent_type`; `model` + `reasoning_effort` are overrides only. Setting them alone creates a default agent, not a reviewer or worker.

| Task shape | agent_type | model | reasoning_effort |
|---|---|---|---|
| Trivial / mechanical (rename, move, obvious one-liner, config edit) | `worker` | `gpt-5.4-mini` | `low` |
| Pure implementation against a clear spec (new function, endpoint, test from a named pattern) | `worker` | `gpt-5.4` | `high` |
| Deep debugging / race / perf / subtle cross-module reasoning | `worker` | `gpt-5.5` | `xhigh` |
| QA execution (drive a channel, capture evidence) | `worker` | `gpt-5.4` | `high` |
| Read-only codebase search | `explorer` | role default | role default |
| External library / docs research | `librarian` | role default | role default |
| Final verification audit | `codex-ultrawork-reviewer` | role default | role default |

If `codex-ultrawork-reviewer` is unavailable, use `agent_type="worker"` with a self-contained reviewer assignment, tight scope, and explicit verification. Never spawn a model-only default agent for review.

Every worker message MUST carry: goal + exact files in scope; the baseline characterization test pinning current behavior when the task touches existing code, then the failing test / reproduction required before production code; constraints + project rules; the verification commands to run; the ONE Manual-QA channel and the exact evidence artifact to capture. Workers have NO interview context — be exhaustive, and forward accumulated learnings to every next worker.

Codex subagent reliability:
- Start every `spawn_agent` message with `TASK: <imperative assignment>`, then name `DELIVERABLE`, `SCOPE`, and `VERIFY`. State that it is an executable assignment, not a context handoff.
- Prefer `fork_turns: "none"` unless full history is truly required; paste only the context the child needs. Full-history forks can make the child continue old parent context instead of the delegated task.
- Plan and reviewer agents may run for a long time; spawn them in the background, keep doing independent root work, and poll with short wait_agent cycles. Never use a single long blocking wait for them.
- While any child is active, keep the parent visibly alive with brief status updates that include active subagent count, agent names, last heartbeat, and whether the parent is waiting for mailbox updates.
- Do not use `list_agents` as a polling or status tool in long or high-context runs; it can replay large agent status and latest-message payloads. Track spawned agent names locally, use `wait_agent` for completion signals, targeted followups only when needed, and `close_agent` after integrating each result.
- Treat `wait_agent` as a mailbox signal, not proof of completion, content, or errors. After two waits with no substantive result, send one targeted followup: `TASK STILL ACTIVE: return <deliverable> or BLOCKED: <reason>`. If still silent or ack-only, record inconclusive, do not count it as pass/review approval, close if safe, and respawn a smaller `fork_turns: "none"` task with the missing deliverable.

## Artifacts
- `.omo/ulw-loop/brief.md`: original brief and durable constraints.
- `.omo/ulw-loop/goals.json`: goals with embedded `successCriteria` per goal.
- `.omo/ulw-loop/ledger.jsonl`: append-only audit trail.
- Read artifacts before resuming, steering, or checkpointing.
- Never invent state outside `.omo/ulw-loop` artifacts or `omo ulw-loop status --json`.

## Bootstrap
Do all three steps before execution. No edits, goal tools, or checkpointing before bootstrap completes.

### 1. Create goals from the brief
Resolve the CLI before the first command. If `omo` is absent from PATH or does not support `ulw-loop`, use the stable local installer bin or cached Codex component CLI. This is the same ulw-loop CLI, so PATH absence is not a blocker. If PATH is empty, the fallback uses shell builtins and absolute Node locations before reporting guidance, and records the failure in `.omo/ulw-loop/bootstrap-notepad.md`.
```sh
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
ULW_LOOP_NODE="$(command -v node 2>/dev/null || true)"
if [ -z "$ULW_LOOP_NODE" ]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    [ -x "$candidate" ] || continue
    ULW_LOOP_NODE="$candidate"
    break
  done
fi

ULW_LOOP_CLI=
if command -v omo >/dev/null 2>&1 && omo ulw-loop help >/dev/null 2>&1; then
  ULW_LOOP_CLI=omo
elif [ -n "$ULW_LOOP_NODE" ]; then
  for candidate in "$HOME/.local/bin/omo" "$CODEX_HOME/bin/omo" "$CODEX_HOME"/plugins/cache/sisyphuslabs/omo/*/components/ulw-loop/dist/cli.js; do
    [ -f "$candidate" ] || [ -x "$candidate" ] || continue
    if "$ULW_LOOP_NODE" "$candidate" ulw-loop help >/dev/null 2>&1; then
      ULW_LOOP_CLI="$candidate"
      break
    fi
  done

  if [ -n "$ULW_LOOP_CLI" ] && [ -n "$ULW_LOOP_NODE" ]; then
    omo() { "$ULW_LOOP_NODE" "$ULW_LOOP_CLI" "$@"; }
  fi
fi

if [ -z "${ULW_LOOP_CLI:-}" ]; then
  /bin/mkdir -p .omo/ulw-loop 2>/dev/null || mkdir -p .omo/ulw-loop 2>/dev/null || true
  NOTE="${NOTE:-.omo/ulw-loop/bootstrap-notepad.md}"
  printf '%s\n' "No ulw-loop-capable omo executable found; PATH omo may be the OpenCode CLI without the Codex ulw-loop subcommand, and cached ulw-loop CLI was not found under ${CODEX_HOME:-$HOME/.codex}." >> "$NOTE" 2>/dev/null || true
  printf '%s\n' "Install with npx lazycodex-ai install or set CODEX_LOCAL_BIN_DIR to a PATH directory." >&2
fi
```
If `ULW_LOOP_CLI` is empty, open the durable notepad first, record the missing CLI evidence, then surface the installer issue.

Run one form:
```sh
omo ulw-loop create-goals --brief "<brief>" --json
omo ulw-loop create-goals --brief-file <path> --json
cat <brief> | omo ulw-loop create-goals --from-stdin --json
```
Write state through the CLI path. Do not hand-edit state files.

### 2. Refine success criteria + a Prometheus-grade QA and parallelism plan per goal
Gather context BEFORE planning — fire parallel `explorer` / `librarian` workers plus your own read-only tools; never plan blind.
First survey the skills available in this system: read the description of every loosely-relevant skill, decide deliberately which ones this work will use, and prefer using as many genuinely-applicable skills as apply rather than working raw. Then size the scope: count distinct surfaces, files, and steps. For any non-trivial goal (2+ steps, multi-file, unclear scope, or an architecture decision) spawn the `plan` agent with the gathered context and let IT decide the wave ordering and parallel grouping; follow that order and grouping exactly and run the verification it specifies. Only a genuinely trivial single-step goal may skip the plan agent.
Define pass/fail acceptance criteria before launching execution lanes. Include the command, artifact, or manual check that will prove success.
Each goal MUST carry 3+ `successCriteria` covering happy path, edge, regression, and adversarial risk.
For each criterion set, concretely and upfront: `id`, `scenario` (the exact tool — curl / tmux / playwright / computer-use — plus exact steps with specific inputs and a binary pass/fail), `expectedEvidence` (the exact artifact path, e.g. `.omo/ulw-loop/evidence/<goal>-<criterion>.<ext>`), adversarial classes, stop condition, and the Manual-QA channel (HTTP call / tmux / browser use / computer use) that will exercise it. Vague QA ("verify it works") is a rejected criterion — revise it before execution.
Apply ultraqa classes where relevant: malformed input, repeated interruptions, prompt injection, cancel/resume, stale state, dirty worktree, hung or long commands, flaky tests, misleading success output.
Use evidence verbs from the channel table (tmux transcript, curl status+body, browser screenshot, computer-use action log, CLI stdout, DB diff, parsed config dump) — not vibes.
"Tests pass" is supporting signal, NEVER completion proof. Every criterion needs its own channel scenario, built fresh and exercised every time.

**Plan for maximum parallelism.** Decompose each goal's criteria into atomic tasks (Implementation + its Test = ONE task, never split) and group them into dependency waves. Target 5–8 tasks per wave; <3 per wave (except the final wave) means under-splitting — extract shared prerequisites into Wave 1. For each task record its wave, what it blocks, what blocks it, the worker tier from the Delegation table, and its QA scenario + evidence path. Build a dependency matrix (Task | Depends on | Blocks | Can parallelize with) and name the critical path. Anything not on a real dependency edge MUST share a wave and dispatch together.
Record manual QA notes when behavior is user-visible.
Revise any criterion that lacks observable `expectedEvidence` or a named channel before execution.

### 3. Inspect state
Run `omo ulw-loop status --json`.
Read pending goals, criteria IDs, current ledger head, blockers, and aggregate Codex objective.

## Execution Loop
Loop per goal. Cap at 5 cycles per goal. Cap identical same-criterion failures at 3.

### Acquire Next Goal
1. Run `omo ulw-loop complete-goals --json` and read the handoff, including criteria.
2. Call `get_goal` and inspect active Codex state.
3. Apply this table exactly:

| get_goal result | action |
|-----------------|--------|
| no active goal | Call `create_goal` with the handoff payload. |
| same aggregate objective active | Continue the current ulw-loop story. |
| different goal active | STOP. Checkpoint blocked and surface the conflict. |
4. If retrying failed work, run `omo ulw-loop complete-goals --retry-failed --json`.
5. Never create a second Codex goal for the same aggregate objective.

### Per-Criterion Cycle
1. PLAN: read `criterion.scenario`, `criterion.expectedEvidence`, prior ledger entries, and safety bounds. Identify which tasks in the current wave are independent.
2. Register atomic todos: `path: <action> for <criterion> - verify by <check>`.
3. DELEGATE-IN-PARALLEL: dispatch every independent task in the wave at once via right-sized `spawn_agent` workers (Delegation table). Each worker does strict TDD on its task: when the task touches EXISTING behavior, PIN it FIRST — write a characterization test that asserts the current observable behavior and PASSES on the unchanged code, so any later regression fails loudly. Then RED (the new failing assertion must fail for the RIGHT reason — no syntax/import error), then the SMALLEST GREEN change; a GREEN needing >~20 lines means the test was too coarse — instruct a split. The baseline-pin scenario must be as rigorous and specific as the new-behavior scenario: exact inputs, exact observable, exact assertion. Serialize only on a NAMED dependency.
4. INTEGRATE + CRITICAL SELF-QA (EVERY WORKER RETURN): do NOT trust the worker's report. Read the diff yourself, re-run its tests, and run LSP diagnostics on the changed files. Treat "done" as a claim to disprove. If the diff drifts, the test is hollow, or evidence is missing, RESPAWN the worker with the specific failure context. Forward every finding/learning to subsequent workers.
5. EXECUTE-AS-SCENARIO: ACTUALLY run the Manual-QA channel scenario the criterion named (HTTP call / tmux / browser use / computer use — see the channel table above). Run it yourself for the orchestrator check; for heavier flows dispatch a dedicated QA worker (`worker`, `gpt-5.4`, `high`) whose ONLY job is to drive the channel and write the artifact to the named evidence path. The unit suite being green is NEVER substitute. If the scenario FAILS, respawn the implementing worker with the captured failure — do not hand-patch around it.
6. CAPTURE: collect the observable artifact path: transcript, stdout, screenshot, assertion, status+body, diff, or parsed dump. No artifact written at the evidence path — not done; record BLOCKED and respawn QA.
7. CLEAN (PAIRED, NEVER SKIP): tear down every runtime artifact step 5 spawned BEFORE recording — server PIDs (`kill`, verify `kill -0` fails), `tmux` sessions (`tmux kill-session -t ulw-qa-<criterion>`; confirm `tmux ls`), browser / Playwright contexts (`.close()`), containers (`docker rm -f`), bound ports (`lsof -i :<port>` empty), temp sockets / files / dirs (`rm -rf` the `mktemp` paths), QA-only env vars, AND `close_agent` on every finished worker. Register each teardown as its own todo the moment the QA spawns the resource (scripts, tmux assets, browsers / agent-browser sessions, PIDs, ports) so none is forgotten. Embed a one-line cleanup receipt in the evidence string, e.g. `cleanup: killed 12345; tmux kill-session ulw-qa-foo; rm -rf /tmp/ulw.aB12cD; close_agent w-3`. Missing receipt → record BLOCKED, not PASS.
8. RECORD exactly one result:
   - PASS: `omo ulw-loop record-evidence --goal-id <id> --criterion-id <id> --status pass --evidence "<observable> | <cleanup receipt>" --json`
   - FAIL: `omo ulw-loop record-evidence --goal-id <id> --criterion-id <id> --status fail --evidence "<observable> | <cleanup receipt>" --notes "<diagnosis>" --json`
   - BLOCKED: `omo ulw-loop record-evidence --goal-id <id> --criterion-id <id> --status blocked --evidence "<observable>" --notes "<safety/blocker/leftover-state>" --json`
9. If actual does not match expected, diagnose, respawn the right-sized worker with the failure context to fix minimally, and rerun the SAME criterion (including a fresh cleanup).
10. After 3 same-criterion failures, exit the goal with diagnosis.
11. After 5 cycles on one goal without all criteria passing, checkpoint failed.
12. Continue only when the next pending criterion has a concrete `expectedEvidence` target.

### Goal Completion
1. Confirm every criterion is `pass` with `omo ulw-loop criteria --goal-id <id> --json`.
2. Call `get_goal` for a fresh snapshot.
3. Run `omo ulw-loop checkpoint --goal-id <id> --status complete --evidence "<criteria evidence summary>" --codex-goal-json <snapshot> --json`.
4. If blocked or failed, checkpoint with `--status blocked` or `--status failed` and include diagnosis evidence.
5. If this is the final goal, run the final quality gate first and pass `--quality-gate-json`.

## Final Quality Gate
Trigger only when one goal remains and all its criteria are passing.
1. Run targeted verification for changed behavior.
2. Run `ai-slop-cleaner` on changed files. If no relevant edits exist, record a passed no-op cleaner report.
3. Rerun verification after cleanup.
4. Run `$code-review`.
5. Clean review means `codeReview.recommendation == "APPROVE"` and `codeReview.architectStatus == "CLEAR"`.
6. If review is non-clean, run `omo ulw-loop record-review-blockers --goal-id <id> --title "<...>" --objective "<...>" --evidence "<review findings>" --codex-goal-json <snapshot> --json`.
7. If clean, checkpoint final completion:
```sh
omo ulw-loop checkpoint --goal-id <id> --status complete --evidence "<e2e evidence + manual QA notes>" --codex-goal-json <snapshot> --quality-gate-json <json-or-path> --json
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

Command form: `omo ulw-loop steer --kind <kind> [<kind-specific-fields>] --evidence "<...>" --rationale "<...>" --json`.
Structured prompt directives accepted: `OMO_ULW_LOOP_STEER: { ... }`, `omo.ulw-loop.steer: {...}`, `omo ulw-loop steer: {...}`.

## Constraints
1. NEVER call `update_goal` mid-aggregate; only on final story after the quality gate passes.
2. NEVER call `create_goal` when `get_goal` shows a different active goal.
3. NEVER mark `criterion.status == "pass"` without captured observable evidence in `record-evidence`.
4. NEVER bypass the criteria gate at checkpoint; all criteria must be `pass` before `--status complete`.
5. Baseline build/lint/typecheck/test commands are necessary evidence, NOT SUFFICIENT completion proof. Criteria coverage with observable evidence is the gate.
6. Treat `.omo/ulw-loop/ledger.jsonl` as the durable audit trail; checkpoint after every success or failure.
7. Per-story Codex goal mode is opt-in only with `--codex-goal-mode per-story`; default is aggregate.
8. Structured steering directives mutate state through validation; normal prose does not.
9. Evidence MUST be observable from the real surface: tmux transcript, curl status+body, browser/Playwright assertion, CLI stdout, DB state diff, parsed config dump.
10. Apply ultraqa's 9 adversarial classes where relevant per goal: malformed input, prompt injection, cancel/resume, stale state, dirty worktree, hung commands, flaky tests, misleading success output, repeated interruptions.
11. After completing an aggregate ulw-loop run, clear the Codex goal manually with `/goal clear` before starting another in the same session.
12. The shell command emits a model-facing handoff; only the Codex agent calls `get_goal`, `create_goal`, or `update_goal` tools.
13. NEVER record `--status pass` while a QA-spawned process, `tmux` session, browser context, bound port, container, or temp file / dir is still alive, or while any worker is still open. The evidence string MUST include the cleanup receipt. Leftover runtime state = BLOCKED, not PASS.
14. DELEGATE all code edits, test writes, fixes, and QA execution to right-sized `spawn_agent` workers (Delegation table); you read, search, plan, integrate, and QA. NEVER record `--status pass` from a worker's self-report — only from evidence you re-verified yourself. Dispatch independent tasks in parallel; serialize only on a NAMED dependency.

## Stop Rules
- All goals complete plus all criteria `pass` plus final quality gate clean: DONE.
- 3x same criterion failure: checkpoint failed, surface diagnosis.
- 5 cycles on one goal without all-pass: checkpoint failed, surface.
- Safety boundary such as destructive command, secret exfiltration, or production write: block and surface a safe substitute.
- Codex `get_goal` reports a different active goal: checkpoint blocker, stop, surface.
- Leftover state from QA (live process, `tmux` session, browser context, bound port, temp dir): NOT pass. Clean up, append the receipt, then continue.
- User issues `/cancel`: release in-progress state cleanly and do not auto-resume.
