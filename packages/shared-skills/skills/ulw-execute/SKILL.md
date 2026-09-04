---
name: ulw-execute
description: "Execute a Prometheus work plan with Boulder state, evidence ledger updates, worktree discipline, parallel subagents, and Stop-hook continuation. Use after planning when the user says ulw-execute, execute plan, continue plan, resume plan, or asks to run a .omo/plans plan."
---

## ABSOLUTE RULE: YOU ARE AN ORCHESTRATOR — NEVER THE IMPLEMENTER

**YOU DO NOT WRITE CODE. YOU DO NOT EDIT PRODUCT FILES. YOU DO NOT RUN QA YOURSELF. EVERY unit of implementation, test, QA, and review work MUST be delegated to a spawned subagent. NO EXCEPTIONS.** Your hands touch only plan selection, `.omo/` state (Boulder, ledger, plan checkboxes), decomposition, dispatch, verdicts, and evidence records. About to edit a product file or run an implementation command yourself? **STOP. SPAWN A WORKER INSTEAD.** Orchestrate at **MAXIMUM PARALLELISM**: every independent unit runs concurrently; only named dependencies serialize.

## Codex Harness Tool Compatibility

Translate any OpenCode-only tool name in an inherited example to its Codex equivalent:

| OpenCode example | Codex tool to use |
| --- | --- |
| final-review `task(...)` | `multi_agent_v1.spawn_agent({"message":"TASK: act as a rigorous reviewer. ...","agent_type":"lazycodex-gate-reviewer","fork_context":false})` |
| worker `task(...)` | `multi_agent_v1.spawn_agent({"message":"TASK: act as <role>. ...","fork_context":false})` — for implementation workers add `agent_type: "lazycodex-worker-<low|medium|high>"` when the spawn schema exposes `agent_type` |
| `background_output(task_id="...")` | `multi_agent_v1.wait_agent(...)` for mailbox signals |
| `team_*(...)` | `multi_agent_v1.spawn_agent` + `multi_agent_v1.send_input` + `multi_agent_v1.wait_agent` + `multi_agent_v1.close_agent` |

When translating `load_skills=[...]`, name the skills inside the spawned agent's `message`. If a code block below conflicts with this section, this section wins.

Codex exposes ONE of two subagent tool surfaces per session; check your own tool list and route accordingly. If `multi_agent_v1.*` tools exist, use the table above as written. If instead a flat `spawn_agent` with a required `task_name` exists (`multi_agent_v2`), rewrite every `multi_agent_v1.*` example: `multi_agent_v1.spawn_agent({...,"fork_context":false})` becomes `spawn_agent({"task_name":"<lowercase_digits_underscores>","message":...,"agent_type":...,"fork_turns":"none"})` (`"all"` only when full parent history is truly required); `send_input` becomes `send_message`; do not call `close_agent`/`resume_agent` (finished agents end on their own; `followup_task` re-tasks one, `interrupt_agent` stops one); `wait_agent` takes only `timeout_ms` and returns on any child mailbox activity. On the v2 surface `agent_type` may be absent from the spawn schema — when absent, omit it and describe the role inside `message`. If a code block below conflicts with this section, this section wins.

### Codex tier mapping for the delegation router
When tier worker agents are installed, map the delegation router's parenthesized difficulty to `agent_type`: (low) -> `lazycodex-worker-low`; (medium) -> `lazycodex-worker-medium`; (high) -> `lazycodex-worker-high`. Explorer/librarian research lanes keep their own roles. On spawn surfaces without `agent_type`, state the tier inside `message`. Difficulty (model power) is orthogonal to the LIGHT/HEAVY rigor tier in step 4 — judge each on its own facts.

## Codex Subagent Reliability

Every `multi_agent_v1.spawn_agent` message is a self-contained executable assignment: `TASK: <imperative assignment>`, then `DELIVERABLE`, `SCOPE`, and `VERIFY`, with role instructions inside `message`. Use `fork_context: false` unless full history is truly required; paste only the context the child needs.

Plan and reviewer agents may run for a long time: spawn them in the background and keep doing independent root work. Between `multi_agent_v1.wait_agent` calls, back off — double the timeout up to ~5 minutes — instead of spinning short cycles. A timeout only means no new mailbox update arrived; treat a running child as alive. Require `WORKING: <task> - <current phase>` before long passes and `BLOCKED: <reason>` only when progress stops. Keep the parent visibly alive with active subagent count, names, and latest `WORKING:` phase. Fallback only when the child is completed without the deliverable, ack-only after followup, explicitly `BLOCKED:`, or no longer running — then record inconclusive (never a pass), close if safe, and respawn a smaller `fork_context: false` task with the missing deliverable.

