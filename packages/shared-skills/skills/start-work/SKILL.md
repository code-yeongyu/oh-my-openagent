---
name: start-work
description: "Execute a Prometheus work plan in Codex with Boulder state, evidence ledger updates, worktree discipline, parallel subagents, and Stop-hook continuation. Use after planning when the user says start work, execute plan, continue plan, resume plan, or asks to run a .omo/plans plan."
---

## Codex Harness Tool Compatibility

This skill ports the OpenCode `/start-work` flow onto Codex. Any OpenCode-only tool name in an inherited example must be translated to its Codex equivalent:

| OpenCode example | Codex tool to use |
| --- | --- |
| `task(subagent_type="explore", ...)` | `spawn_agent(agent_type="explorer", task_name="...", message="...", fork_turns="none")` |
| `task(subagent_type="librarian", ...)` | `spawn_agent(agent_type="librarian", task_name="...", message="...", fork_turns="none")` |
| `task(subagent_type="plan", ...)` | `spawn_agent(agent_type="plan", task_name="...", message="...", fork_turns="none")` |
| `task(subagent_type="oracle", ...)` for final verification | `spawn_agent(agent_type="codex-ultrawork-reviewer", task_name="...", message="...", fork_turns="none")` |
| `task(category="...", ...)` for implementation or QA | `spawn_agent(agent_type="worker", task_name="...", message="...", fork_turns="none")` |
| `background_output(task_id="...")` | `wait_agent(...)` for mailbox signals; after a timeout, run one `list_agents` check for the named child if reassurance is needed |
| `dispatchInternalPrompt(...)` | the `Stop` hook emits `{"decision":"block","reason":"<prompt>"}` automatically; see Continuation |
| `team_*(...)` | `spawn_agent` + `send_message` + `followup_task` + `wait_agent` + `close_agent` |

When translating `load_skills=[...]`, name the skills inside the spawned agent's `message`. If a code block below conflicts with this section, this section wins.

## Codex Subagent Reliability

Every `spawn_agent` message must be self-contained. Start with
`TASK: <imperative assignment>`, then name `DELIVERABLE`, `SCOPE`, and
`VERIFY`. State that it is an executable assignment, not a context
handoff. Role selection requires `agent_type`; `model` +
`reasoning_effort` alone creates a default agent, not a reviewer or
worker. Prefer `fork_turns: "none"` unless full history is truly
required; paste only the context the child needs.

Plan and reviewer agents may run for a long time; spawn them in the background, keep doing independent root work, and poll with short wait_agent cycles sized to the work. Never use a single long blocking wait for them, and never spin on tiny timeouts as a failure budget.

Treat child status as a progress signal, not a timeout counter. For
work likely to exceed one wait cycle, require the child to send
`WORKING: <task> - <current phase>` before long reading, testing, or
review passes, and `BLOCKED: <reason>` only when it cannot progress.
While any child is active, keep the parent visibly alive with active
subagent count, agent names, latest `WORKING:` phase, and whether the
parent is waiting for mailbox updates. Track spawned agent names
locally. Use `wait_agent` for mailbox signals, not proof of completion.
A timeout only means no new mailbox update arrived; after a timeout,
run a single `list_agents` check for the named child when you need
reassurance. If it is running or its latest message is `WORKING:`,
treat it as alive. Do not use `list_agents` as a polling loop or status
feed; it can replay large payloads. Fallback only when the child is
completed without the deliverable, ack-only after followup, explicitly
`BLOCKED:`, or no longer running. Then record the result as
inconclusive, do not count it as pass/review approval, close if safe,
and respawn a smaller `fork_turns: "none"` task with the missing
deliverable.

# start-work

Execute a Prometheus work plan until every top-level checkbox is complete. This skill pairs with the Codex `Stop` / `SubagentStop` continuation hook in `components/start-work-continuation`, which re-injects the next turn while `.omo/boulder.json` says the current `codex:<session_id>` still has unchecked plan work.

