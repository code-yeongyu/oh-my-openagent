<start-work-continuation>

You are mid-flight on a Prometheus work plan. The turn just ended without finishing the plan. This is an automatic continuation — keep going. Do NOT ask the user whether to continue; the contract is auto-continue until every top-level checkbox is `- [x]`.

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

1. Read `{{PLAN_PATH}}` AND `{{LEDGER_PATH}}` first — ground truth for what remains and what evidence has already been recorded. The plan checkbox and the ledger are the only sources of truth; do not trust your own memory of prior turns.
2. Pick the FIRST unchecked top-level checkbox in `## TODOs` or `## Final Verification Wave`. Ignore nested checkboxes under Acceptance Criteria / Evidence / Definition of Done.
3. Follow the `start-work` skill in full. The skill is already loaded from your earlier turn — re-read its file at `packages/omo-codex/plugin/skills/start-work/SKILL.md` if you have lost context.
4. Decompose the checkbox into atomic sub-tasks. Dispatch them in PARALLEL via `spawn_agent` calls in this same response unless a sub-task has a NAMED blocking dependency (input from another sub-task or shared file). Prefer `fork_turns: "none"` unless full history is truly required. Put role and specialty instructions inside `message`; the Codex tool schema only accepts `task_name`, `message`, and `fork_turns`.
5. Every sub-task message MUST be self-contained and start with `TASK: <imperative assignment>`, then name `DELIVERABLE`, `SCOPE`, and `VERIFY`. State that it is an executable assignment, not a context handoff. It must include all 7 sections and name one Manual-QA channel with its exact tool and exact invocation (the literal `curl` / `send-keys` / `page.click` with concrete inputs and the binary PASS/FAIL observable), plus the applicable ultraqa adversarial classes, a captured artifact, and a cleanup receipt. Channels: HTTP call (`curl -i`); tmux (`send-keys` + `capture-pane`); browser use — use Chrome to drive the page, else download and use agent-browser (https://github.com/vercel-labs/agent-browser); computer use — OS-level GUI automation for a desktop app. Tests are the floor; the channel artifact plus probed adversarial classes are the ceiling. All are required.
6. Treat every worker DoneClaim as untrusted input. Run independent AdversarialVerify before any checkbox can become FullyDone; `confirmed` is the only pass verdict, while `false-positive`, `needs-fix`, and `needs-human-review` loop back to the executor with exact feedback.
7. Use `wait_agent` for mailbox signals, not proof of completion. For sub-tasks likely to exceed one wait cycle, require `WORKING: <task> - <current phase>` before long passes and `BLOCKED: <reason>` only when progress stops. A timeout only means no new mailbox update arrived; after a timeout, run a single `list_agents` check for the named child when you need reassurance. If it is running or its latest message is `WORKING:`, treat it as alive. Do not use `list_agents` as a polling loop. Send `TASK STILL ACTIVE: return <deliverable> or BLOCKED: <reason>` only when the child is completed without the deliverable, ack-only, or no longer running. If that followup is still silent or ack-only, record inconclusive, do not count it as pass/review approval, close if safe, and respawn a smaller `fork_turns: "none"` task with the missing deliverable.
8. After verification of ALL sub-tasks under this checkbox: `apply_patch` the plan to change `- [ ]` → `- [x]`, re-read the plan to confirm the count decreased, append a `task-completed` line to the ledger, then continue.
9. Do not start fresh on a sub-agent failure. Re-dispatch the same `task_name` with a fix-message: `FAILED: <exact error>` + `Diagnosis: <observation>` + `Fix: <instruction>`.

# Hard constraints

- No production code before a failing test exists. When the change touches existing behavior, PIN it first: write a baseline characterization test that passes on the unchanged code, with exact inputs, exact observable, and exact assertion. PIN → RED → GREEN → SURFACE.
- No `--dry-run` as evidence. No "should work". No "tests pass" as completion proof.
- No `as any` / `@ts-ignore` / `@ts-expect-error`. No deleting failing tests.
- Probe every applicable ultraqa adversarial class (malformed input, prompt injection, cancel/resume, stale state, dirty worktree, hung or long commands, flaky tests, misleading success output, repeated interruptions) and capture the observable for each. A clean happy-path artifact alone is NOT a PASS when an applicable class went unprobed; record skipped classes with a one-line not-applicable reason.
- Cleanup receipt is mandatory. Register each QA resource teardown (scripts, tmux assets, browser / agent-browser sessions, PIDs, ports, containers, temp dirs) as its own todo the moment it spawns, then execute it. Leftover PIDs / `tmux` sessions / browser contexts / bound ports / containers / temp dirs = BLOCKED, not PASS.
- The worktree path (if set in boulder.json) governs every file edit and command. Do not stray into the main repo.
- session_ids you write to boulder.json MUST be prefixed `codex:`. Bare ids on read are legacy `opencode:`.

# Global Review and Debugging Gate

Before completion, run `review-work` and a `debugging` runtime audit. Treat timeout, missing deliverable, ack-only, `BLOCKED:`, and inconclusive review lanes as failures, not progress. Record at least three debugging hypotheses and the runtime evidence that confirms or refutes each one.

Do not print `ORCHESTRATION COMPLETE`. Do not create a PR, PR handoff, or branch handoff. Do not write a final completion answer until this gate passes. Always redact secrets, tokens, credentials, auth headers, cookies, env dumps, private logs, and PII from ledgers, PR bodies, and handoffs.

# Stop conditions for THIS turn

- A top-level checkbox flipped to `- [x]` after the 5-phase QA gate (Phase 1 read, Phase 2 automated, Phase 3 channel scenario, Phase 4 adversarial-class probing, Phase 5 gate decision). Then the Stop hook will re-evaluate; if more checkboxes remain you will be continued again.
- 3 same-failure cycles on one sub-task → escalate via `spawn_agent({"task_name":"failure_escalation_review","message":"TASK: act as a rigorous reviewer. DELIVERABLE: diagnose the repeated sub-task failure and recommend the next safe action. VERIFY: cite the failing evidence.","fork_turns":"none"})` and stop dispatch.
- Safety boundary (destructive command, secret exfiltration, production write) → stop and surface a safe substitute.
- All top-level checkboxes `- [x]` AND the Global Review and Debugging Gate passed → print the ORCHESTRATION COMPLETE block and end.

# Output discipline

- Surface only state changes: sub-agent dispatched, channel scenario PASS/FAIL with artifact path, checkbox marked, evidence appended to ledger.
- Do NOT print "Should I continue?" — the Stop hook handles continuation.
- Do NOT restate the full plan. Do NOT recap prior turns. The ledger and the plan file are the durable record.

Begin now. Pick the next checkbox, dispatch the parallel sub-agents, verify, mark, continue.

</start-work-continuation>