# ulw-execute

Execute a Prometheus work plan until every top-level checkbox is complete. This skill pairs with the harness's ulw-execute continuation hook, which re-injects the next turn while `.omo/boulder.json` says this `codex:<session_id>` still has unchecked plan work.

## Usage

```text
$ulw-execute [plan-name] [--worktree <absolute-path>] [--make-pr] [--ship]
```

- `plan-name` (optional): a full or partial file stem under `.omo/plans/`.
- `--worktree` (optional): reuse an existing task-owned worktree for the first phase instead of creating one; every phase runs in a task-owned worktree regardless.
- `--make-pr` (optional): deliver each phase's worktree as a pull request — push the branch, open a reviewer-readable PR, hand off with the URL, and merge only if the user asks.
- `--ship` (optional): full delivery lifecycle; implies `--make-pr`. After the PR opens, stay on the job until it is MERGED: watch CI and review gates, fix failures and address feedback from the worktree (fresh QA evidence for behavior changes), merge per the repository's merge policy, then remove the worktree and sync `.omo/` state back.

## Goal and todo discipline (MANDATORY)

Do ALL of this immediately after the plan is selected, BEFORE the first implementation dispatch. Skipping any step is a defect.

1. **Set the goal, in detail.** When a goal tool is available (`create_goal`), call it with a DETAILED objective: the plan name and path, the concrete end state, the phase and task counts, the delivery mode (direct, `--make-pr`, or `--ship`), and how completion will be verified. One work session = one registered goal (the goal tool holds one active goal); each phase then carries its own concrete goal — the ledger entry Phase 2 records before the wave's first dispatch, defined from the previous phase's landed and verified evidence. No goal tool -> record the same objective as the first ledger entry.
2. **Register every phase and task as todos.** Mirror the plan into the todo/plan tool of your harness: one phase per plan wave, one todo per column-zero checkbox (including the final verification wave). Register ALL of them up front - never keep tasks in memory only.
3. **Keep them current at every moment.** Mark a todo in_progress when its work dispatches and done immediately after its verification passes. Never batch-complete at the end, never execute work that is not a registered todo; discovered work — a pre-existing bug, failing test, stale doc, or wrong guidance — is appended to the plan as a checkbox, mirrored as a todo before it runs, and fixed to the ideal state, never deferred as a follow-up. A worker that meets a defect outside its assigned files reports it instead of fixing it; only the orchestrator appends the checkbox and dispatches it to a correctly scoped unit. The todo list, Boulder state, and plan checkboxes must always tell the same story.

## Phase 1: Select the plan

1. Read `.omo/boulder.json` if it exists.
2. List Prometheus plan files under `.omo/plans/`.
3. If `plan-name` was provided, select the matching plan.
4. If exactly one active or paused Boulder work exists for this session, resume it.
5. If no active work exists and exactly one plan exists, select it.
6. If no active work exists and there is no selectable plan, enter **No-plan bootstrap**.
7. If multiple plans remain possible, ask one focused selection question.

### No-plan bootstrap

When the user explicitly said `start work` / `$ulw-execute` and no selectable plan exists, treat that phrase as approval: bootstrap `ulw-plan` to create the approved plan before execution and implementation, instead of stalling or asking for generic approval again. A brief or notes file without waves, checkboxes, and acceptance criteria is NOT decision-complete — enter this bootstrap too.

1. Invoke the `ulw-plan` skill from the current request and require its dynamic adversarial workflow: collect, verify, design, adversarial plan-review, synthesize.
2. The generated Prometheus plan must be saved under `.omo/plans/<slug>.md` before implementation or Boulder state writes that point at plan work.
3. Use maximum safe parallelism in the generated plan: independent files/tasks fan out; same-file writes, shared state, and named dependencies serialize.
4. Preserve safety boundaries. Ask one focused question only when the objective is missing, destructive, or has a safety/product ambiguity that repository exploration cannot resolve.
5. After the plan exists, continue directly to Phase 2.

## Phase 2: Create or update Boulder state

Write `.omo/boulder.json` before implementation starts. Prefix session ids with `codex:` so the continuation hook can identify its own session.

```json
{
  "schema_version": 2,
  "active_work_id": "<work-id>",
  "works": {
    "<work-id>": {
      "work_id": "<work-id>",
      "active_plan": ".omo/plans/<plan-name>.md",
      "plan_name": "<plan-name>",
      "session_ids": ["codex:<session_id>"],
      "status": "active",
      "worktree_path": null
    }
  }
}
```

