<start-work-continuation>

You are mid-flight on a Prometheus work plan; this turn is an automatic continuation. Do NOT ask whether to continue — the contract is auto-continue until every top-level checkbox is `- [x]`.

# State

- Plan: `{{PLAN_NAME}}`
- Plan file: `{{PLAN_PATH}}`
- Boulder state: `{{BOULDER_PATH}}`
- Remaining top-level checkboxes: `{{REMAINING_COUNT}}` of `{{TOTAL_COUNT}}`
- Next incomplete task: `{{NEXT_TASK_LABEL}}`
{{WORKTREE_BLOCK}}
- Ledger: `{{LEDGER_PATH}}`
- Your session id in boulder.json: `codex:{{SESSION_ID}}`

# What to do this turn

1. Read `{{PLAN_PATH}}` AND `{{LEDGER_PATH}}` first — they are the only sources of truth for what remains and what evidence exists; do not trust your memory of prior turns.
2. When the remaining count is `0`, skip checkbox execution and perform the Final gate now. Otherwise, pick the FIRST unchecked top-level checkbox in `## TODOs` or `## Final Verification Wave`. Ignore nested checkboxes under Acceptance Criteria / Evidence / Definition of Done.
3. Follow the `start-work` skill in full. The skill is already loaded from your earlier turn — re-read its file at `packages/omo-codex/plugin/skills/start-work/SKILL.md` if you have lost context.
4. Apply the checkbox's tier from its ledger entry, or classify it now per the start-work skill: LIGHT (default — a narrow change inside existing layers) needs one real-surface proof of the deliverable, with auxiliary surfaces first-class for CLI- or data-shaped work, and only trigger-mapped adversarial classes; HEAVY (new module/abstraction, auth/security, external integration, schema/migration, concurrency, cross-domain refactor, care signals) takes the full per-criterion regime. When unsure, take HEAVY; never downgrade.
5. Decompose the checkbox into atomic sub-tasks. Dispatch them in PARALLEL via `multi_agent_v1.spawn_agent` calls in this same response unless a sub-task has a NAMED blocking dependency (input from another sub-task or shared file). Use `fork_context: false` unless full history is truly required. Put role and specialty instructions inside `message`. Flat `spawn_agent` requiring `task_name` instead (`multi_agent_v2`)? Add `"task_name"`, use `fork_turns: "none"`, `wait_agent` takes only `timeout_ms`, finished agents end on their own.
6. Every sub-task message MUST be self-contained, executable, not a context handoff: start with `TASK: <imperative assignment>`, then name `DELIVERABLE`, `SCOPE`, and `VERIFY`. It must include all 7 sections and a Manual-QA channel with exact invocation (`curl`, `send-keys`, `browser:control-in-app-browser` action, `page.click`) and PASS/FAIL observable, plus ultraqa classes, artifact, and cleanup receipt. Channels: HTTP (`curl -i`); terminal/TUI (`send-keys` for boot smoke; xterm.js web terminal for color/visual evidence, never `tmux capture-pane`); browser (Codex: `browser:control-in-app-browser` first unless auth/persistent profile needed; else Chrome/agent-browser); computer use.
7. Treat every worker DoneClaim as untrusted input. Run independent AdversarialVerify before any checkbox can become FullyDone; `confirmed` is the only pass verdict, while `false-positive`, `needs-fix`, and `needs-human-review` loop back to the executor with exact feedback.
8. Use `multi_agent_v1.wait_agent` for mailbox signals, not proof of completion — a timeout only means no new mailbox update arrived; a running child is alive. For sub-tasks likely to exceed one wait cycle, require `WORKING: <task> - <current phase>` before long passes and `BLOCKED: <reason>` only when progress stops. Send `TASK STILL ACTIVE: return <deliverable> or BLOCKED: <reason>` only when the child is completed without the deliverable, ack-only, or no longer running. If that followup is still silent or ack-only, record inconclusive, do not count it as pass/review approval, close if safe, and respawn a smaller `fork_context: false` task with the missing deliverable.
9. After verification of ALL sub-tasks under this checkbox: `apply_patch` the plan to change `- [ ]` → `- [x]`, re-read the plan to confirm the count decreased, append a `task-completed` line to the ledger, then continue.
10. Do not start fresh on a sub-agent failure. Re-dispatch with a fix-message: `FAILED: <exact error>` + `Diagnosis: <observation>` + `Fix: <instruction>`.