## Usage

```text
$start-work [plan-name] [--worktree <absolute-path>]
```

- `plan-name` is optional. It may be a full or partial file stem under `.omo/plans/`.
- `--worktree` is optional. Use it only when the user explicitly asks to work in a separate git worktree.

## Phase 1: Select the plan

1. Read `.omo/boulder.json` if it exists.
2. List Prometheus plan files under `.omo/plans/`.
3. If `plan-name` was provided, select the matching plan.
4. If exactly one active or paused Boulder work exists for this session, resume it.
5. If no active work exists and exactly one plan exists, select it.
6. If no active work exists and there is no selectable plan, enter **No-plan bootstrap**.
7. If multiple plans remain possible, ask one focused selection question.

### No-plan bootstrap

When the user explicitly said `start work` / `$start-work` and no selectable plan exists, treat that phrase as approval to create the plan before execution. Do not stall on a missing plan and do not ask for generic approval again.

If no selectable plan exists, bootstrap `ulw-plan` before execution.
Execution requires an approved plan before implementation; bootstrap mode creates that approved plan from the user's `start work` request instead of skipping planning.

1. Invoke the `ulw-plan` skill from the current request and require its dynamic adversarial workflow: collect, verify, design, adversarial plan-review, synthesize.
2. The generated Prometheus plan must be saved under `.omo/plans/<slug>.md` before implementation or Boulder state writes that point at plan work.
3. Use maximum safe parallelism in the generated plan: independent files/tasks fan out; same-file writes, shared state, and named dependencies serialize.
4. Preserve safety boundaries. Ask one focused question only when the objective is missing, destructive, or has a safety/product ambiguity that repository exploration cannot resolve.
5. After the plan exists, continue directly to Phase 2. The user's `start work` request is the bootstrap approval to create the plan and begin execution.

## Phase 2: Create or update Boulder state

Write `.omo/boulder.json` before implementation starts. Session ids must be prefixed with `codex:` so the continuation hook can identify its own session.

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

If `--worktree` is set, verify the path with `git worktree list --porcelain` or create it with `git worktree add <path> <branch-or-HEAD>`, then store the absolute path as `worktree_path`. All edits, commands, tests, and evidence capture must run inside that worktree.

## Phase 3: Execute the next checkbox

1. Read the full selected plan.
2. Find the first unchecked column-0 checkbox in `## TODOs` or `## Final Verification Wave`.
3. Ignore nested checkboxes under acceptance criteria, evidence, and definition-of-done sections.
4. Decompose that checkbox into atomic sub-tasks.
5. Dispatch independent sub-tasks in parallel with `spawn_agent`; serialize only when one sub-task has a named dependency on another.

Each sub-task message must include:

1. Goal and exact files or directories in scope.
2. When the task touches existing behavior: a baseline characterization test, written first, that asserts current observable behavior and passes on the unchanged code. Then the red test or failing reproduction for the new behavior before production changes. Pin the baseline as rigorously as the new test: exact inputs, exact observable, exact assertion.
3. Implementation constraints from the plan and project rules.
4. Automated verification commands to run.
5. One Manual-QA channel, named with the exact tool and exact invocation (the literal `curl`, `send-keys`, `page.click`, payload, selectors, and the binary observable that decides PASS/FAIL), not "verify it works":
   - HTTP call: `curl -i` against the live endpoint.
   - tmux: a `tmux` session driven with `send-keys`, dumped via `capture-pane`.
   - Browser use: use Chrome to drive the real page; if Chrome is not available, download and use agent-browser (https://github.com/vercel-labs/agent-browser).
   - Computer use: OS-level GUI automation against the running desktop app when the surface is not a page.
6. The adversarial classes that apply to this sub-task (from the 9 ultraqa classes) and how each is probed.
7. Required artifact path and cleanup receipt.

Apply ultraqa's 9 adversarial classes where relevant to each checkbox: malformed input, prompt injection, cancel/resume, stale state, dirty worktree, hung or long commands, flaky tests, misleading success output, repeated interruptions. A checkbox whose behavior is user-visible MUST probe every class that plausibly applies; record which classes were exercised and which were ruled not-applicable with a one-line reason.

## Phase 4: Verify and record evidence

For each checkbox, complete all five gates before marking it done:

1. Plan reread: confirm the checkbox and acceptance criteria.
2. Automated verification: run tests, typecheck, lint, build, or the plan-specific equivalent.
3. Manual-QA channel: capture a real artifact, not a dry-run claim.
4. Adversarial QA: exercise every applicable ultraqa class (malformed input, prompt injection, cancel/resume, stale state, dirty worktree, hung or long commands, flaky tests, misleading success output, repeated interruptions) and capture the observable result for each. "Tests pass" and a clean happy-path artifact are NOT sufficient when an adversarial class applies and was not probed.
5. Cleanup: register every QA resource teardown as its own todo the moment it is spawned (QA scripts, tmux assets, browser / agent-browser sessions, PIDs, ports, containers, temp dirs), then execute each and capture the receipt. No QA asset is left running.

Append evidence to `.omo/start-work/ledger.jsonl` using one JSON object per line. Include at least `event`, `plan`, `task`, `session_id`, `commands`, `artifact`, `adversarial_classes`, and `cleanup` fields. `adversarial_classes` lists each probed class with its observable result and each ruled-out class with a one-line reason.

### Sisyphus-style completion contract

A worker done claim is never final. Each implementation sub-task returns a `DoneClaim`, then a different context runs `AdversarialVerify`, then the verifier probes or reproduces the claim, then failures loop back to the executor, and only a confirmed verifier verdict becomes `FullyDone`.

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
- The verifier must be independent from the executor: use `codex-ultrawork-reviewer`, a scoped `worker` reviewer, or root only when root did not implement or materially rewrite that task.
- A worker done claim must be independently verified before it can become checkbox completion.
- On any non-confirmed verdict, append the feedback to the ledger, reset the checkbox work to in-progress, and re-dispatch the executor with the exact failure.
- The verifier must probe the applicable adversarial keys, including `stale_state`, `dirty_worktree`, and `misleading_success_output`, before allowing `FullyDone`.
- In prose evidence, name the same risks as stale state, dirty worktree, and misleading success output so reviewers can search for both key and human forms.
- Tests passing, green builds, or a worker DoneClaim without independent verification are not enough to mark a checkbox complete.

## Phase 5: Mark progress

Only after verification passes:

1. Edit the plan checkbox from `- [ ]` to `- [x]`.
2. Re-read the plan and confirm the remaining count decreased.
3. Append a `task-completed` ledger entry.
4. Continue with the next checkbox. Do not ask whether to continue.

## Completion

When all top-level checkboxes in `## TODOs` and `## Final Verification Wave` are complete:

1. Run the plan's final verification commands.
2. If worktree mode was used, sync `.omo/` state back to the main repo, merge or hand off exactly as requested, and remove the worktree only after successful merge or explicit handoff.
3. Remove or mark the Boulder work as completed.
4. Print an `ORCHESTRATION COMPLETE` block with the plan path, verification commands, artifacts, and cleanup receipts.

## Hard rules

- No production change before a failing test or reproduction exists, and no change to existing behavior before a baseline characterization test pins the current behavior and passes on the unchanged code.
- No `--dry-run` as completion evidence.
- No tests-only completion claim. A Manual-QA artifact is required.
- No completion claim while an applicable ultraqa adversarial class was never probed. Each applicable class needs a captured observable result; each skipped class needs a one-line not-applicable reason in the ledger.
- No unprefixed session ids in Boulder state. Codex sessions are always `codex:<session_id>`.
- No stale-memory execution. The plan and ledger are the durable source of truth.