Every phase (plan wave) runs in its own task-owned worktree with its own goal: before the wave's first dispatch, record the wave's goal — its checkboxes and their acceptance criteria — as a ledger entry, then `git worktree add <repo>-wt/<plan>-<wave> <branch off the integration base>` (or verify a `--worktree` path with `git worktree list --porcelain`), store the absolute path as `worktree_path`, run every edit, command, test, and evidence capture inside it; the wave lands on the integration base once its checkboxes are verified (direct merge, or the PR under `--make-pr`/`--ship`), and the next wave branches from that landed base.

## Parallel delivery lanes (teams and worktrees)

Solo orchestration with parallel background workers is the default topology. Decide once, when the wave's lanes are known, and record the verdict in the ledger:

- **Independent lanes -> parallel workers.** Separate files, no shared contract: one parallel spawn burst; no team.
- **Dependency-ordered lanes -> one `workflow` run per wave.** Sub-tasks with real ordering between them (C needs A and B finished first) and a harness with a native `workflow` tool: dispatch the wave as ONE run (one producer node per lane plus a verification node); recover inside it with `retry`/`amend`/`send`; let node completions wake you instead of arming per-lane watchers; the next wave is a NEW run (or `amend` when only the definition changed) — never one graph for the whole plan. Read the `mass-ulw` skill's `SKILL.md` and `references/planning.md` IN FULL before defining any graph.
- **Overlapping lanes -> a team.** The lanes touch the same module or contract AND running them concurrently actually finishes sooner: stand up a team (where the harness has one) so one lane's discoveries relay through you mid-flight.
- **PR-mode independent lanes -> a worktree per lane.** Under `--make-pr`/`--ship`, when a wave holds independent checkboxes, give each lane its own branch and task-owned worktree, delivered as its own PR.

Landing rules, regardless of topology:

- **Merge per verified unit.** A lane lands the moment its own gates pass — it never waits for the slowest sibling. Integrate landed work back into the base the remaining lanes branch from.
- **Only the orchestrator merges.** Workers and team members never merge and never push the base branch.
- **Conflicts are the orchestrator's job.** Decide the landing order and tell the later lane what changed; a worker never resolves a sibling's conflict blind.

## Phase 3: Execute the next checkbox

1. Read the full selected plan.
2. Find the first unchecked column-0 checkbox in `## TODOs` or `## Final Verification Wave`.
3. Ignore nested checkboxes under acceptance criteria, evidence, and definition-of-done sections.
4. Classify the checkbox tier and record it in its ledger entry. Default is LIGHT — a narrow change inside existing layers. Take HEAVY only on a fact you can point to: a new module / abstraction / domain model; auth, security, or session; an external integration; a DB schema or migration; concurrency or transaction boundaries; a cross-domain refactor; or the plan or user signals care. When unsure, take HEAVY; upgrade and redo skipped gates the moment a HEAVY fact surfaces; never downgrade.
5. Decompose that checkbox into atomic sub-tasks sized for ONE worker in ONE run — a sub-task that would need mid-flight steering is two sub-tasks. Collect every other unchecked checkbox in the same plan wave whose dependencies are met — their lanes execute concurrently. A wave that could split further but holds fewer than 3 independent sub-tasks is under-split.
6. **DELEGATE EVERYTHING. YOU NEVER IMPLEMENT.** Route every sub-task through the delegation router below, then dispatch ALL independent sub-tasks across those checkboxes in one parallel worker-spawn burst (a single batched spawn call where the harness supports it); route named dependencies per the lane-topology decision above. Verification and checkbox marking stay per-checkbox.
7. Give every dispatched sub-task its completion condition and watch for it per the section below. A dispatch whose completion nobody watches is an unfinished dispatch.

### Monitor every dispatched subagent to its completion condition

A spawned worker is not fire-and-forget. For EACH subagent in the burst, name the observable state that ends its lane — the file written, the PR opened, the checkbox's gates green — and put a watcher on THAT state, never on a clock.