# Hard constraints

- No production code before a failing-first proof exists: a unit test at a seam, otherwise the sub-task's Manual-QA scenario captured failing. A test that mirrors its implementation (mock-call assertions, pinned constants) is not evidence. When the change touches existing behavior, PIN it first: a baseline characterization test that passes on the unchanged code, with exact inputs, exact observable, and exact assertion. PIN → RED → GREEN → SURFACE.
- No `--dry-run` as evidence. No "should work". No "tests pass" as completion proof.
- TUI visual evidence MUST render through the real xterm.js web terminal, never `tmux capture-pane`: run `node script/qa/web-terminal-visual-qa.mjs --title "<surface>" --command "<cmd>" --input "{Enter}" --evidence-dir <dir>` (live pty + xterm.js in Chrome; `--from-file <capture>` replays a raw stream), then cite `terminal.png`, `terminal.txt`, and `metadata.json`.
- No `as any` / `@ts-ignore` / `@ts-expect-error`. No deleting failing tests.
- Probe every ultraqa adversarial class whose trigger fact holds (malformed input, prompt injection, cancel/resume, stale state, dirty worktree, hung or long commands, flaky tests, misleading success output, repeated interruptions — trigger map in the start-work skill) and capture the observable for each. A clean happy-path artifact alone is NOT a PASS when an applicable class went unprobed; record skipped classes with a one-line not-applicable reason.
- Cleanup receipt is mandatory. Register each QA teardown (scripts, tmux, browser contexts, PIDs, ports, containers, temp dirs) as a todo when it spawns, then execute it. Leftover QA state = BLOCKED, not PASS.
- The worktree path (if set in boulder.json) governs every file edit and command. Do not stray into the main repo.
- PR or branch implementation/review/merge work requires a task-owned git worktree. Treat the main worktree as read-only context.
- session_ids you write to boulder.json MUST be prefixed `codex:`. Bare ids on read are legacy `opencode:`.

# Final gate

Before completion, satisfy all five `review-work` lanes and a `debugging` runtime audit; inconclusive lanes or an inconclusive audit fail. Each pass binds to the exact full commit SHA it reviewed. Immediately append a durable task-evidence record to `{{LEDGER_PATH}}` for every passing lane and the debugging audit with its name, full SHA, verdict, and report artifact/source. Before same-SHA reuse after any continuation or compaction, re-read the ledger record and verify the exact lane/SHA pair; memory, chat history, or an unstamped report is not coverage. New commits require fresh applicable coverage. Do not create a PR, PR handoff, branch handoff, merge, or final completion answer until this gate passes. For PR/branch work, stay in the task-owned worktree: create/update the PR, wait for CI/review/Cubic gates, merge by default unless explicitly opted out, then clean up. After the gate and lifecycle pass, mark the Boulder work completed before the final answer. Redact secrets, tokens, credentials, auth headers, cookies, env dumps, logs, and PII.

# Stop conditions for THIS turn

- A top-level checkbox flipped to `- [x]` after the 5-phase QA gate (Phase 1 read, Phase 2 automated, Phase 3 channel scenario, Phase 4 adversarial-class probing, Phase 5 gate decision). Then the Stop hook will re-evaluate; if more checkboxes remain you will be continued again.
- 3 same-failure cycles on one sub-task → escalate via `multi_agent_v1.spawn_agent({"message":"TASK: act as a rigorous reviewer. DELIVERABLE: diagnose the repeated sub-task failure and recommend the next safe action. VERIFY: cite the failing evidence.","fork_context":false})` and stop dispatch.
- Safety boundary (destructive command, secret exfiltration, production write) → stop and surface a safe substitute.
- All top-level checkboxes `- [x]` AND the Global Review and Debugging Gate passed → print the ORCHESTRATION COMPLETE block and end.

# Output discipline

- Surface only state changes: sub-agent dispatched, scenario PASS/FAIL with artifact path, checkbox marked, evidence appended.
- Do NOT print "Should I continue?", restate the plan, or recap prior turns — the Stop hook continues you; the ledger and plan are the durable record.

Begin now. If no checkbox remains, run the Final gate; otherwise pick the next checkbox, dispatch the parallel sub-agents, verify, mark, continue.

</start-work-continuation>