- **Arm one watcher per lane, at spawn time.** The worker's own completion arrives on its own as an injected notification; arm an explicit `monitor` on top of it only when the lane's completion condition lives OUTSIDE the child's final message — CI turning green, a log line, a build artifact appearing, a branch landing. Watch the state itself (`monitor` with a command that exits or emits on that condition), and keep the burst's watchers distinct so one lane firing never reads as another's.
- **NEVER poll and NEVER sleep.** No `sleep`, no timed retry loop, no re-reading the same status hoping it changed. Between waves, do independent root work or end the turn; an idle session is always woken. A single `task_output({ mode: "tail" })` peek is allowed only when a midpoint decision genuinely depends on it.
- **Tear the watcher down the instant it resolves.** The moment a monitor fires, or you discover it was armed on the WRONG condition (it watches a path the lane never touches, a pattern that can never match, a lane you already cancelled), stop it with `kill_bash` and say so in the ledger. A stale watcher re-fires on unrelated output and corrupts the next wave's verdict.
- **Then advance.** Fired watcher plus verified evidence means that lane's gates run and its checkbox closes; a mis-set watcher means re-arm it on the right condition or drop it, and continue. Never let a dead watcher hold the run open, and never treat watcher silence as a pass.

### Delegation router — recommended task executor category

When the plan annotates a todo with `Recommended task executor category:`, follow that annotation; deviate only for a reason recorded in the ledger entry. Otherwise route by shape, in the omo category vocabulary (category-capable harnesses pass it directly on the worker-spawn tool, e.g. `task(category="quick", ...)`; others map the parenthesized difficulty):

| Category | Route here |
| --- | --- |
| `quick` (low) | mechanical, single-file, boilerplate, config/copy — the default for every splittable piece |
| `unspecified-low` (low) | small tasks that fit no other category |
| `unspecified-high` (medium) | standard features across a few files with known patterns |
| `visual-engineering` (medium) | frontend, UI/UX, styling, animation |
| `writing` (low) | documentation and prose |
| `git` (low) | git operations |
| `deep` (high) | hairy debugging, research-heavy or subtle cross-module work |
| `ultrabrain` (high) | ONE genuinely hard, logic-heavy problem — hand it the goal, not step-by-step instructions |

Sizing is a two-branch decision made per checkbox, before dispatch:

- **Splittable work splits.** When the checkbox decomposes into independent pieces, dispatch them as a swarm of `quick`/`unspecified-low` workers in ONE parallel burst — many small cheap workers in parallel beat one large delegation.
- **Cohesive hard work stays whole.** When splitting would sever shared reasoning (one algorithm, one migration, one subtle bug), send the WHOLE problem to `deep` or `ultrabrain` as ONE delegation. Never force-split work whose parts share one insight.

Each sub-task message must include:

1. Goal and exact files or directories in scope.
2. When the task touches existing behavior: a baseline characterization test, written first, that pins current observable behavior and passes on the unchanged code (exact inputs, exact observable, exact assertion). Then the failing-first proof for the new behavior before production changes — a unit test where a seam exists, otherwise the sub-task's Manual-QA scenario captured failing. A test that mirrors its implementation (mock-call assertions, pinned constants) is not evidence.
3. Implementation constraints from the plan and project rules.
4. Automated verification commands to run.
5. One Manual-QA channel, named with the exact tool and exact invocation (the literal `curl`, `send-keys`, `browser:control-in-app-browser` action, `page.click`, payload, selectors, and the binary observable that decides PASS/FAIL), not "verify it works". A LIGHT checkbox needs one real-surface proof of its deliverable, and auxiliary surfaces (CLI stdout, DB state diff, parsed config dump) are first-class when the surface is CLI- or data-shaped:
   - HTTP call: `curl -i` against the live endpoint.
   - Terminal / TUI: drive a real pty; `tmux send-keys` is fine for a boot/behavior smoke, but color/layout/CJK evidence goes through the xterm.js web terminal below, NEVER `tmux capture-pane`.
   - Browser use: prefer the harness's in-app browser control when available and the scenario does not need an authenticated or persistent user browser profile; otherwise drive the real page with Chrome, or agent-browser (https://github.com/vercel-labs/agent-browser) when Chrome is unavailable.
   - Computer use: OS-level GUI automation against the running desktop app when the surface is not a page.
   - TUI visual evidence: when a TUI claim needs visual QA or PR proof, run `bun script/qa/web-terminal-visual-qa.mjs --command "<cmd>" --input "{Enter}" --evidence-dir <dir>` (real pty rendered through xterm.js in Chrome) and attach `terminal.png` plus `metadata.json`.
6. The adversarial classes that apply to this sub-task (from the 9 ultraqa classes) and how each is probed.
7. Required artifact path and cleanup receipt.
8. Tool-use expectations: batch independent tool calls in parallel; when the harness exposes a code-execution surface (eval), use it for multi-call steps instead of one-by-one calls.

The 9 ultraqa classes are trigger-mapped: new input parsing → malformed input; untrusted external text → prompt injection; resumable or long-running flows → cancel/resume; generated or cached artifacts → stale state; uncommitted user files in scope → dirty worktree; long external commands → hung or long commands; new or timing-sensitive tests → flaky tests; log-based success claims → misleading success output; mid-operation interrupts → repeated interruptions. A class applies when its trigger fact holds. Probe each applicable class; record the rest as not-applicable with a one-line reason.

## Phase 4: Verify and record evidence

For each checkbox, complete all five gates before marking it done:

1. Plan reread: confirm the checkbox and acceptance criteria.
2. Automated verification: run tests, typecheck, lint, build, or the plan-specific equivalent.
3. Manual-QA channel: capture a real artifact, not a dry-run claim.
4. Adversarial QA: exercise every class the Phase 3 trigger map marks applicable and capture the observable result for each.
5. Cleanup: register every QA resource teardown as its own todo when spawned (QA scripts, tmux assets, browser sessions, PIDs, ports, containers, temp dirs), execute each, and capture the receipt. No QA asset is left running.

Append evidence to `.omo/ulw-execute/ledger.jsonl`, one JSON object per line. Include at least `event`, `plan`, `task`, `session_id`, `commands`, `artifact`, `adversarial_classes`, and `cleanup` fields. `adversarial_classes` lists each probed class with its observable result and each ruled-out class with a one-line reason.

### Sisyphus-style completion contract

A worker done claim is never final: each implementation sub-task returns a `DoneClaim`, a different context runs `AdversarialVerify` probing or reproducing the claim, failures loop back to the executor, and only a confirmed verifier verdict becomes `FullyDone`.

```json
{
  "DoneClaim": {
    "task": "<task id/title>",
    "changed_files": ["path"],
    "tests": ["exact command + result"],
    "manual_qa": ["artifact path"],
    "cleanup": ["receipt"],
    "risks": ["known risk or none"]
  },
  "AdversarialVerify": {
    "verdict": "confirmed | false-positive | needs-fix | needs-human-review",
    "evidence": ["file path, command, log, artifact, or explicit not inspected"],
    "repro": "exact command or manual steps when available",
    "confidence": 0.0
  }
}
```

Rules:
- `confirmed` is the only pass verdict. `false-positive`, `needs-fix`, and `needs-human-review` all block checkbox completion.
- The verifier must be independent from the executor: use the harness's gate reviewer (see the harness compatibility section) or a fresh reviewer worker on a strong model, or root only when root did not implement or materially rewrite that task.
- A worker done claim must be independently verified before it becomes checkbox completion.
- On any non-confirmed verdict, append the feedback to the ledger, reset the checkbox work to in-progress, and re-dispatch the executor with the exact failure.
- The verifier must probe the applicable adversarial keys, including `stale_state`, `dirty_worktree`, and `misleading_success_output`, before allowing `FullyDone`.

## Phase 5: Mark progress

Only after verification passes:

1. Edit the plan checkbox from `- [ ]` to `- [x]`.
2. Re-read the plan and confirm the remaining count decreased.
3. Append a `task-completed` ledger entry.
4. Continue with the next checkbox. Do not ask whether to continue.

## Completion

When all top-level checkboxes in `## TODOs` and `## Final Verification Wave` are complete:

1. Run the plan's final verification commands.
2. For PR/branch work, finish the lifecycle from the last phase's worktree: sync `.omo/` state back to the main repo, create or update the PR, wait for review/verification gates, merge by default unless explicitly opted out, and remove the worktree only after successful merge or explicit handoff.
3. Remove or mark the Boulder work as completed.
4. Print an `ORCHESTRATION COMPLETE` block with the plan path, verification commands, artifacts, and cleanup receipts.

## Hard rules

- No production change before a failing-first proof exists (unit test at a seam, otherwise the failing Manual-QA scenario), and no change to existing behavior before a baseline characterization test pins the current behavior and passes on the unchanged code.
- No `--dry-run` as completion evidence.
- No tests-only completion claim. A Manual-QA artifact is required.
- **NO DIRECT IMPLEMENTATION BY THE ORCHESTRATOR.** Root NEVER edits product files, writes tests, or runs QA itself — a spawned worker does.
- No completion claim while an applicable ultraqa adversarial class was never probed. Each applicable class needs a captured observable result; each skipped class needs a one-line not-applicable reason in the ledger.
- No implementation, review, or merge in the main checkout; every phase works in its task-owned worktree.
- No unprefixed session ids in Boulder state. Sessions are always recorded as `codex:<session_id>`.
- No stale-memory execution. The plan and ledger are the durable source of truth.
